import { serve, file } from "bun";
import { join, extname, basename } from "path";
import { networkInterfaces } from "os";
import { reverse } from "dns/promises";
import { readdir, access } from "fs/promises";
import { parseArgs } from "util";
import { execSync } from "child_process";
import { readFileSync } from "fs";

// ── Native RetroArch (optional) ─────────────────────────────────────────────
let native: typeof import("./native") | null = null;
try {
  native = await import("./native");
  const probe = native.probeNativeSupport();
  if (probe.supported) {
    const cores = Object.entries(probe.cores).filter(([, ok]) => ok).map(([s]) => s);
    console.log(`[native] Supported — cores: ${cores.join(", ")}`);
  } else {
    console.log(`[native] Not supported (retroarch=${probe.retroarch} cage=${probe.cage} seatd=${probe.seatd})`);
    native = null;
  }
} catch (e: any) {
  console.log(`[native] Disabled: ${e.message}`);
}

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: process.env.PORT || "3333" },
    "https-port": { type: "string", default: process.env.HTTPS_PORT || "3334" },
    "tls-cert": { type: "string", default: process.env.TLS_CERT },
    "tls-key": { type: "string", default: process.env.TLS_KEY },
  },
  strict: false,
});

const PORT = Number(args.port);
const HTTPS_PORT = Number(args["https-port"]);
const TLS_CERT = args["tls-cert"];
const TLS_KEY = args["tls-key"];
const ROOT_DIR = import.meta.dir;
const EMULATORJS_DIR = join(ROOT_DIR, "EmulatorJS");

// WebSocket routing maps
const screens = new Map<string, any>();      // screenId -> ws
const controllers = new Map<string, { ws: any; screenId: string; playerNum: number }>();

// Extensions that benefit from gzip compression
const COMPRESSIBLE_EXTS = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".wasm", ".data", ".mem"]);

// Essential MIME types only
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".data": "application/octet-stream",
  ".mem": "application/octet-stream",
};

// CORS headers
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// Cross-origin isolation headers — enables SharedArrayBuffer for WASM threads
// Using "credentialless" instead of "require-corp" so cross-origin resources load without CORP headers
const coiHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function getHeaders(req: Request): Record<string, string> {
  return { ...corsHeaders, ...coiHeaders };
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

async function serveFile(path: string, req: Request): Promise<Response | null> {
  try {
    const f = file(path);
    if (!(await f.exists())) return null;

    const stats = { mtime: f.lastModified, size: f.size };
    const etag = `"${stats.mtime}-${stats.size}"`;
    const ext = extname(path).toLowerCase();
    const isHtml = ext === ".html";

    if (!isHtml && req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: getHeaders(req) });
    }

    const baseHeaders: Record<string, string> = {
      "Content-Type": getMimeType(path),
      ...(isHtml ? {} : { "ETag": etag }),
      "Cache-Control": isHtml ? "no-store, no-cache, must-revalidate, max-age=0" : `public, max-age=3600`,
      ...(isHtml ? { "Pragma": "no-cache", "Expires": "0" } : {}),
      ...getHeaders(req),
    };

    if (COMPRESSIBLE_EXTS.has(ext) && req.headers.get("accept-encoding")?.includes("gzip")) {
      const compressed = Bun.gzipSync(await f.arrayBuffer());
      return new Response(compressed, {
        headers: { ...baseHeaders, "Content-Encoding": "gzip", "Content-Length": compressed.length.toString() },
      });
    }

    return new Response(f, { headers: { ...baseHeaders, "Content-Length": stats.size.toString() } });
  } catch {}
  return null;
}

const getLocalIP = (): string | null => {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
};
const LOCAL_IP = getLocalIP();

function getNextPlayerNumber(screenId: string): number {
  const usedNumbers = new Set<number>();
  for (const [, ctrl] of controllers) {
    if (ctrl.screenId === screenId) usedNumbers.add(ctrl.playerNum);
  }
  for (let i = 0; i < 4; i++) {
    if (!usedNumbers.has(i)) return i;
  }
  return usedNumbers.size;
}

function broadcastPlayerList(screenId: string) {
  const players: number[] = [];
  for (const [, ctrl] of controllers) {
    if (ctrl.screenId === screenId) players.push(ctrl.playerNum);
  }
  const msg = JSON.stringify({ type: "playerList", players });
  for (const [, ctrl] of controllers) {
    if (ctrl.screenId === screenId) ctrl.ws.send(msg);
  }
}

