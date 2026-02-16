/**
 * native.ts — Native RetroArch orchestration for Retrobox
 *
 * Manages the lifecycle of native RetroArch running under Cage (Wayland compositor).
 * Browser Retrobox UI handles game selection → this module launches native RetroArch
 * for rendering → on quit, kiosk service restarts automatically.
 *
 * Dynamically imported by server.ts — if import fails, web-only mode.
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, extname } from "path";

// ── Paths ───────────────────────────────────────────────────────────────────

const RETROARCH_BIN = "/nix/store/fi2vcpb1xv0b4592nhly5vcbv622xckn-retroarch-bare-1.21.0/bin/retroarch";
const CORES_DIR = "/nix/store/68hizy252msdd7br3jig3j3310ldmy13-retroarch-with-cores-1.21.0/lib/retroarch/cores";
const GLES3_CORE = "/nix/store/qgaqgc3zz7ivfjvbnzwa8scyg7vk83lf-libretro-mupen64plus-next-gles3-0-unstable-2025-11-14/lib/retroarch/cores/mupen64plus_next_gles3_libretro.so";
const AUTOCONFIG_DIR = "/nix/store/zrk72vsvnwi3sdxhlh48629q9s7gk36c-retroarch-joypad-autoconfig-1.22.0/share/libretro/autoconfig";
const CAGE_BIN = "/run/current-system/sw/bin/cage";
const SYSTEMCTL = "/run/current-system/sw/bin/systemctl";

const KIOSK_HOME = "/var/cache/kiosk-home";
const RETROARCH_CFG = join(KIOSK_HOME, ".config/retroarch/retroarch.cfg");
const CORE_OPTIONS_DIR = join(KIOSK_HOME, ".config/retroarch/config");
const SAVES_DIR = join(KIOSK_HOME, ".config/retroarch/saves");
const STATES_DIR = join(KIOSK_HOME, ".config/retroarch/states");

const NATIVE_FLAG = "/tmp/retroarch-native";
const KIOSK_OVERRIDE_DIR = "/run/systemd/system/kiosk.service.d";
const EXTRACT_DIR = join(KIOSK_HOME, ".cache/retroarch-extract");

// ── Systems that need uncompressed content ──────────────────────────────────

/** These cores can't load from zip — need extraction first */
const NEEDS_EXTRACTION = new Set(["psx"]);

/** Preferred content file extensions per system (in priority order) */
const CONTENT_EXTENSIONS: Record<string, string[]> = {
  psx: [".cue", ".bin", ".img", ".iso", ".pbp", ".chd"],
};

// ── Core map ────────────────────────────────────────────────────────────────

/** Maps system ID → core .so filename (without path) */
export const NATIVE_CORE_MAP: Record<string, string> = {
  n64: "mupen64plus_next_gles3_libretro.so",
  snes: "snes9x_libretro.so",
  gba: "mgba_libretro.so",
  segaMD: "genesis_plus_gx_libretro.so",
  arcade: "fbneo_libretro.so",
  psx: "pcsx_rearmed_libretro.so",
};

/** Per-core option file names (RetroArch uses the core's "display name") */
const CORE_OPTION_DIRS: Record<string, string> = {
  n64: "Mupen64Plus-Next",
  snes: "Snes9x",
  gba: "mGBA",
  segaMD: "Genesis Plus GX",
  arcade: "FinalBurn Neo",
  psx: "PCSX-ReARMed",
};

// ── State ───────────────────────────────────────────────────────────────────

type NativeState = "idle" | "launching" | "running" | "stopping";

let state: NativeState = "idle";
let cageProcess: ChildProcess | null = null;
let currentCore: string | null = null;
let currentRom: string | null = null;
let exitCallback: ((code: number | null, signal: string | null) => void) | null = null;

// ── Platform probe ──────────────────────────────────────────────────────────

export interface NativeProbe {
  supported: boolean;
  retroarch: boolean;
  cage: boolean;
  seatd: boolean;
  cores: Record<string, boolean>;
}

