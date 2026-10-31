/* ==========================================================================
   views/campaigns.js — Métricas do Meta Ads.
   CampaignsPanel.render() é usado na página "Campanhas" da equipe e na aba
   "Campanhas" do portal do cliente (mesmos números, sem dados internos).
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const EFFECTIVE = {
    ACTIVE: ["Ativa", "badge-concluida"],
    PAUSED: ["Pausada", "badge-backlog"],
    CAMPAIGN_PAUSED: ["Pausada", "badge-backlog"],
    ADSET_PAUSED: ["Pausada", "badge-backlog"],
    DISAPPROVED: ["Reprovada", "badge-urgente"],
    WITH_ISSUES: ["Com problemas", "badge-urgente"],
    PENDING_BILLING_INFO: ["Aguardando pagamento", "badge-urgente"],
    PENDING_REVIEW: ["Em análise", "badge-em_revisao"],
    IN_PROCESS: ["Processando", "badge-em_revisao"],
    ARCHIVED: ["Arquivada", "badge-backlog"],
    DELETED: ["Excluída", "badge-backlog"]
  };
  const ACCOUNT_STATUS = { 1: null, 2: "Conta desativada", 3: "Pagamento pendente", 7: "Em análise de risco", 8: "Liquidação pendente", 9: "Período de carência", 100: "Encerramento pendente", 101: "Conta encerrada" };
  const PERIODS = [["7", "7 dias"], ["30", "30 dias"], ["month", "Este mês"], ["last_month", "Mês passado"]];

  const money = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
  const int = (v) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
  const pct = (v) => `${(v || 0).toFixed(2).replace(".", ",")}%`;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function range(period) {
    const now = new Date();
    if (period === "month") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    if (period === "last_month") return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    const days = Number(period) || 7;
    const from = new Date(now); from.setDate(now.getDate() - days);
    const to = new Date(now); to.setDate(now.getDate() - 1);
    return [iso(from), iso(to)]; // dias completos (até ontem)
  }

  function totals(rows) {
    const t = rows.reduce((a, r) => {
      a.spend += Number(r.spend) || 0; a.impressions += Number(r.impressions) || 0; a.reach += Number(r.reach) || 0;
      a.clicks += Number(r.clicks) || 0; a.leads += Number(r.leads) || 0; a.conversations += Number(r.conversations) || 0;
      return a;
    }, { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0 });
    t.cpl = t.leads ? t.spend / t.leads : null;
    t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
    return t;
  }

  function kpi(label, value, sub) {
    return `
      <div class="card" style="margin:0;">
        <div class="card-pad" style="padding:14px 16px;">
          <div class="text-sm text-muted">${label}</div>
          <div style="font-size:1.35rem;font-weight:800;margin-top:2px;">${value}</div>
          ${sub ? `<div class="text-sm text-muted">${sub}</div>` : ""}
        </div>
      </div>`;
  }

  function chartHtml(rows, from, to) {
    const byDay = {};
    rows.forEach((r) => {
      const d = byDay[r.date] = byDay[r.date] || { spend: 0, leads: 0 };
      d.spend += Number(r.spend) || 0; d.leads += Number(r.leads) || 0;
    });
    const days = [];
    for (let d = new Date(from + "T12:00:00"); iso(d) <= to; d.setDate(d.getDate() + 1)) days.push(iso(d));
    const max = Math.max(1, ...days.map((d) => (byDay[d] || {}).spend || 0));
    return `
      <div style="display:flex;align-items:flex-end;gap:3px;height:150px;padding-top:8px;overflow-x:auto;">
        ${days.map((d) => {
          const v = byDay[d] || { spend: 0, leads: 0 };
          const h = Math.max(2, Math.round((v.spend / max) * 130));
          return `<div title="${UI.formatDate(d)}: ${money(v.spend)} · ${int(v.leads)} lead(s)" style="flex:1;min-width:8px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
            <div style="width:100%;height:${h}px;background:var(--chart-bar, var(--color-primary));border-radius:4px 4px 0 0;opacity:${v.spend ? 1 : .25};"></div>
          </div>`;
        }).join("")}
      </div>
      <div class="flex justify-between text-sm text-muted" style="margin-top:4px;"><span>${UI.formatDate(from)}</span><span>${UI.formatDate(to)}</span></div>`;
  }

  const panelState = { period: "7" };

  /* opts: { companyIds: [..] | null, staff: bool } */
  function renderPanel(el, opts) {
    const state = panelState; // sobrevive às re-renderizações do portal
    el.innerHTML = `<div class="text-sm text-muted">Carregando campanhas...</div>`;
    const [from, to] = range(state.period);

    DB.Meta.data(opts.companyIds, from, to).then((res) => {
      if (!el.isConnected) return;
      if (res.unavailable) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">📈</div>Métricas de campanhas ainda não configuradas no banco (migration pendente).</div>`;
        return;
      }
      if (!res.accounts.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">📈</div>${opts.staff ? "Nenhuma conta de anúncios vinculada. Vincule em Configurações → Meta Ads." : "Nenhuma conta de anúncios vinculada a esta unidade ainda."}</div>`;
        return;
      }
      const t = totals(res.insights);
      const byCampaign = {};
      res.insights.forEach((r) => { (byCampaign[r.campaign_id] = byCampaign[r.campaign_id] || []).push(r); });
      const campaigns = res.campaigns
        .map((c) => Object.assign({}, c, totals(byCampaign[c.campaign_id] || [])))
        .filter((c) => c.spend > 0 || c.effective_status === "ACTIVE" || ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"].includes(c.effective_status))
        .sort((a, b) => b.spend - a.spend);
      const accountIssues = res.accounts.filter((a) => ACCOUNT_STATUS[a.account_status]);
      const lastSync = res.accounts.map((a) => a.last_sync_at).filter(Boolean).sort().pop();
      const syncErrors = opts.staff ? res.accounts.filter((a) => a.last_error) : [];

      el.innerHTML = `
        <div class="flex items-center justify-between" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;">
          <div class="flex gap-2" style="flex-wrap:wrap;">
            ${PERIODS.map(([id, label]) => `<button class="btn btn-sm ${state.period === id ? "btn-primary" : "btn-secondary"}" data-camp-period="${id}">${label}</button>`).join("")}
          </div>
          <div class="text-sm text-muted">${lastSync ? `Atualizado em ${UI.formatDateTime(lastSync)}` : "Aguardando a primeira leitura do Meta"}</div>
        </div>

        ${accountIssues.map((a) => `
          <div style="padding:10px 14px;margin-bottom:10px;background:var(--color-danger-light);color:var(--color-danger);border-radius:var(--radius-md);font-weight:600;font-size:14px;">
            ⚠️ ${UI.escapeHtml(a.name || a.account_id)}: ${ACCOUNT_STATUS[a.account_status]}${a.account_status === 3 ? " — os anúncios ficam parados até regularizar o pagamento no Meta." : "."}
          </div>`).join("")}
        ${syncErrors.map((a) => `
          <div style="padding:10px 14px;margin-bottom:10px;background:var(--color-warning-light);color:var(--color-warning);border-radius:var(--radius-md);font-size:14px;">
            Falha ao ler ${UI.escapeHtml(a.name || a.account_id)}: ${UI.escapeHtml(a.last_error)}
          </div>`).join("")}

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
          ${kpi("Investimento", money(t.spend), `${UI.formatDate(from)} a ${UI.formatDate(to)}`)}
          ${kpi("Leads", int(t.leads))}
          ${kpi("Custo por lead", t.cpl == null ? "—" : money(t.cpl))}
          ${kpi("Conversas iniciadas", int(t.conversations))}
          ${kpi("Alcance", int(t.reach), `${int(t.impressions)} impressões`)}
          ${kpi("Cliques", int(t.clicks), `CTR ${pct(t.ctr)}`)}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div class="card-header"><h3 class="card-title">Investimento por dia</h3></div>
          <div class="card-pad">${chartHtml(res.insights, from, to)}</div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Campanhas</h3></div>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Campanha</th><th>Situação</th><th>Investimento</th><th>Leads</th><th>Custo/lead</th><th>Conversas</th><th>Cliques</th><th>CTR</th></tr></thead>
              <tbody>${campaigns.length ? campaigns.map((c) => {
                const st = EFFECTIVE[c.effective_status] || [c.effective_status || "—", "badge-backlog"];
                const acc = res.accounts.find((a) => a.account_id === c.account_id);
                return `<tr>
                  <td><div style="font-weight:600;">${UI.escapeHtml(c.name || c.campaign_id)}</div>
                    ${opts.staff && res.accounts.length > 1 ? `<div class="text-sm text-muted">${UI.escapeHtml((acc && acc.name) || c.account_id)}</div>` : ""}</td>
                  <td><span class="badge ${st[1]}">${st[0]}</span></td>
                  <td>${money(c.spend)}</td>
                  <td>${int(c.leads)}</td>
                  <td>${c.cpl == null ? "—" : money(c.cpl)}</td>
                  <td>${int(c.conversations)}</td>
                  <td>${int(c.clicks)}</td>
                  <td>${pct(c.ctr)}</td>
                </tr>`;
              }).join("") : `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted);">Nenhuma campanha com investimento no período.</td></tr>`}</tbody>
            </table>
          </div>
        </div>`;

      el.querySelectorAll("[data-camp-period]").forEach((btn) => {
        btn.addEventListener("click", () => { state.period = btn.dataset.campPeriod; renderPanel(el, opts); });
      });
    });
  }

  window.CampaignsPanel = { render: renderPanel };

  /* ---------------- Página da equipe ---------------- */

  const ALERT_ICON = { account_status: "💳", spend_cap: "🧱", campaign_issue: "⛔", no_delivery: "📭", cpl_above: "💸", overspend: "🔥", sync_error: "🔌" };
  let pageCompany = "";

  window.Views.campaigns = function (container, ctx) {
    const isAdmin = ctx.user.role === "admin";
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Campanhas</h1>
          <p class="page-subtitle">Métricas do Meta Ads por cliente e alertas automáticos.</p>
        </div>
        <div class="page-actions">
          <select id="camp-company" class="form-control" style="width:auto;min-width:220px;"><option value="">Todas as contas</option></select>
          ${isAdmin ? `<button class="btn btn-secondary" id="camp-sync">🔄 Sincronizar agora</button>` : ""}
        </div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header"><h3 class="card-title">⚠️ Alertas recentes</h3></div>
        <div class="card-pad" id="camp-alerts"><div class="text-sm text-muted">Carregando...</div></div>
      </div>
      <div id="camp-panel"></div>`;

    const panel = container.querySelector("#camp-panel");
    const sel = container.querySelector("#camp-company");

    DB.Meta.accounts().then(({ accounts }) => {
      const companyIds = Array.from(new Set(accounts.filter((a) => a.active).map((a) => a.company_id)));
      sel.innerHTML += companyIds.map((id) => {
        const c = DB.Companies.get(id);
        return `<option value="${id}" ${pageCompany === id ? "selected" : ""}>${UI.escapeHtml(c ? c.name : id)}</option>`;
      }).join("");
      if (pageCompany && !companyIds.includes(pageCompany)) pageCompany = "";
      draw();
    });

    function draw() {
      window.CampaignsPanel.render(panel, { companyIds: pageCompany ? [pageCompany] : null, staff: true });
      DB.Meta.alerts(30).then((alerts) => {
        const box = container.querySelector("#camp-alerts");
        if (!box || !box.isConnected) return;
        const list = alerts.filter((a) => !pageCompany || a.company_id === pageCompany).slice(0, 12);
        box.innerHTML = list.length ? list.map((a) => {
          const c = DB.Companies.get(a.company_id);
          return `<div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
            <div class="text-sm">${ALERT_ICON[a.kind] || "⚠️"} <strong>${UI.escapeHtml(c ? c.name : a.account_id)}</strong> — ${UI.escapeHtml(a.message)}</div>
            <div class="text-sm text-muted">${UI.formatDateTime(a.created_at)}</div>
          </div>`;
        }).join("") : `<div class="text-sm text-muted">Nenhum alerta. 👍</div>`;
      });
    }

    sel.addEventListener("change", () => { pageCompany = sel.value; draw(); });
    const syncBtn = container.querySelector("#camp-sync");
    if (syncBtn) syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Sincronizando...";
      const r = await DB.Meta.call("sync-now");
      syncBtn.disabled = false;
      syncBtn.textContent = "🔄 Sincronizar agora";
      if (!r.ok) { UI.toast(r.message || "Falha ao sincronizar.", "error"); return; }
      const failed = (r.results || []).filter((x) => !x.ok);
      UI.toast(failed.length ? `Sincronizado, com falha em ${failed.length} conta(s).` : `${(r.results || []).length} conta(s) sincronizada(s).`, failed.length ? "error" : "success");
      draw();
    });
  };
})();