// === BT CONTROLLER DETECTION & POLLING ===
function detectControllerType(name: string): string {
  const n = name.toLowerCase();
  if (n === 'wireless controller' || n.includes('dualshock') || n.includes('dualsense')) return 'playstation';
  if (n.includes('xbox')) return 'xbox';
  if (n.includes('gamesir')) return 'gamesir';
  if (n.includes('pro controller') || n.includes('joy-con')) return 'switch';
  if (n.includes('8bitdo')) return '8bitdo';
  return 'generic';
}

function getControllerDisplayName(name: string, type: string): string {
  switch (type) {
    case 'playstation': return name.toLowerCase().includes('dualsense') ? 'DualSense' : 'DS4';
    case 'xbox': return 'Xbox';
    case 'gamesir': return 'GameSir';
    case 'switch': return name.includes('Joy-Con') ? 'Joy-Con' : 'Switch Pro';
    case '8bitdo': return '8BitDo';
    default: return name.length > 12 ? name.substring(0, 12) : name;
  }
}

type BtController = { name: string; displayName: string; address: string; inputActive: boolean; type: string; rssi: number | null; battery: number | null; batteryStatus: string | null; connectionType: string };
let lastBtStateJson = '[]';

const isLinux = process.platform === "linux";

function getBtControllers(): BtController[] {
  if (!isLinux) return [];
  const result: BtController[] = [];
  const inputDevicesRaw = readFileSync("/proc/bus/input/devices", "utf-8");
  const inputDevicesLower = inputDevicesRaw.toLowerCase();

  // ── Bluetooth controllers ──
  try {
    const devicesRaw = execSync("bluetoothctl devices Connected 2>/dev/null", { timeout: 2000, encoding: "utf-8" }).trim();
    if (devicesRaw) {
      for (const line of devicesRaw.split("\n")) {
        const match = line.match(/^Device\s+([0-9A-Fa-f:]+)\s+(.+)$/);
        if (!match) continue;
        const [, address, name] = match;

        let icon = "device";
        try {
          const info = execSync(`bluetoothctl info ${address} 2>/dev/null`, { timeout: 1500, encoding: "utf-8" });
          const iconMatch = info.match(/Icon:\s*(\S+)/);
          if (iconMatch) icon = iconMatch[1];
        } catch {}

        if (icon !== "input-gaming") continue;

        const inputActive = inputDevicesLower.includes(address.toLowerCase());
        const type = detectControllerType(name);
        const displayName = getControllerDisplayName(name, type);

        let rssi: number | null = null;
        try {
          const rssiOut = execSync(`hcitool rssi ${address} 2>/dev/null`, { timeout: 1000, encoding: "utf-8" }).trim();
          const rssiMatch = rssiOut.match(/RSSI return value:\s*(-?\d+)/);
          if (rssiMatch) rssi = Math.round(parseInt(rssiMatch[1]) / 3) * 3;
        } catch {}

        let battery: number | null = null;
        let batteryStatus: string | null = null;
        try {
          const addrLower = address.toLowerCase();
          const { readdirSync } = require("fs");
          const entries: string[] = readdirSync("/sys/class/power_supply");
          const psMatch = entries.find((e: string) => e.toLowerCase().includes(addrLower));
          if (psMatch) {
            battery = parseInt(readFileSync(`/sys/class/power_supply/${psMatch}/capacity`, "utf-8").trim());
            batteryStatus = readFileSync(`/sys/class/power_supply/${psMatch}/status`, "utf-8").trim();
          }
        } catch {}

        result.push({ name, displayName, address, inputActive, type, rssi, battery, batteryStatus, connectionType: "bluetooth" });
      }
    }
  } catch {}

  // ── USB/dongle controllers ──
  try {
    const btAddresses = new Set(result.map(c => c.address.toLowerCase()));
    const blocks = inputDevicesRaw.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      const get = (p: string) => lines.find((l) => l.startsWith(p))?.slice(p.length).trim() || "";
      const handlers = get("H: Handlers=");

      // Must be a joystick (has jsN handler)
      if (!handlers.match(/\bjs\d+\b/)) continue;

      const iLine = get("I: ");
      const bus = iLine.match(/Bus=(\w+)/)?.[1] || "";

      // Skip BT devices (already handled above) — bus 0005 = Bluetooth
      if (bus === "0005") continue;

      const name = get("N: Name=").replace(/^"|"$/g, "");
      const uniq = get("U: Uniq=");
      const eventMatch = handlers.match(/\bevent(\d+)\b/);
      const eventPath = eventMatch ? `/dev/input/event${eventMatch[1]}` : "";

      // Use eventPath as address for USB devices (unique identifier)
      const address = `usb:${eventPath}`;

      const type = detectControllerType(name);
      const displayName = getControllerDisplayName(name, type);
      const connLabel = name.toLowerCase().includes("2.4g") || name.toLowerCase().includes("dongle")
        ? "dongle" : "usb";

      result.push({
        name,
        displayName,
        address,
        inputActive: true,
        type,
        rssi: null,
        battery: null,
        batteryStatus: null,
        connectionType: connLabel,
      });
    }
  } catch {}

  return result;
}