/** Check if native RetroArch mode is available on this platform */
export function probeNativeSupport(): NativeProbe {
  const retroarch = existsSync(RETROARCH_BIN);
  const cage = existsSync(CAGE_BIN);

  let seatd = false;
  try {
    const out = execSync(`${SYSTEMCTL} is-active seatd 2>/dev/null`, { encoding: "utf-8", timeout: 3000 }).trim();
    seatd = out === "active";
  } catch {}

  const cores: Record<string, boolean> = {};
  for (const [system, coreName] of Object.entries(NATIVE_CORE_MAP)) {
    // N64 GLES3 core lives in a separate store path
    if (system === "n64") {
      cores[system] = existsSync(GLES3_CORE);
    } else {
      cores[system] = existsSync(join(CORES_DIR, coreName));
    }
  }

  const supported = retroarch && cage && seatd && Object.values(cores).some(Boolean);
  return { supported, retroarch, cage, seatd, cores };
}

// ── Core option writing ─────────────────────────────────────────────────────

/** Default core options per system (merged with any user overrides) */
const DEFAULT_CORE_OPTIONS: Record<string, Record<string, string>> = {
  psx: {
    "pcsx_rearmed_neon_interlace_enable": "disabled",
    "pcsx_rearmed_neon_enhancement_enable": "enabled",
    "pcsx_rearmed_neon_enhancement_no_main": "enabled",
    "pcsx_rearmed_frameskip_type": "disabled",
    "pcsx_rearmed_gpu_thread_rendering": "async",
    "pcsx_rearmed_drc": "enabled",
    "pcsx_rearmed_psxclock": "57",
    "pcsx_rearmed_input_sensitivity": "1.00",
  },
  n64: {
    "mupen64plus-cpucore": "cached_interpreter",
    "mupen64plus-rdp-plugin": "gliden64",
    "mupen64plus-rsp-plugin": "hle",
    "mupen64plus-EnableNativeResFactor": "2",
    "mupen64plus-FXAA": "1",
    "mupen64plus-EnableHWLighting": "True",
    "mupen64plus-EnableLODEmulation": "True",
    "mupen64plus-EnableShadersStorage": "True",
    "mupen64plus-ThreadedRenderer": "True",
    "mupen64plus-EnableCopyColorToRDRAM": "Off",
    "mupen64plus-EnableCopyDepthToRDRAM": "Off",
    "mupen64plus-EnableCopyAuxToRDRAM": "False",
    "mupen64plus-EnableCopyColorFromRDRAM": "False",
    "mupen64plus-EnableFBEmulation": "True",
    "mupen64plus-BilinearMode": "3point",
    "mupen64plus-EnableTextureCache": "True",
    "mupen64plus-MaxTxCacheSize": "8000",
  },
};

/**
 * Write core options file for a given system.
 * Merges defaults with provided overrides.
 * Uses sudo because kiosk-home is owned by kiosk user.
 */
