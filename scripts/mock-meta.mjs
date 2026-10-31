// Imita a Graph API do Meta Ads para testes locais (porta 5601).
// Dados fixos com situações de alerta: campanha reprovada, campanha sem
// entrega ontem, custo por lead alto ontem, gasto de hoje acima do orçamento,
// limite de gastos quase atingido e uma conta com pagamento pendente.
// POST /token-invalid  → próximas chamadas respondem "token expirado" (190)
// POST /reset          → volta ao normal
import http from "node:http";

const TOKEN = "TESTE-META";
let tokenInvalid = false;
const day = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const ACCOUNTS = {
  act_1001: { id: "act_1001", account_id: "1001", name: "Panobianco Casa — Ads", currency: "BRL", account_status: 1, disable_reason: 0, amount_spent: "950000", balance: "12000", spend_cap: "1000000" },
  act_1002: { id: "act_1002", account_id: "1002", name: "Power Pedal — Ads", currency: "BRL", account_status: 3, disable_reason: 0, amount_spent: "120000", balance: "45000", spend_cap: "0" },
  act_1003: { id: "act_1003", account_id: "1003", name: "Conta sem cliente", currency: "BRL", account_status: 1, disable_reason: 0, amount_spent: "0", balance: "0", spend_cap: "0" }
};
const CAMPAIGNS = {
  act_1001: [
    { id: "c101", name: "Leads — Unidade Casa", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "5000", start_time: "2026-09-01T10:00:00-0300" },
    { id: "c102", name: "Remarketing site", status: "ACTIVE", effective_status: "DISAPPROVED", objective: "OUTCOME_TRAFFIC", daily_budget: "2000", start_time: "2026-09-10T10:00:00-0300" },
    { id: "c103", name: "Conversas WhatsApp", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: "3000", start_time: "2026-09-01T10:00:00-0300" },
    { id: "c104", name: "Campanha de agosto", status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_LEADS", daily_budget: "4000", start_time: "2026-08-01T10:00:00-0300" }
  ],
  act_1002: [
    { id: "c201", name: "Leads — Power Pedal", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "4000", start_time: "2026-10-01T10:00:00-0300" }
  ],
  act_1003: []
};

function insightRows(acc, preset) {
  const offsets = preset === "today" ? [0] : preset === "last_7d" ? [-7, -6, -5, -4, -3, -2, -1] : Array.from({ length: 30 }, (_, i) => i - 30);
  const rows = [];
  for (const o of offsets) {
    const d = day(o);
    if (acc === "act_1001") {
      // c101: leads; ontem caro (CPL R$ 60). Hoje gasta 70.
      const leads = o === -1 ? 1 : 3 + (Math.abs(o) % 3);
      const spend = o === 0 ? 70 : o === -1 ? 60 : 45 + (Math.abs(o) % 5) * 3;
      rows.push({ campaign_id: "c101", campaign_name: "Leads — Unidade Casa", date_start: d, date_stop: d, spend: spend.toFixed(2), impressions: "4200", reach: "3100", clicks: "85",
        actions: [{ action_type: "lead", value: String(leads) }, { action_type: "onsite_conversion.lead_grouped", value: String(leads) }, { action_type: "link_click", value: "85" }] });
      // c103: conversas; sem entrega ontem. Hoje gasta 40.
      if (o !== -1) rows.push({ campaign_id: "c103", campaign_name: "Conversas WhatsApp", date_start: d, date_stop: d, spend: (o === 0 ? 40 : 25).toFixed(2), impressions: "2600", reach: "2000", clicks: "40",
        actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "6" }] });
    }
    if (acc === "act_1002" && o < 0) {
      rows.push({ campaign_id: "c201", campaign_name: "Leads — Power Pedal", date_start: d, date_stop: d, spend: "38.00", impressions: "3000", reach: "2500", clicks: "60",
        actions: [{ action_type: "lead", value: "4" }] });
    }
  }
  return rows;
}

function page(list, url, size) {
  const after = Number(url.searchParams.get("after") || 0);
  const slice = list.slice(after, after + size);
  const out = { data: slice };
  if (after + size < list.length) out.paging = { cursors: { after: String(after + size) }, next: "https://graph.facebook.com/next" };
  return out;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "POST" && url.pathname === "/token-invalid") { tokenInvalid = true; return send(200, { ok: true }); }
  if (req.method === "POST" && url.pathname === "/reset") { tokenInvalid = false; return send(200, { ok: true }); }
  if (tokenInvalid || url.searchParams.get("access_token") !== TOKEN) {
    return send(400, { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } });
  }
  const parts = url.pathname.replace(/^\/v\d+\.\d+\//, "").split("/");
  if (parts[0] === "me" && parts[1] === "adaccounts") return send(200, page(Object.values(ACCOUNTS), url, 2));
  const acc = ACCOUNTS[parts[0]];
  if (!acc) return send(400, { error: { message: "Unsupported get request", code: 100 } });
  if (!parts[1]) return send(200, acc);
  if (parts[1] === "campaigns") return send(200, page(CAMPAIGNS[parts[0]], url, 3));
  if (parts[1] === "insights") return send(200, page(insightRows(parts[0], url.searchParams.get("date_preset")), url, 25));
  return send(404, { error: { message: "not found", code: 100 } });
}).listen(5601, "0.0.0.0", () => console.log("mock meta on :5601"));
