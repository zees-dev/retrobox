# RetroBox

EmulatorJS-based retro gaming frontend with remote controller support.

## Prerequisites

- [Bun](https://bun.sh/) (for local development)
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)
- [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) directory
  - Note: this has been modified to support decoupled screen/controller architecture (source uploaded upon request)

## Running Locally

```bash
bun run server.ts
```

Server runs at http://localhost:3333

Native mode uses RetroArch and its cores from `/run/current-system/sw`. The
`gamecube` and `wii` native system IDs load `dolphin_libretro.so` with Vulkan,
using a separate copy of the kiosk configuration for each launch. Dolphin runs
in single-core mode (`dolphin_main_cpu_thread = "disabled"`) to avoid a CPU/GPU
frame handshake stall on the Pi 5. Other built-in defaults are preserved;
explicit core options use the shared `dolphin-emu` options directory.
The matching Dolphin Sys assets belong at
`~/.config/retroarch/system/dolphin-emu/Sys` under the kiosk home. The Nix wrapper
supplies the current assets, controller autoconfiguration, and core paths.

## Running with Docker

```bash
docker build -t retrobox .

docker run -d --name retrobox -p 3333:3333 \
  -e HOST_IP=$(ipconfig getifaddr en0) \
  -v $(pwd)/EmulatorJS:/app/EmulatorJS \
  -v $(pwd)/presets:/app/presets \
  retrobox
```

> **Note:** `HOST_IP` is required on macOS so LAN devices can discover the correct IP.  
On Linux, use `hostname -I | awk '{print $1}'` instead.
