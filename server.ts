import { serve, file } from "bun";
import { join, extname } from "path";
import { networkInterfaces } from "os";

const PORT = process.env.PORT || 3333;
const ROOT_DIR = import.meta.dir;
const EMULATORJS_DIR = join(ROOT_DIR, "EmulatorJS");

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
    if (await f.exists()) {
      return new Response(f, { headers: { "Content-Type": getMimeType(path), ...getHeaders(req) } });
    }
  } catch {}
  return null;
}

// Get local IP
const getLocalIP = (): string | null => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
};
const LOCAL_IP = getLocalIP();

serve({
  port: PORT,
  hostname: "0.0.0.0",
  development: true,

  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getHeaders(req) });
    }

    // Network info API
    if (pathname === "/api/network-info") {
      return new Response(JSON.stringify({
        ip: LOCAL_IP,
        port: PORT,
        url: LOCAL_IP ? `http://${LOCAL_IP}:${PORT}` : null
      }), { headers: { "Content-Type": "application/json", ...getHeaders(req) } });
    }

    // Normalize
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
});

console.log(`
RetroBox Server
  Local:   http://localhost:${PORT}
  ${LOCAL_IP ? `Network: http://${LOCAL_IP}:${PORT}\n` : ""}  Root:    ${ROOT_DIR}
`);