function broadcastBtState(list: BtController[]) {
  const msg = JSON.stringify({ type: 'btControllersUpdate', controllers: list });
  for (const [, ws] of screens) {
    try { ws.send(msg); } catch {}
  }
}

function pollBtState() {
  const list = getBtControllers();
  const json = JSON.stringify(list);
  if (json !== lastBtStateJson) {
    lastBtStateJson = json;
    broadcastBtState(list);
  }
}

const serverConfig = {
  hostname: "0.0.0.0",
  development: true,

  async fetch(req: Request, server: any) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getHeaders(req) });
    }

    if (pathname === "/ws") {
      if (server.upgrade(req, { data: { id: null, type: null, screenId: null } })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Cheats API — parses RetroArch .cht files for EmulatorJS
    if (pathname === "/api/cheats") {
      const game = url.searchParams.get("game");
      const system = url.searchParams.get("system");
      if (!game || !system) {
        return new Response(JSON.stringify({ cheats: [], error: "Missing game or system param" }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      }
      const cheatCoreMap: Record<string, string> = {
        n64: "n64", parallel_n64: "n64", mupen64plus_next: "n64",
        psx: "psx", mednafen_psx_hw: "psx", pcsx_rearmed: "psx",
        snes: "snes", nes: "nes", gba: "gba",
        segaMD: "segaMD", arcade: "arcade",
      };
      const cheatDir = cheatCoreMap[system];
      if (!cheatDir) {
        return new Response(JSON.stringify({ cheats: [] }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      }
      const cheatFile = join(ROOT_DIR, "cheats", cheatDir, `${game}.cht`);
      try {
        const content = await Bun.file(cheatFile).text();
        const cheats: [string, string][] = [];
        const lines = content.split("\n");
        let desc = "", code = "";
        for (const line of lines) {
          const descMatch = line.match(/^cheat\d+_desc\s*=\s*"(.+)"/);
          const codeMatch = line.match(/^cheat\d+_code\s*=\s*"(.+)"/);
          if (descMatch) desc = descMatch[1];
          if (codeMatch) {
            code = codeMatch[1];
            if (desc && code) {
              cheats.push([desc, code]);
              desc = ""; code = "";
            }
          }
        }
        return new Response(JSON.stringify({ cheats }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      } catch {
        return new Response(JSON.stringify({ cheats: [] }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      }
    }

    // Bluetooth controllers — reads connected game controllers from system
    if (pathname === "/api/bt-controllers") {
      try {
        return new Response(JSON.stringify({ controllers: getBtControllers() }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      } catch (e: any) {
        return new Response(JSON.stringify({ controllers: [], error: e.message }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      }
    }

    if (pathname === "/api/network-info") {
      // Include active connection info (WiFi SSID or Ethernet)
      let connection = { type: "unknown", name: "" };
      try {
        const result = Bun.spawnSync({ cmd: ["nmcli", "-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"] });
        const lines = result.stdout.toString().trim().split("\n");
        for (const line of lines) {
          const [name, type, device] = line.split(":");
          if (type === "802-11-wireless") { connection = { type: "wifi", name }; break; }
          if (type === "802-3-ethernet" && connection.type !== "wifi") { connection = { type: "ethernet", name: device || name }; }
        }
      } catch {}
      return new Response(JSON.stringify({ ip: LOCAL_IP, port: PORT, url: LOCAL_IP ? `http://${LOCAL_IP}:${PORT}` : null, connection }),
        { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    if (pathname === "/api/screens") {
      const screenList = Array.from(screens.keys()).map(id => ({
        id, controllers: Array.from(controllers.values()).filter(c => c.screenId === id).length
      }));
      return new Response(JSON.stringify(screenList), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    if (pathname === "/api/client-hostname") {
      const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || server.requestIP(req)?.address || "unknown";
      let hostname = clientIP;
      try {
        const hostnames = await reverse(clientIP);
        if (hostnames.length > 0) hostname = hostnames[0].split(".")[0];
      } catch {
        try {
          const proc = Bun.spawn(["arp", "-a"], { stdout: "pipe", stderr: "ignore" });
          const output = await new Response(proc.stdout).text();
          const match = output.match(new RegExp(`([\\w-]+)(?:\\.local)?\\s+\\(${clientIP.replace(/\./g, '\\.')}\\)`));
          if (match) hostname = match[1];
        } catch {}
      }
      return new Response(JSON.stringify({ hostname, ip: clientIP }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    // Dynamic presets API - scans presets directory structure
    if (pathname === "/api/presets") {
      const presetsDir = join(ROOT_DIR, "presets");
      const presets: Record<string, Record<string, Array<{ name: string; rom: string; bios?: string; parentRom?: string }>>> = {};

      // Special games that have their own directory with bios/parent rom requirements
      // Key format: "gameDirName" -> { bios path relative to game dir, parentRom path }
      const specialGames: Record<string, { biosFile?: string; parentRomFile?: string }> = {
        "kof99ae": { biosFile: "neogeo.zip", parentRomFile: "kof99.zip" },
      };

      try {
        const cores = await readdir(presetsDir, { withFileTypes: true });

        for (const core of cores) {
          if (!core.isDirectory() || core.name === "bios") continue;

          const coreDir = join(presetsDir, core.name);
          const coreName = core.name;
          presets[coreName] = {};

          const items = await readdir(coreDir, { withFileTypes: true });

          for (const item of items) {
            if (!item.isDirectory()) continue;

            const itemPath = join(coreDir, item.name);
            const relativePath = `presets/${coreName}/${item.name}`;

            // Check if this is a player count directory (2p, 3p, 4p, etc.)
            if (/^\d+p$/.test(item.name)) {
              const playerCount = item.name;
              if (!presets[coreName][playerCount]) presets[coreName][playerCount] = [];

              const roms = await readdir(itemPath, { withFileTypes: true });
              for (const rom of roms) {
                if (rom.isFile() && /\.(zip|7z|gba|gbc|gb|nes|sfc|smc|n64|z64|v64|bin|cue|iso|md|gen|smd|gg|sms|nds)$/i.test(rom.name)) {
                  const gameName = rom.name.replace(/\.(zip|7z|gba|gbc|gb|nes|sfc|smc|n64|z64|v64|bin|cue|iso|md|gen|smd|gg|sms|nds)$/i, "");
                  presets[coreName][playerCount].push({
                    name: gameName,
                    rom: `${relativePath}/${rom.name}`,
                  });
                } else if (rom.isDirectory()) {
                  // Check for special game subdirectory (like kof99 inside 2p/)
                  const special = specialGames[rom.name];
                  if (special) {
                    const gameDir = join(itemPath, rom.name);
                    const gameDirRelative = `${relativePath}/${rom.name}`;
                    const gameFiles = await readdir(gameDir, { withFileTypes: true });
                    const mainRom = gameFiles.find(r => r.isFile() && r.name === `${rom.name}.zip`);
                    if (mainRom) {
                      presets[coreName][playerCount].push({
                        name: rom.name.toUpperCase().replace(/([a-z])(\d)/gi, "$1 $2"),
                        rom: `${gameDirRelative}/${mainRom.name}`,
                        ...(special.biosFile && { bios: `${gameDirRelative}/${special.biosFile}` }),
                        ...(special.parentRomFile && { parentRom: `${gameDirRelative}/${special.parentRomFile}` }),
                      });
                    }
                  }
                }
              }
            } else {
              // Legacy: Special game directory at core level (like arcade/kof99)
              const special = specialGames[item.name];
              if (special) {
                const roms = await readdir(itemPath, { withFileTypes: true });
                const mainRom = roms.find(r => r.isFile() && r.name === `${item.name}.zip`);
                if (mainRom) {
                  if (!presets[coreName]["2p"]) presets[coreName]["2p"] = [];
                  presets[coreName]["2p"].push({
                    name: item.name.toUpperCase().replace(/([a-z])(\d)/gi, "$1 $2"),
                    rom: `${relativePath}/${mainRom.name}`,
                    ...(special.biosFile && { bios: `${relativePath}/${special.biosFile}` }),
                    ...(special.parentRomFile && { parentRom: `${relativePath}/${special.parentRomFile}` }),
                  });
                }
              }
            }
          }

          // Sort games alphabetically within each player count
          for (const pc of Object.keys(presets[coreName])) {
            presets[coreName][pc].sort((a, b) => a.name.localeCompare(b.name));
          }

          // Remove empty cores
          if (Object.keys(presets[coreName]).length === 0) {
            delete presets[coreName];
          }
        }

        return new Response(JSON.stringify(presets), {
          headers: { "Content-Type": "application/json", ...getHeaders(req) }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to scan presets" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...getHeaders(req) }
        });
      }
    }

    // ── Native RetroArch API ──────────────────────────────────────────────
    if (pathname === "/api/native/status") {
      if (!native) return new Response(JSON.stringify({ state: "idle", supported: false, cores: {} }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      return new Response(JSON.stringify(native.getNativeStatus()), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    if (pathname === "/api/native/launch" && req.method === "POST") {
      if (!native) return new Response(JSON.stringify({ ok: false, error: "Native mode not available" }), { status: 400, headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      try {
        const body = await req.json() as { core?: string; rom?: string; coreOptions?: Record<string, string> };
        if (!body.core || !body.rom) return new Response(JSON.stringify({ ok: false, error: "Missing core or rom" }), { status: 400, headers: { "Content-Type": "application/json", ...getHeaders(req) } });

        // Resolve ROM path (relative to ROOT_DIR or absolute)
        const romPath = body.rom.startsWith("/") ? body.rom : join(ROOT_DIR, body.rom);

        const result = await native.launchNative(body.core, romPath, {
          coreOptions: body.coreOptions,
          onExit: (code, signal) => {
            // Broadcast native exit to all screens + controllers
            const msg = JSON.stringify({ type: "nativeExit", code, signal });
            for (const [, ws] of screens) { try { ws.send(msg); } catch {} }
            for (const [, ctrl] of controllers) { try { ctrl.ws.send(msg); } catch {} }
          },
        });
        const status = result.ok ? 200 : 400;
        return new Response(JSON.stringify(result), { status, headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      }
    }

    if (pathname === "/api/native/quit" && req.method === "POST") {
      if (!native) return new Response(JSON.stringify({ ok: false, error: "Native mode not available" }), { status: 400, headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      const result = native.quitNative();
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    if (pathname === "/api/native/cores") {
      if (!native) return new Response(JSON.stringify({ supported: false, cores: {} }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
      const probe = native.probeNativeSupport();
      return new Response(JSON.stringify({ supported: probe.supported, cores: probe.cores }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    if (pathname !== "/" && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    if (pathname === "/") pathname = "/screen.html";

    if (pathname.startsWith("/EmulatorJS/")) {
      const res = await serveFile(join(EMULATORJS_DIR, pathname.slice(12)), req);
      if (res) return res;
    }

    let res = await serveFile(join(ROOT_DIR, pathname), req);
    if (res) return res;

    if (!pathname.includes(".")) {
      res = await serveFile(join(ROOT_DIR, pathname + ".html"), req);
      if (res) return res;
    }

    res = await serveFile(join(ROOT_DIR, pathname, "index.html"), req);
    if (res) return res;

    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain", ...getHeaders(req) } });
  },

  websocket: {
    open(ws) {},

    async message(ws, message) {
      const data = typeof message === "string" ? message : new TextDecoder().decode(message);
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      const wsData = ws.data as { id: string | null; type: string | null; screenId: string | null };

      if (msg.type === "register-screen") {
        const screenId = msg.screenId;
        if (!screenId) { ws.send(JSON.stringify({ type: "error", error: "Missing screenId" })); return; }
        const existing = screens.get(screenId);
        if (existing && existing !== ws) try { existing.close(); } catch {}
        screens.set(screenId, ws);
        wsData.id = screenId;
        wsData.type = "screen";
        console.log(`Screen registered: ${screenId}`);
        ws.send(JSON.stringify({ type: "registered", screenId }));
        // Send current BT controller state
        try { ws.send(JSON.stringify({ type: 'btControllersUpdate', controllers: JSON.parse(lastBtStateJson) })); } catch {}
        return;
      }

      if (msg.type === "register-controller") {
        const { controllerId, screenId, requestedPlayerNum } = msg;
        if (!controllerId || !screenId) { ws.send(JSON.stringify({ type: "error", error: "Missing controllerId or screenId" })); return; }
        const screenWs = screens.get(screenId);
        const nativeRunning = native && native.getNativeStatus().state !== 'idle';
        if (!screenWs && !nativeRunning) { ws.send(JSON.stringify({ type: "error", error: "Screen not found" })); return; }

        const existing = controllers.get(controllerId);
        let playerNum: number;

        // Check if a specific player slot was requested
        if (typeof requestedPlayerNum === 'number' && requestedPlayerNum >= 0 && requestedPlayerNum < 4) {
          // Check if this slot is already taken by another controller
          const slotTaken = Array.from(controllers.entries()).some(
            ([id, ctrl]) => ctrl.screenId === screenId && ctrl.playerNum === requestedPlayerNum && id !== controllerId
          );
          if (slotTaken) {
            console.log(`Controller ${controllerId} rejected: Player ${requestedPlayerNum + 1} slot already taken on screen ${screenId}`);
            ws.send(JSON.stringify({ type: "error", error: "Player slot already taken", code: "player-slot-taken", requestedPlayer: requestedPlayerNum + 1 }));
            return;
          }
          playerNum = requestedPlayerNum;
        } else {
          // Auto-assign next available slot
          playerNum = existing?.screenId === screenId ? existing.playerNum : getNextPlayerNumber(screenId);
        }

        controllers.set(controllerId, { ws, screenId, playerNum });
        wsData.id = controllerId;
        wsData.type = "controller";
        wsData.screenId = screenId;
        console.log(`Controller registered: ${controllerId} -> screen ${screenId} (Player ${playerNum + 1})${typeof requestedPlayerNum === 'number' ? ' [requested]' : ''}`);
        ws.send(JSON.stringify({ type: "registered", controllerId, playerNum }));
        if (screenWs) screenWs.send(JSON.stringify({ type: "controller-connected", controllerId, playerNum }));
        broadcastPlayerList(screenId);
        // Send native state if active (screen may be dead during native mode)
        if (nativeRunning) {
          ws.send(JSON.stringify({ type: "nativeState", ...native!.getNativeStatus() }));
        }
        return;
      }

      if (msg.type === "heartbeat") { ws.send(JSON.stringify({ type: "heartbeat-ack" })); return; }

      // ── Native RetroArch WebSocket commands ─────────────────────────────
      if (msg.type === "getNativeState") {
        if (!native) { ws.send(JSON.stringify({ type: "nativeState", state: "idle", supported: false, cores: {} })); return; }
        ws.send(JSON.stringify({ type: "nativeState", ...native.getNativeStatus() })); return;
      }

      if (msg.type === "launchNative") {
        if (!native) { ws.send(JSON.stringify({ type: "nativeLaunchResult", ok: false, error: "Native mode not available" })); return; }
        const romPath = msg.rom?.startsWith("/") ? msg.rom : join(ROOT_DIR, msg.rom || "");
        const result = await native.launchNative(msg.core, romPath, {
          coreOptions: msg.coreOptions,
          onExit: (code, signal) => {
            const exitMsg = JSON.stringify({ type: "nativeExit", code, signal });
            for (const [, sws] of screens) { try { sws.send(exitMsg); } catch {} }
            for (const [, ctrl] of controllers) { try { ctrl.ws.send(exitMsg); } catch {} }
          },
        });
        ws.send(JSON.stringify({ type: "nativeLaunchResult", ...result, core: msg.core, rom: msg.rom }));
        if (result.ok) {
          // Broadcast to all clients
          const stateMsg = JSON.stringify({ type: "nativeState", ...native.getNativeStatus() });
          for (const [, sws] of screens) { try { sws.send(stateMsg); } catch {} }
          for (const [, ctrl] of controllers) { try { ctrl.ws.send(stateMsg); } catch {} }
        }
        return;
      }

      if (msg.type === "quitNative") {
        if (!native) { ws.send(JSON.stringify({ type: "nativeQuitResult", ok: false, error: "Native mode not available" })); return; }
        const result = native.quitNative();
        ws.send(JSON.stringify({ type: "nativeQuitResult", ...result })); return;
      }

      // WebRTC signaling relay
      if (msg.type === "webrtc-offer") {
        const screenWs = screens.get(wsData.screenId!);
        if (screenWs) screenWs.send(JSON.stringify({ type: "webrtc-offer", from: wsData.id, offer: msg.offer }));
        return;
      }
      if (msg.type === "webrtc-answer") {
        const ctrl = controllers.get(msg.to);
        if (ctrl) ctrl.ws.send(JSON.stringify({ type: "webrtc-answer", answer: msg.answer }));
        return;
      }
      if (msg.type === "ice-candidate") {
        if (wsData.type === "controller") {
          const screenWs = screens.get(wsData.screenId!);
          if (screenWs) screenWs.send(JSON.stringify({ type: "ice-candidate", from: wsData.id, candidate: msg.candidate }));
        } else if (wsData.type === "screen") {
          const ctrl = controllers.get(msg.to);
          if (ctrl) ctrl.ws.send(JSON.stringify({ type: "ice-candidate", candidate: msg.candidate }));
        }
        return;
      }

      // Route other messages
      if (wsData.type === "controller") {
        const ctrl = controllers.get(wsData.id!);
        if (!ctrl) return;
        const screenWs = screens.get(ctrl.screenId);
        if (!screenWs) return;
        if (msg.method === "input.simulate" && msg.params) msg.params.player = ctrl.playerNum;
        msg.controllerId = wsData.id;
        msg.playerNum = ctrl.playerNum;
        screenWs.send(JSON.stringify(msg));
      } else if (wsData.type === "screen") {
        if (msg.targetController) {
          const ctrl = controllers.get(msg.targetController);
          if (ctrl && ctrl.screenId === wsData.id) ctrl.ws.send(JSON.stringify(msg));
        } else {
          for (const [, ctrl] of controllers) {
            if (ctrl.screenId === wsData.id) ctrl.ws.send(JSON.stringify(msg));
          }
        }
      }
    },

    close(ws) {
      const wsData = ws.data as { id: string | null; type: string | null; screenId: string | null };
      if (wsData.type === "screen" && wsData.id) {
        console.log(`Screen disconnected: ${wsData.id}`);
        screens.delete(wsData.id);
        for (const [, ctrl] of controllers) {
          if (ctrl.screenId === wsData.id) ctrl.ws.send(JSON.stringify({ type: "screen-disconnected" }));
        }
      } else if (wsData.type === "controller" && wsData.id) {
        const ctrl = controllers.get(wsData.id);
        if (ctrl) {
          const screenId = ctrl.screenId;
          console.log(`Controller disconnected: ${wsData.id} (Player ${ctrl.playerNum + 1})`);
          const screenWs = screens.get(screenId);
          if (screenWs) screenWs.send(JSON.stringify({ type: "controller-disconnected", controllerId: wsData.id, playerNum: ctrl.playerNum }));
          controllers.delete(wsData.id);
          broadcastPlayerList(screenId);
        }
      }
    },
  },
};

// HTTP server
serve({ ...serverConfig, port: PORT });

// HTTPS server (only if TLS cert provided)
let httpsEnabled = false;
if (TLS_CERT && TLS_KEY) {
  try {
    await access(TLS_CERT);
    await access(TLS_KEY);
    serve({
      ...serverConfig,
      port: HTTPS_PORT,
      tls: {
        certFile: TLS_CERT,
        keyFile: TLS_KEY,
      },
    });
    httpsEnabled = true;
  } catch (e) {
    console.warn(`HTTPS disabled: ${e}`);
  }
}

// Start BT controller polling (broadcasts changes to all screens via WebSocket)
// Slow down during gameplay to reduce CPU overhead
let btPollInterval: ReturnType<typeof setInterval>;
function startBtPolling(intervalMs = 2000) {
  if (btPollInterval) clearInterval(btPollInterval);
  btPollInterval = setInterval(pollBtState, intervalMs);
}
if (isLinux) {
  startBtPolling(5000);
  setTimeout(pollBtState, 500);
}

console.log(`
RetroBox Server (WebSocket + WebRTC Signaling)
  HTTP:    http://localhost:${PORT}${httpsEnabled ? `\n  HTTPS:   https://localhost:${HTTPS_PORT}` : ""}
  ${LOCAL_IP ? `Network: http://${LOCAL_IP}:${PORT}` : ""}${httpsEnabled && LOCAL_IP ? `\n  Network: https://${LOCAL_IP}:${HTTPS_PORT}` : ""}
  Root:    ${ROOT_DIR}
`);