export function writeCoreOptions(system: string, overrides?: Record<string, string>): void {
  const dirName = CORE_OPTION_DIRS[system];
  if (!dirName) return;

  try {
    const optDir = join(CORE_OPTIONS_DIR, dirName);
    const optFile = join(optDir, `${dirName}.opt`);

    // Ensure directory exists (needs sudo — owned by kiosk)
    execSync(`sudo mkdir -p "${optDir}"`, { timeout: 3000 });

    // Read existing options if file exists
    const existing: Record<string, string> = {};
    if (existsSync(optFile)) {
      try {
        const content = execSync(`sudo cat "${optFile}"`, { encoding: "utf-8", timeout: 3000 });
        for (const line of content.split("\n")) {
          const match = line.match(/^(.+?)\s*=\s*"(.+)"$/);
          if (match) existing[match[1]] = match[2];
        }
      } catch {}
    }

    // Merge: existing ← defaults ← overrides
    const defaults = DEFAULT_CORE_OPTIONS[system] || {};
    const merged = { ...existing, ...defaults, ...overrides };

    const lines = Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} = "${v}"`);

    const content = lines.join("\n") + "\n";
    execSync(`sudo tee "${optFile}" > /dev/null`, { input: content, timeout: 3000 });
    console.log(`[native] Wrote core options: ${optFile}`);
  } catch (e: any) {
    console.warn(`[native] Failed to write core options for ${system}:`, e.message);
  }
}

// ── Kiosk lifecycle ─────────────────────────────────────────────────────────

/**
 * Stop the kiosk service by creating a runtime override that replaces ExecStart.
 * NixOS manages the service symlink, so `systemctl mask` doesn't work —
 * we use a drop-in override instead.
 */
function stopKiosk(): boolean {
  try {
    // Create native flag
    writeFileSync(NATIVE_FLAG, String(Date.now()));

    // Create runtime override to prevent kiosk restart
    execSync(`sudo mkdir -p ${KIOSK_OVERRIDE_DIR}`, { timeout: 3000 });
    execSync(
      `sudo bash -c 'cat > ${KIOSK_OVERRIDE_DIR}/override.conf << EOF
[Service]
ExecStart=
ExecStart=/bin/true
EOF'`,
      { timeout: 3000 }
    );
    execSync(`sudo ${SYSTEMCTL} daemon-reload`, { timeout: 5000 });
    execSync(`sudo ${SYSTEMCTL} stop kiosk.service`, { timeout: 10000 });

    console.log("[native] Kiosk stopped");
    return true;
  } catch (e: any) {
    console.error("[native] Failed to stop kiosk:", e.message);
    return false;
  }
}

/**
 * Restart the kiosk service by removing the runtime override.
 */
function restartKiosk(): void {
  try {
    // Remove native flag
    try { execSync(`rm -f ${NATIVE_FLAG}`, { timeout: 2000 }); } catch {}

    // Remove runtime override
    try { execSync(`sudo rm -rf ${KIOSK_OVERRIDE_DIR}`, { timeout: 3000 }); } catch {}

    // Reload and restart
    execSync(`sudo ${SYSTEMCTL} daemon-reload`, { timeout: 5000 });
    execSync(`sudo ${SYSTEMCTL} restart kiosk.service`, { timeout: 10000 });
    console.log("[native] Kiosk restarted");
  } catch (e: any) {
    console.error("[native] Failed to restart kiosk:", e.message);
  }
}

// ── ROM permissions ─────────────────────────────────────────────────────────

/** Ensure the kiosk user can read ROM files (Pi home dir needs o+x) */
function ensureRomPermissions(): void {
  try {
    execSync("chmod o+x /home/pi /home/pi/retrobox", { timeout: 3000 });
    execSync("chmod -R o+r /home/pi/retrobox/presets/", { timeout: 5000 });
  } catch (e: any) {
    console.warn("[native] Permission fix failed:", e.message);
  }
}

// ── ZIP extraction for cores that need uncompressed content ─────────────────

let extractedDir: string | null = null;

/**
 * Extract a zip ROM to a temp directory and return the content file path.
 * For PSX, finds the .cue file (or .bin/.iso fallback).
 * Cleans up any previous extraction first.
 */
function extractRom(system: string, zipPath: string): string | null {
  cleanupExtraction();

  const dir = join(EXTRACT_DIR, `${system}-${Date.now()}`);
  try {
    execSync(`sudo mkdir -p "${dir}"`, { timeout: 3000 });
    execSync(`sudo unzip -o -q "${zipPath}" -d "${dir}"`, { timeout: 30000 });
    execSync(`sudo chmod -R a+rX "${dir}"`, { timeout: 3000 });
    extractedDir = dir;

    // Find the best content file
    const files = readdirSync(dir);
    const exts = CONTENT_EXTENSIONS[system] || [];
    for (const ext of exts) {
      const match = files.find(f => f.toLowerCase().endsWith(ext));
      if (match) {
        console.log(`[native] Extracted: ${match}`);
        return join(dir, match);
      }
    }
    // Fallback: first file that isn't a directory
    const fallback = files.find(f => {
      try { return !require("fs").statSync(join(dir, f)).isDirectory(); } catch { return false; }
    });
    if (fallback) {
      console.log(`[native] Extracted (fallback): ${fallback}`);
      return join(dir, fallback);
    }

    console.error(`[native] No content file found in extracted archive`);
    return null;
  } catch (e: any) {
    console.error(`[native] Extraction failed:`, e.message);
    cleanupExtraction();
    return null;
  }
}

