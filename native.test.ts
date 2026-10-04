import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

const paths: string[] = [];
let dolphinInstalled = false;
let dolphinConfig = "";
let dolphinOptions = "";
const child = new EventEmitter();
const spawn = mock((_command: string, _args: string[], _options: { env: NodeJS.ProcessEnv }) => child);
mock.module("fs", () => ({
  existsSync(path: string) {
    paths.push(path);
    return dolphinInstalled || !path.endsWith("dolphin_libretro.so");
  },
  mkdirSync: mock(), writeFileSync: mock(), readFileSync: mock(),
  readdirSync: mock(), rmSync: mock(),
}));
mock.module("child_process", () => ({
  execSync(command: string, options?: { input?: string }) {
    if (command.includes('tee "/var/cache/kiosk-home/.config/retroarch/config/dolphin-emu/dolphin-emu.opt"')) {
      dolphinOptions = options?.input || "";
    }
    if (command.includes('tee "/var/cache/kiosk-home/.config/retroarch/retrobox-dolphin.cfg"')) {
      dolphinConfig = options?.input || "";
    }
    if (command.includes('cat "/var/cache/kiosk-home/.config/retroarch/retroarch.cfg"')) {
      return ' \tvideo_driver = "gl"\nsystem_directory = "~/bios"\n';
    }
    return "active";
  },
  spawn,
}));

const { probeNativeSupport, launchNative } = await import("./native");

test("probe uses the activated core bundle and reports missing Dolphin for both systems", () => {
  const probe = probeNativeSupport();
  expect(probe.supported).toBe(true);
  expect(probe.cores.n64).toBe(true);
  expect(probe.cores.gamecube).toBe(false);
  expect(probe.cores.wii).toBe(false);
  expect(paths).toContain("/run/current-system/sw/bin/retroarch");
  expect(paths).toContain("/run/current-system/sw/lib/retroarch/cores/mupen64plus_next_gles3_libretro.so");
  expect(paths.filter(path => path.endsWith("dolphin_libretro.so"))).toEqual([
    "/run/current-system/sw/lib/retroarch/cores/dolphin_libretro.so",
    "/run/current-system/sw/lib/retroarch/cores/dolphin_libretro.so",
  ]);
  expect(paths.some(path => path.startsWith("/nix/store/"))).toBe(false);
});

test("Dolphin launch selects Vulkan without suppressing the wrapper or inheriting old libc", async () => {
  dolphinInstalled = true;
  const oldLibraryPath = process.env.LD_LIBRARY_PATH;
  process.env.LD_LIBRARY_PATH = "/old/libc";
  process.env.RETROBOX_TEST_KEEP = "preserved";
  try {
    expect(await launchNative("gamecube", "/games/test.rvz")).toEqual({ ok: true });
    const [, args, options] = spawn.mock.calls[0];
    expect(args).toContain("/var/cache/kiosk-home/.config/retroarch/retrobox-dolphin.cfg");
    expect(args).not.toContain("--appendconfig");
    expect(dolphinConfig).toContain('video_driver = "vulkan"');
    expect(dolphinConfig).not.toContain('video_driver = "gl"');
    expect(dolphinConfig).toContain('system_directory = "~/bios"');
    expect(dolphinOptions).toBe('dolphin_main_cpu_thread = "disabled"\n');
    expect(options.env.LD_LIBRARY_PATH).toBeUndefined();
    expect(options.env.RETROBOX_TEST_KEEP).toBe("preserved");
  } finally {
    child.emit("exit", 0, null);
    if (oldLibraryPath === undefined) delete process.env.LD_LIBRARY_PATH;
    else process.env.LD_LIBRARY_PATH = oldLibraryPath;
    delete process.env.RETROBOX_TEST_KEEP;
  }
});
