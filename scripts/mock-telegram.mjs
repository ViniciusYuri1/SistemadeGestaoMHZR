// Imita a API do Telegram para testes locais. GET /calls lista as chamadas;
// POST /reset limpa; POST /fail-next {error_code, description, parameters} faz
// o próximo sendMessage falhar.
import http from "node:http";

let calls = [];
let failNext = null;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/calls") return send(calls);
    if (req.url === "/reset") { calls = []; failNext = null; return send({ ok: true }); }
    if (req.url === "/fail-next") { failNext = JSON.parse(body || "{}"); return send({ ok: true }); }
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)/);
    if (!m) return send({ ok: false });
    const method = m[2];
    const params = body ? JSON.parse(body) : {};
    calls.push({ method, params, at: Date.now() });
    if (method === "sendMessage" && failNext) { const f = failNext; failNext = null; return send(Object.assign({ ok: false }, f)); }
    switch (method) {
      case "getMe": return send({ ok: true, result: { id: 1, is_bot: true, first_name: "MHZR Teste", username: "mhzr_teste_bot", can_read_all_group_messages: false } });
      case "getChatMember": return send({ ok: true, result: { status: params.user_id === 999 ? "administrator" : "member" } });
      case "getWebhookInfo": return send({ ok: true, result: { url: "", pending_update_count: 0 } });
      case "sendMessage": return send({ ok: true, result: { message_id: calls.length, chat: { id: params.chat_id }, text: params.text } });
      default: return send({ ok: true, result: true });
    }
  });
}).listen(5600, "0.0.0.0", () => console.log("mock telegram on :5600"));
