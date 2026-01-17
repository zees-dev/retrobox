import { serve, file } from "bun";
import { join, extname } from "path";
import { networkInterfaces } from "os";

const PORT = process.env.PORT || 3333;
const ROOT_DIR = import.meta.dir;
const EMULATORJS_DIR = join(ROOT_DIR, "EmulatorJS");

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".zip": "application/zip",
  ".rom": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".nes": "application/octet-stream",
  ".smc": "application/octet-stream",
  ".sfc": "application/octet-stream",
  ".gba": "application/octet-stream",
  ".gb": "application/octet-stream",
  ".gbc": "application/octet-stream",
  ".n64": "application/octet-stream",
  ".z64": "application/octet-stream",
  ".nds": "application/octet-stream",
  ".iso": "application/octet-stream",
  ".cue": "text/plain",
  ".ccd": "text/plain",
  ".chd": "application/octet-stream",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".data": "application/octet-stream",
  ".mem": "application/octet-stream",
};

// Base CORS headers - maximally permissive
const baseCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// Cross-origin isolation headers for SharedArrayBuffer (only work on localhost or HTTPS)
const crossOriginIsolationHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

// Get appropriate headers based on whether request is from localhost
function getCorsHeaders(req: Request): Record<string, string> {
  const host = req.headers.get("host") || "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  
  if (isLocalhost) {
    return { ...baseCorsHeaders, ...crossOriginIsolationHeaders };
  }
  return baseCorsHeaders;
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function serveFile(filePath: string, req: Request): Promise<Response | null> {
  try {
    const f = file(filePath);
    if (await f.exists()) {
      const mimeType = getMimeType(filePath);
      return new Response(f, {
        headers: {
          "Content-Type": mimeType,
          ...getCorsHeaders(req),
        },
      });
    }
  } catch (e) {
    // File doesn't exist or error reading
  }
  return null;
}

// Get local IP address
const getLocalIP: () => string | null = () => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
};
const LOCAL_IP = getLocalIP();

const server = serve({
  port: PORT,
  hostname: "0.0.0.0", // Bind to all interfaces for LAN access

  // Development mode for HMR and detailed errors
  development: true,

  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(req),
      });
    }

    // API endpoint for network info (LAN IP)
    if (url.pathname === "/api/network-info") {
      return new Response(JSON.stringify({
        ip: LOCAL_IP,
        port: PORT,
        url: LOCAL_IP ? `http://${LOCAL_IP}:${PORT}` : null
      }), {
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(req),
        },
      });
    }

    // Normalize path
    if (pathname !== "/" && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // Root -> screen.html
    if (pathname === "/") {
      pathname = "/screen.html";
    }

    // Try EmulatorJS directory first (worktree)
    if (pathname.startsWith("/EmulatorJS/")) {
      const relativePath = pathname.slice("/EmulatorJS/".length);
      const filePath = join(EMULATORJS_DIR, relativePath);
      const response = await serveFile(filePath, req);
      if (response) return response;
    }

    // Try to serve from root directory
    let filePath = join(ROOT_DIR, pathname);
    let response = await serveFile(filePath, req);
    if (response) return response;

    // Try with .html extension (clean URLs: /screen -> /screen.html)
    if (!pathname.includes(".")) {
      response = await serveFile(filePath + ".html", req);
      if (response) return response;
    }

    // Try index.html in subdirectory
    response = await serveFile(join(filePath, "index.html"), req);
    if (response) return response;

    // 404 Not Found
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        ...getCorsHeaders(req),
      },
    });
  },
});

console.log(`
🎮 RetroBox Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Local:      http://localhost:${PORT}
  ${LOCAL_IP ? `Network:    http://${LOCAL_IP}:${PORT}\n` : ""}
  Serving:    ${ROOT_DIR}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
