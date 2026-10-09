// senet — tiny Bun static server. Binds loopback only.
const PORT = Number(process.env.PORT || 3026);
const root = new URL("../public/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    const file = Bun.file(root + path.replace(/^\/+/, ""));
    if (await file.exists()) {
      const ext = path.slice(path.lastIndexOf("."));
      return new Response(file, { headers: { "Content-Type": TYPES[ext] || "application/octet-stream" } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`senet on http://127.0.0.1:${PORT}`);
