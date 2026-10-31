/* Servidor estático para testar o sistema localmente (sem dependências).
   Uso: node scripts/dev-server.js  →  http://localhost:5500
   Em localhost o js/supabase-config.js aponta para o Supabase local (Docker). */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 5500;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2"
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = path.resolve(ROOT, "." + (urlPath === "/" ? "/index.html" : urlPath));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}.git${path.sep}`)) {
    res.writeHead(403).end("Proibido");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Não encontrado");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Sistema de Gestão (teste local): http://localhost:${PORT}`);
});
