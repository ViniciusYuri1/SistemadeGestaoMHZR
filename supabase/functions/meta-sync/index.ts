// =============================================================================
// Edge Function "meta-sync" — métricas do Meta Ads (Graph API).
//
//   POST ?action=sync      (pg_cron, header x-sync-key)  → sincroniza todas
//                           as contas ativas e gera os alertas
//   POST ?action=sync-now  (admin logado)                → idem, sob demanda
//   POST ?action=accounts  (admin logado)                → contas de anúncio
//                           que o token enxerga (para ligar às empresas)
//
// Segredo: META_ACCESS_TOKEN (token do Usuário do sistema do Business
// Manager, com permissão ads_read nas contas). "Verify JWT" DESLIGADO.
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const GRAPH = (Deno.env.get("META_API_BASE") ?? "https://graph.facebook.com").replace(/\/$/, "") + "/v21.0";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

class MetaError extends Error {}

async function graph(path: string, params: Record<string, string> = {}): Promise<Any> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", TOKEN);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    const msg = e.code === 190 ? "token do Meta inválido ou expirado"
      : e.code === 17 || e.code === 4 || e.code === 613 ? "limite de chamadas do Meta atingido, tentaremos de novo"
      : e.code === 200 || e.code === 10 ? "o token não tem permissão nesta conta"
      : (e.message ?? `erro HTTP ${res.status}`);
    throw new MetaError(msg);
  }
  return body;
}

/* Lê todas as páginas (máx. 20) */
async function graphAll(path: string, params: Record<string, string>): Promise<Any[]> {
  const out: Any[] = [];
  let page = await graph(path, params);
  for (let i = 0; i < 20; i++) {
    out.push(...(page.data ?? []));
    const next: string | undefined = page.paging?.next;
    const after: string | undefined = page.paging?.cursors?.after;
    if (!next || !after) break;
    page = await graph(path, { ...params, after });
  }
  return out;
}

async function syncAccount(acc: Any) {
  const id = acc.account_id;
  try {
    const account = await graph(id, { fields: "name,currency,account_status,disable_reason,amount_spent,balance,spend_cap" });
    const campaigns = await graphAll(`${id}/campaigns`, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,issues_info",
      limit: "200",
    });
    // Primeira leitura: 30 dias; depois, 7 dias (o Meta ajusta resultados retroativamente)
    const insights = await graphAll(`${id}/insights`, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
      time_increment: "1",
      date_preset: acc.last_sync_at ? "last_7d" : "last_30d",
      limit: "500",
    });
    // last_7d não inclui hoje: lê o dia corrente separado (alerta de gasto)
    const today = await graphAll(`${id}/insights`, {
      level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
      time_increment: "1", date_preset: "today", limit: "500",
    });
    const { data: alerts, error } = await db.rpc("meta_ingest", {
      p_account_id: id, p_account: account, p_campaigns: campaigns, p_insights: insights.concat(today),
    });
    if (error) throw new Error(error.message);
    return { account: id, ok: true, campaigns: campaigns.length, rows: insights.length + today.length, alerts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.rpc("meta_ingest", { p_account_id: id, p_account: null, p_campaigns: null, p_insights: null, p_error: msg });
    return { account: id, ok: false, error: msg };
  }
}

async function syncAll() {
  if (!TOKEN) return { ok: false, message: "Segredo META_ACCESS_TOKEN não configurado na função." };
  const { data: accounts, error } = await db.from("meta_ad_accounts").select("account_id,last_sync_at").eq("active", true);
  if (error) return { ok: false, message: error.message };
  const results = [];
  for (const acc of accounts ?? []) results.push(await syncAccount(acc));
  return { ok: true, results };
}

async function requireAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return prof?.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const action = new URL(req.url).searchParams.get("action");

  if (action === "sync") {
    const { data: key } = await db.rpc("meta_sync_key");
    if (!key || req.headers.get("x-sync-key") !== key) return json({ ok: false }, 401);
    return json(await syncAll());
  }

  if (!(await requireAdmin(req))) return json({ ok: false, message: "Apenas administradores." }, 403);

  if (action === "sync-now") return json(await syncAll());

  if (action === "accounts") {
    if (!TOKEN) return json({ ok: false, message: "Segredo META_ACCESS_TOKEN não configurado na função." });
    try {
      const list = await graphAll("me/adaccounts", { fields: "account_id,name,currency,account_status", limit: "200" });
      return json({ ok: true, accounts: list.map((a: Any) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status })) });
    } catch (e) {
      return json({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ ok: false, message: "Ação desconhecida." }, 400);
});