/** Clean up extracted files */
function cleanupExtraction(): void {
  if (extractedDir) {
    try { execSync(`sudo rm -rf "${extractedDir}"`, { timeout: 5000 }); } catch {}
    extractedDir = null;
  }
  // Also clean stale dirs
  try {
    if (existsSync(EXTRACT_DIR)) {
      for (const d of readdirSync(EXTRACT_DIR)) {
        try { execSync(`sudo rm -rf "${join(EXTRACT_DIR, d)}"`, { timeout: 5000 }); } catch {}
      }
    }
  } catch {}
}

// ── Launch / Quit ───────────────────────────────────────────────────────────

export interface LaunchOptions {
  /** Core option overrides for this launch */
  coreOptions?: Record<string, string>;
  /** Called when native process exits */
  onExit?: (code: number | null, signal: string | null) => void;
}

/**
 * Resolve the core .so path for a system.
 * N64 GLES3 variant lives in a separate Nix store path.
 */
function resolveCorePath(system: string): string | null {
  const coreName = NATIVE_CORE_MAP[system];
  if (!coreName) return null;
  if (system === "n64") return GLES3_CORE;
  return join(CORES_DIR, coreName);
}

/**
 * Launch a game natively via Cage + RetroArch.
 *
 * 1. Write core options
 * 2. Stop kiosk service
 * 3. Spawn `cage -s -d -- retroarch -L core rom`
 * 4. On exit → restart kiosk
 */
