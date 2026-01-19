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

## Running with Docker

```bash
docker build -t retrobox .

docker run -d --name retrobox -p 3333:3333 \
  -e HOST_IP=$(ipconfig getifaddr en0) \
  -v $(pwd)/EmulatorJS:/app/EmulatorJS \
  -v $(pwd)/presets:/app/presets \
  -v $(pwd)/bios:/app/bios \
  retrobox
```

> **Note:** `HOST_IP` is required on macOS so LAN devices can discover the correct IP.
On Linux, use `hostname -I | awk '{print $1}'` instead.
