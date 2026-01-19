import { serve, file } from "bun";
import { join, extname } from "path";
import { networkInterfaces } from "os";
import { reverse } from "dns/promises";

const PORT = process.env.PORT || 3333;
const ROOT_DIR = import.meta.dir;
const EMULATORJS_DIR = join(ROOT_DIR, "EmulatorJS");

// WebSocket routing maps
const screens = new Map<string, any>();      // screenId → ws
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

// Cross-origin isolation (localhost only)
const coiHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function getHeaders(req: Request): Record<string, string> {
  const host = req.headers.get("host") || "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return isLocal ? { ...corsHeaders, ...coiHeaders } : corsHeaders;
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

async function serveFile(path: string, req: Request): Promise<Response | null> {
  try {
    const f = file(path);
    if (!(await f.exists())) return null;

    // Generate ETag from mtime and size
    const stats = { mtime: f.lastModified, size: f.size };
    const etag = `"${stats.mtime}-${stats.size}"`;

    // Check If-None-Match for 304 Not Modified
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: getHeaders(req) });
    }

    const ext = extname(path).toLowerCase();
    const baseHeaders: Record<string, string> = {
      "Content-Type": getMimeType(path),
      "ETag": etag,
      "Cache-Control": "public, max-age=31536000, immutable",
      ...getHeaders(req),
    };

    // Check if file is compressible and client accepts gzip
    const isCompressible = COMPRESSIBLE_EXTS.has(ext);
    const acceptsGzip = req.headers.get("accept-encoding")?.includes("gzip");

    if (isCompressible && acceptsGzip) {
      // Compress on-the-fly
      const compressed = Bun.gzipSync(await f.arrayBuffer());
      return new Response(compressed, {
        headers: {
          ...baseHeaders,
          "Content-Encoding": "gzip",
          "Content-Length": compressed.length.toString(),
        },
      });
    }

    // Serve uncompressed with Content-Length
    return new Response(f, {
      headers: {
        ...baseHeaders,
        "Content-Length": stats.size.toString(),
      },
    });
  } catch {}
  return null;
}

// Get local IP (HOST_IP env var for Docker, otherwise auto-detect)
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

// Get next available player number for a screen
function getNextPlayerNumber(screenId: string): number {
  const usedNumbers = new Set<number>();
  for (const [, ctrl] of controllers) {
    if (ctrl.screenId === screenId) {
      usedNumbers.add(ctrl.playerNum);
    }
  }
  for (let i = 0; i < 4; i++) {
    if (!usedNumbers.has(i)) return i;
  }
  return usedNumbers.size;
}