export async function launchNative(
  system: string,
  romPath: string,
  options?: LaunchOptions
): Promise<{ ok: boolean; error?: string }> {
  if (state !== "idle") {
    return { ok: false, error: `Cannot launch: state is ${state}` };
  }

  // Resolve core
  const corePath = resolveCorePath(system);
  if (!corePath || !existsSync(corePath)) {
    return { ok: false, error: `Core not found for system: ${system}` };
  }

  // Verify ROM exists
  if (!existsSync(romPath)) {
    return { ok: false, error: `ROM not found: ${romPath}` };
  }

  state = "launching";
  currentCore = system;
  currentRom = romPath;
  exitCallback = options?.onExit || null;

  console.log(`[native] Launching: ${system} → ${romPath}`);

  // Extract zip for cores that need uncompressed content
  let actualRomPath = romPath;
  if (NEEDS_EXTRACTION.has(system) && romPath.toLowerCase().endsWith(".zip")) {
    console.log(`[native] ${system} requires extraction — unzipping...`);
    const extracted = extractRom(system, romPath);
    if (!extracted) {
      state = "idle";
      currentCore = null;
      currentRom = null;
      return { ok: false, error: "Failed to extract ROM archive" };
    }
    actualRomPath = extracted;
  }

  // Write core options
  writeCoreOptions(system, options?.coreOptions);

  // Ensure ROM readability
  ensureRomPermissions();

  // Ensure saves/states dirs exist (owned by kiosk)
  try {
    execSync(`sudo mkdir -p "${SAVES_DIR}" "${STATES_DIR}"`, { timeout: 3000 });
  } catch {}

  // Stop kiosk
  if (!stopKiosk()) {
    state = "idle";
    currentCore = null;
    currentRom = null;
    return { ok: false, error: "Failed to stop kiosk service" };
  }

  // Small delay for seatd to release the seat
  await new Promise((r) => setTimeout(r, 1500));

  // Spawn Cage → RetroArch
  try {
    const env: Record<string, string> = {
      XDG_RUNTIME_DIR: "/run/user/1001",
      LIBSEAT_BACKEND: "seatd",
      WLR_RENDERER: "gles2",
      WLR_NO_HARDWARE_CURSORS: "1",
      HOME: KIOSK_HOME,
      // PipeWire audio
      PULSE_SERVER: `/run/user/1001/pulse/native`,
    };

    const retroarchArgs = [
      "-s", "-d", "--",
      RETROARCH_BIN,
      "--config", RETROARCH_CFG,
      "--appendconfig", "/dev/null", // prevent NixOS wrapper injection
      "-L", corePath,
      actualRomPath,
    ];

    console.log(`[native] exec: ${CAGE_BIN} ${retroarchArgs.join(" ")}`);

    const SUDO = "/run/wrappers/bin/sudo";
    // sudo -u strips env; use --preserve-env or pass vars explicitly via env
    const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    cageProcess = spawn(SUDO, [
      "-u", "kiosk",
      "/run/current-system/sw/bin/env",
      ...envArgs,
      `PATH=/run/wrappers/bin:/run/current-system/sw/bin`,
      CAGE_BIN, ...retroarchArgs,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    state = "running";

    // Log stdout/stderr
    cageProcess.stdout?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log(`[retroarch] ${line}`);
    });
    cageProcess.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.error(`[retroarch] ${line}`);
    });

    // Handle exit
    cageProcess.on("exit", (code, signal) => {
      console.log(`[native] Cage exited: code=${code}, signal=${signal}`);
      const wasRunning = state === "running" || state === "stopping";
      state = "idle";
      cageProcess = null;
      const exitCore = currentCore;
      const exitRom = currentRom;
      currentCore = null;
      currentRom = null;

      // Clean up extracted ROM files
      cleanupExtraction();

      // Restart kiosk
      restartKiosk();

      // Notify callback
      if (exitCallback) {
        try { exitCallback(code, signal); } catch {}
        exitCallback = null;
      }
    });

    cageProcess.on("error", (err) => {
      console.error(`[native] Spawn error:`, err);
      state = "idle";
      cageProcess = null;
      currentCore = null;
      currentRom = null;
      cleanupExtraction();
      restartKiosk();
    });

    return { ok: true };
  } catch (e: any) {
    console.error(`[native] Launch failed:`, e);
    state = "idle";
    currentCore = null;
    currentRom = null;
    cleanupExtraction();
    restartKiosk();
    return { ok: false, error: e.message };
  }
}

// ── Quit ────────────────────────────────────────────────────────────────────

/**
 * Quit native RetroArch. Sends SIGTERM to Cage (which terminates RetroArch).
 * The exit handler then restarts the kiosk.
 */
export function quitNative(): { ok: boolean; error?: string } {
  if (state !== "running" || !cageProcess) {
    return { ok: false, error: `Cannot quit: state is ${state}` };
  }

  state = "stopping";
  console.log("[native] Sending SIGTERM to Cage");

  try {
    // Kill the process group (sudo spawned it)
    if (cageProcess.pid) {
      execSync(`sudo kill ${cageProcess.pid}`, { timeout: 5000 });
    }
    return { ok: true };
  } catch (e: any) {
    // Try harder — find cage process
    try {
      execSync("sudo pkill -f 'cage.*retroarch'", { timeout: 3000 });
      return { ok: true };
    } catch {
      return { ok: false, error: e.message };
    }
  }
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface NativeStatus {
  state: NativeState;
  core: string | null;
  rom: string | null;
  pid: number | null;
  supported: boolean;
  cores: Record<string, boolean>;
}

/** Get current native mode status */
export function getNativeStatus(): NativeStatus {
  const probe = probeNativeSupport();
  return {
    state,
    core: currentCore,
    rom: currentRom,
    pid: cageProcess?.pid ?? null,
    supported: probe.supported,
    cores: probe.cores,
  };
}

// ── Exported constants for server.ts integration ────────────────────────────

export { RETROARCH_BIN, CORES_DIR, CAGE_BIN };