serve({
  port: PORT,
  hostname: "0.0.0.0",
  development: true,

  async fetch(req, server) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getHeaders(req) });
    }

    // WebSocket upgrade at /ws
    if (pathname === "/ws") {
      if (server.upgrade(req, { data: { id: null, type: null, screenId: null } })) {
        return;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Network info API
    if (pathname === "/api/network-info") {
      return new Response(JSON.stringify({
        ip: LOCAL_IP,
        port: PORT,
        url: LOCAL_IP ? `http://${LOCAL_IP}:${PORT}` : null
      }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    // List connected screens API (for debugging)
    if (pathname === "/api/screens") {
      const screenList = Array.from(screens.keys()).map(id => {
        const controllerCount = Array.from(controllers.values()).filter(c => c.screenId === id).length;
        return { id, controllers: controllerCount };
      });
      return new Response(JSON.stringify(screenList), {
        headers: { "Content-Type": "application/json", ...getHeaders(req) }
      });
    }

    // Client hostname API
    if (pathname === "/api/client-hostname") {
      const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || server.requestIP(req)?.address
        || "unknown";
      let hostname = clientIP;

      try {
        const hostnames = await reverse(clientIP);
        if (hostnames.length > 0) {
          hostname = hostnames[0].split(".")[0];
        }
      } catch {
        try {
          const proc = Bun.spawn(["arp", "-a"], { stdout: "pipe", stderr: "ignore" });
          const output = await new Response(proc.stdout).text();
          const regex = new RegExp(`([\\w-]+)(?:\\.local)?\\s+\\(${clientIP.replace(/\./g, '\\.')}\\)`);
          const match = output.match(regex);
          if (match) hostname = match[1];
        } catch {}
      }
      return new Response(JSON.stringify({ hostname, ip: clientIP }), {
        headers: { "Content-Type": "application/json", ...getHeaders(req) }
      });
    }

    // Normalize paths
    if (pathname !== "/" && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    if (pathname === "/") pathname = "/screen.html";

    // EmulatorJS files
    if (pathname.startsWith("/EmulatorJS/")) {
      const res = await serveFile(join(EMULATORJS_DIR, pathname.slice(12)), req);
      if (res) return res;
    }

    // Static files
    let res = await serveFile(join(ROOT_DIR, pathname), req);
    if (res) return res;

    // Clean URLs
    if (!pathname.includes(".")) {
      res = await serveFile(join(ROOT_DIR, pathname + ".html"), req);
      if (res) return res;
    }

    // Index fallback
    res = await serveFile(join(ROOT_DIR, pathname, "index.html"), req);
    if (res) return res;

    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain", ...getHeaders(req) } });
  },

  websocket: {
    open(ws) {
      // Connection opened, wait for registration message
    },

    message(ws, message) {
      const data = typeof message === "string" ? message : new TextDecoder().decode(message);
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      const wsData = ws.data as { id: string | null; type: string | null; screenId: string | null };

      // Handle registration messages
      if (msg.type === "register-screen") {
        const screenId = msg.screenId;
        if (!screenId) {
          ws.send(JSON.stringify({ type: "error", error: "Missing screenId" }));
          return;
        }
        // Close existing screen connection if any
        const existing = screens.get(screenId);
        if (existing && existing !== ws) {
          try { existing.close(); } catch {}
        }
        screens.set(screenId, ws);
        wsData.id = screenId;
        wsData.type = "screen";
        console.log(`Screen registered: ${screenId}`);
        ws.send(JSON.stringify({ type: "registered", screenId }));
        return;
      }

      if (msg.type === "register-controller") {
        const { controllerId, screenId } = msg;
        if (!controllerId || !screenId) {
          ws.send(JSON.stringify({ type: "error", error: "Missing controllerId or screenId" }));
          return;
        }
        const screenWs = screens.get(screenId);
        if (!screenWs) {
          ws.send(JSON.stringify({ type: "error", error: "Screen not found" }));
          return;
        }
        // Get or assign player number
        const existing = controllers.get(controllerId);
        const playerNum = existing?.screenId === screenId ? existing.playerNum : getNextPlayerNumber(screenId);

        controllers.set(controllerId, { ws, screenId, playerNum });
        wsData.id = controllerId;
        wsData.type = "controller";
        wsData.screenId = screenId;
        console.log(`Controller registered: ${controllerId} -> screen ${screenId} (Player ${playerNum + 1})`);

        // Notify controller of assignment
        ws.send(JSON.stringify({ type: "registered", controllerId, playerNum }));

        // Notify screen of new controller
        screenWs.send(JSON.stringify({ type: "controller-connected", controllerId, playerNum }));
        return;
      }

      // Handle heartbeat
      if (msg.type === "heartbeat") {
        ws.send(JSON.stringify({ type: "heartbeat-ack" }));
        return;
      }

      // Route messages based on connection type
      if (wsData.type === "controller") {
        // Controller -> Screen: forward input and commands
        const ctrl = controllers.get(wsData.id!);
        if (!ctrl) return;
        const screenWs = screens.get(ctrl.screenId);
        if (!screenWs) return;

        // Add player number to input messages
        if (msg.method === "input.simulate" && msg.params) {
          msg.params.player = ctrl.playerNum;
        }
        // Tag message with controller ID
        msg.controllerId = wsData.id;
        msg.playerNum = ctrl.playerNum;
        screenWs.send(JSON.stringify(msg));
      } else if (wsData.type === "screen") {
        // Screen -> Controller(s): forward state updates
        if (msg.targetController) {
          // Send to specific controller
          const ctrl = controllers.get(msg.targetController);
          if (ctrl && ctrl.screenId === wsData.id) {
            ctrl.ws.send(JSON.stringify(msg));
          }
        } else {
          // Broadcast to all controllers connected to this screen
          for (const [id, ctrl] of controllers) {
            if (ctrl.screenId === wsData.id) {
              ctrl.ws.send(JSON.stringify(msg));
            }
          }
        }
      }
    },

    close(ws) {
      const wsData = ws.data as { id: string | null; type: string | null; screenId: string | null };

      if (wsData.type === "screen" && wsData.id) {
        console.log(`Screen disconnected: ${wsData.id}`);
        screens.delete(wsData.id);
        // Notify all controllers connected to this screen
        for (const [id, ctrl] of controllers) {
          if (ctrl.screenId === wsData.id) {
            ctrl.ws.send(JSON.stringify({ type: "screen-disconnected" }));
          }
        }
      } else if (wsData.type === "controller" && wsData.id) {
        const ctrl = controllers.get(wsData.id);
        if (ctrl) {
          console.log(`Controller disconnected: ${wsData.id} (Player ${ctrl.playerNum + 1})`);
          // Notify screen
          const screenWs = screens.get(ctrl.screenId);
          if (screenWs) {
            screenWs.send(JSON.stringify({
              type: "controller-disconnected",
              controllerId: wsData.id,
              playerNum: ctrl.playerNum
            }));
          }
          controllers.delete(wsData.id);
        }
      }
    },
  },
});

console.log(`
RetroBox Server (WebSocket)
  Local:   http://localhost:${PORT}
  ${LOCAL_IP ? `Network: http://${LOCAL_IP}:${PORT}\n` : ""}  Root:    ${ROOT_DIR}
  WS:      ws://localhost:${PORT}/ws
`);
