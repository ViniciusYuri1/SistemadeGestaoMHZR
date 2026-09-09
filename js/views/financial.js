/* ==========================================================================
   views/financial.js — Módulo Financeiro (somente Administrador):
   empresas atendidas, boletos por mês e por empresa, controle de recebíveis.
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const STATUS_CFG = {
    pago:      { label: "Pago",      badge: "badge-concluida"   },
    pendente:  { label: "Pendente",  badge: "badge-em_andamento" },
    vencido:   { label: "Vencido",   badge: "badge-urgente"      },
    cancelado: { label: "Cancelado", badge: "badge-backlog"      }
  };

  const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  const COST_TYPES = ["Funcionários", "Inteligência Artificial", "Banco de Dados", "Marketing", "Infraestrutura", "Ferramentas/Software", "Impostos", "Outros"];

  function brl(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
  }

  function currentYM() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(ym) {
    if (!ym) return "";
    const [y, m] = ym.split("-");
    return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;
  }

  function monthOptions(selected) {
    const opts = [];
    const now = new Date();
    for (let i = -5; i <= 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      opts.push(`<option value="${ym}" ${ym === selected ? "selected" : ""}>${monthLabel(ym)}</option>`);
    }
    return opts.join("");
  }

  /* ---- estado de filtros (persiste entre trocas de aba) ---- */
  let state = {
    tab: "boletos",
    filterMonth: currentYM(), filterCompany: "", filterStatus: "",
    costFilterMonth: currentYM(), costFilterType: ""
  };

  /* ================================================================= */
  /* BOLETOS TAB                                                        */
  /* ================================================================= */

  function renderStatCards(boletos, filterMonth) {
    const recebido  = boletos.filter((b) => b.status === "pago").reduce((s, b) => s + b.amount, 0);
    const pendentes = boletos.filter((b) => b.status === "pendente");
    const vencidos  = boletos.filter((b) => b.status === "vencido");
    /* Recebido no mês: usa o filtro de mês ativo, ou o mês atual se não houver filtro */
    const mes       = filterMonth || currentYM();
    const boletosDoMes = filterMonth ? boletos : DB.Boletos.list({ month: mes });
    const recMes    = boletosDoMes.filter((b) => b.status === "pago").reduce((s, b) => s + b.amount, 0);

    const cards = [
      { icon: "💵", bg: "var(--color-success-light)",  color: "var(--color-success)",  value: brl(recebido),                                         label: "Total Recebido"                                    },
      { icon: "📋", bg: "var(--color-warning-light)",  color: "var(--color-warning)",  value: brl(pendentes.reduce((s,b)=>s+b.amount,0)),             label: `A Receber (${pendentes.length} boleto${pendentes.length !== 1 ? "s" : ""})` },
      { icon: "⚠️", bg: "var(--color-danger-light)",   color: "var(--color-danger)",   value: brl(vencidos.reduce((s,b)=>s+b.amount,0)),              label: `Vencidos (${vencidos.length} boleto${vencidos.length !== 1 ? "s" : ""})` },
      { icon: "📅", bg: "var(--color-primary-light)",  color: "var(--color-primary)",  value: brl(recMes),                                            label: `Recebido em ${monthLabel(mes)}`                    }
    ];

    return `<div class="stat-grid">${cards.map((c) => `
      <div class="stat-card">
        <div class="stat-top"><div class="stat-icon" style="background:${c.bg};color:${c.color};">${c.icon}</div></div>
        <div class="stat-value" style="font-size:1.15rem;">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>`).join("")}</div>`;
  }

  function renderBoletosTab(wrap) {
    const all       = DB.Boletos.list();
    const companies = DB.Companies.list();

    let filtered = all;
    if (state.filterMonth)   filtered = filtered.filter((b) => b.month === state.filterMonth);
    if (state.filterCompany) filtered = filtered.filter((b) => b.companyId === state.filterCompany);
    if (state.filterStatus)  filtered = filtered.filter((b) => b.status === state.filterStatus);

    const today = DB.todayISO();

    const rows = filtered.length === 0
      ? `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">Nenhum boleto encontrado para os filtros selecionados.</td></tr>`
      : filtered.map((b) => {
          const co  = companies.find((c) => c.id === b.companyId);
          const cfg = STATUS_CFG[b.status] || STATUS_CFG.pendente;
          const overdue = b.status === "pendente" && b.dueDate < today;
          return `<tr>
            <td>
              <div style="font-weight:600;">${UI.escapeHtml(co ? co.name : "—")}</div>
              ${co && co.cnpj ? `<div class="text-sm text-muted">${UI.escapeHtml(co.cnpj)}</div>` : ""}
            </td>
            <td class="text-sm">${UI.escapeHtml(b.description)}</td>
            <td style="font-weight:700;color:var(--color-primary);">${brl(b.amount)}</td>
            <td class="text-sm" style="${overdue ? "color:var(--color-danger);font-weight:600;" : ""}">${UI.formatDate(b.dueDate)}${overdue ? " ⚠️" : ""}</td>
            <td class="text-sm">${b.paidDate ? UI.formatDate(b.paidDate) : "—"}</td>
            <td><span class="badge ${cfg.badge}">${cfg.label}</span></td>
            <td class="text-sm text-muted">${UI.escapeHtml(b.notes || "—")}</td>
            <td>
              <div class="flex gap-2">
                ${b.status === "pendente" || b.status === "vencido" ? `<button class="btn btn-ghost btn-sm" data-mark-paid="${b.id}" title="Marcar como pago">✅</button>` : ""}
                ${b.attachment ? `<button class="btn btn-ghost btn-sm" data-view-attach="${b.id}" title="Ver anexo: ${UI.escapeHtml(b.attachment.name)}">📎</button>` : ""}
                <button class="btn btn-ghost btn-sm" data-edit-boleto="${b.id}" title="Editar">✏️</button>
                <button class="btn btn-ghost btn-sm" data-clone-boleto="${b.id}" title="Clonar para o próximo mês">🔁</button>
                <button class="btn btn-ghost btn-sm" data-delete-boleto="${b.id}" title="Excluir">🗑️</button>
              </div>
            </td>
          </tr>`;
        }).join("");

    const companyOpts = companies.map((c) =>
      `<option value="${c.id}" ${c.id === state.filterCompany ? "selected" : ""}>${UI.escapeHtml(c.name)}</option>`
    ).join("");

    wrap.innerHTML = `
      ${renderStatCards(filtered, state.filterMonth)}
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:10px;">
          <h3 class="card-title">Boletos</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <select class="form-control" id="f-month" style="width:auto;min-width:150px;">
              <option value="">Todos os meses</option>
              ${monthOptions(state.filterMonth)}
            </select>
            <select class="form-control" id="f-company" style="width:auto;min-width:180px;">
              <option value="">Todas as empresas</option>
              ${companyOpts}
            </select>
            <select class="form-control" id="f-status" style="width:auto;min-width:130px;">
              <option value="" ${!state.filterStatus ? "selected" : ""}>Todos os status</option>
              ${Object.entries(STATUS_CFG).map(([k, v]) => `<option value="${k}" ${k === state.filterStatus ? "selected" : ""}>${v.label}</option>`).join("")}
            </select>
            <button class="btn btn-primary btn-sm" id="btn-new-boleto">+ Novo Boleto</button>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Empresa</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Pagamento</th><th>Status</th><th>Observações</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    wrap.querySelector("#f-month").addEventListener("change", (e) => { state.filterMonth = e.target.value; renderBoletosTab(wrap); });
    wrap.querySelector("#f-company").addEventListener("change", (e) => { state.filterCompany = e.target.value; renderBoletosTab(wrap); });
    wrap.querySelector("#f-status").addEventListener("change", (e) => { state.filterStatus = e.target.value; renderBoletosTab(wrap); });
    wrap.querySelector("#btn-new-boleto").addEventListener("click", () => openBoletoModal(null, () => renderBoletosTab(wrap)));

    wrap.querySelectorAll("[data-mark-paid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        DB.Boletos.update(btn.dataset.markPaid, { status: "pago", paidDate: DB.todayISO() });
        UI.toast("Boleto marcado como pago.", "success");
        renderBoletosTab(wrap);
      });
    });
    wrap.querySelectorAll("[data-edit-boleto]").forEach((btn) => {
      btn.addEventListener("click", () => openBoletoModal(btn.dataset.editBoleto, () => renderBoletosTab(wrap)));
    });
    wrap.querySelectorAll("[data-clone-boleto]").forEach((btn) => {
      btn.addEventListener("click", () => openBoletoModal(null, () => renderBoletosTab(wrap), btn.dataset.cloneBoleto));
    });
    wrap.querySelectorAll("[data-delete-boleto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (UI.confirmDialog("Excluir este boleto?")) {
          DB.Boletos.remove(btn.dataset.deleteBoleto);
          UI.toast("Boleto excluído.", "success");
          renderBoletosTab(wrap);
        }
      });
    });
    wrap.querySelectorAll("[data-view-attach]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = DB.Boletos.get(btn.dataset.viewAttach);
        if (b && b.attachment) UI.openAttachment(b.attachment);
      });
    });
  }

  /* ================================================================= */
  /* CUSTOS TAB                                                         */
  /* ================================================================= */

  function statCardHtml(c) {
    return `
      <div class="stat-card">
        <div class="stat-top"><div class="stat-icon" style="background:${c.bg};color:${c.color};">${c.icon}</div></div>
        <div class="stat-value" style="font-size:1.15rem;${c.valueColor ? `color:${c.valueColor};` : ""}">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>`;
  }

  function renderCustosSummaryCards() {
    const totalCustos = DB.Costs.totalAll();
    const totalRecebido = DB.Boletos.list().filter((b) => b.status === "pago").reduce((s, b) => s + b.amount, 0);
    const lucroLiquido  = totalRecebido - totalCustos;
    const mes = state.costFilterMonth || currentYM();
    const custosDoMes = DB.Costs.totalForMonth(mes);

    return `<div class="stat-grid">${[
      { icon: "💵", bg: "var(--color-success-light)", color: "var(--color-success)", value: brl(totalRecebido), label: "Total Recebido" },
      { icon: "💸", bg: "var(--color-danger-light)",  color: "var(--color-danger)",  value: brl(totalCustos),   label: "Total de Custos" },
      { icon: lucroLiquido >= 0 ? "📈" : "📉", bg: "var(--color-primary-light)", color: "var(--color-primary)",
        value: brl(lucroLiquido), valueColor: lucroLiquido >= 0 ? "var(--color-success)" : "var(--color-danger)", label: "Lucro Líquido" },
      { icon: "📅", bg: "var(--color-warning-light)", color: "var(--color-warning)", value: brl(custosDoMes), label: `Custos em ${monthLabel(mes)}` }
    ].map(statCardHtml).join("")}</div>`;
  }

  function renderProjectionCards() {
    const a = DB.Stats.costAnalysis();
    return `
      <div class="card" style="margin-top:16px;margin-bottom:20px;">
        <div class="card-header">
          <h3 class="card-title">📊 Projeção ${a.year} (mantendo a média mensal atual)</h3>
        </div>
        <div class="card-pad">
          <p class="text-sm text-muted" style="margin-bottom:14px;">
            Com base na média mensal registrada de Jan a ${MONTH_NAMES[a.monthsElapsed - 1]}/${a.year}
            (${a.monthsElapsed} mês${a.monthsElapsed !== 1 ? "es" : ""}), projetado para os ${a.monthsRemaining}
            mês${a.monthsRemaining !== 1 ? "es" : ""} restante${a.monthsRemaining !== 1 ? "s" : ""} do ano.
          </p>
          <div class="stat-grid">${[
            { icon: "💸", bg: "var(--color-danger-light)",  color: "var(--color-danger)",  value: brl(a.avgMonthlyCost), label: "Custo médio mensal" },
            { icon: "📆", bg: "var(--color-danger-light)",  color: "var(--color-danger)",  value: brl(a.projectedCost),  label: `Custo projetado até Dez/${a.year}` },
            { icon: "💰", bg: "var(--color-success-light)", color: "var(--color-success)", value: brl(a.projectedReceived), label: `Recebido projetado até Dez/${a.year}` },
            { icon: a.projectedNetProfit >= 0 ? "📈" : "📉", bg: "var(--color-primary-light)", color: "var(--color-primary)",
              value: brl(a.projectedNetProfit), valueColor: a.projectedNetProfit >= 0 ? "var(--color-success)" : "var(--color-danger)",
              label: `Lucro líquido projetado até Dez/${a.year}` }
          ].map(statCardHtml).join("")}</div>
        </div>
      </div>`;
  }

  function renderCustosTab(wrap) {
    const all = DB.Costs.list();
    const knownTypes = Array.from(new Set([...COST_TYPES, ...all.map((c) => c.type)])).filter(Boolean);

    let filtered = all;
    if (state.costFilterMonth) filtered = filtered.filter((c) => DB.Costs.monthsOf(c).includes(state.costFilterMonth));
    if (state.costFilterType)  filtered = filtered.filter((c) => c.type === state.costFilterType);

    const periodLabel = (c) => c.endMonth && c.endMonth !== c.month
      ? `${monthLabel(c.month)} – ${monthLabel(c.endMonth)}`
      : monthLabel(c.month);

    const rows = filtered.length === 0
      ? `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted);">Nenhum custo encontrado para os filtros selecionados.</td></tr>`
      : filtered.map((c) => `<tr>
          <td><span class="badge badge-em_andamento">${UI.escapeHtml(c.type)}</span></td>
          <td class="text-sm">${UI.escapeHtml(c.description)}</td>
          <td class="text-sm">${periodLabel(c)}</td>
          <td style="font-weight:700;color:var(--color-danger);">${brl(c.amount)}${c.endMonth && c.endMonth !== c.month ? `<div class="text-sm text-muted" style="font-weight:400;">/mês</div>` : ""}</td>
          <td>
            <div class="flex gap-2">
              <button class="btn btn-ghost btn-sm" data-edit-cost="${c.id}" title="Editar">✏️</button>
              <button class="btn btn-ghost btn-sm" data-delete-cost="${c.id}" title="Excluir">🗑️</button>
            </div>
          </td>
        </tr>`).join("");

    const typeOpts = knownTypes.map((t) =>
      `<option value="${UI.escapeHtml(t)}" ${t === state.costFilterType ? "selected" : ""}>${UI.escapeHtml(t)}</option>`
    ).join("");

    wrap.innerHTML = `
      ${renderCustosSummaryCards()}
      ${renderProjectionCards()}
      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:10px;">
          <h3 class="card-title">Custos</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <select class="form-control" id="f-cost-month" style="width:auto;min-width:150px;">
              <option value="">Todos os meses</option>
              ${monthOptions(state.costFilterMonth)}
            </select>
            <select class="form-control" id="f-cost-type" style="width:auto;min-width:180px;">
              <option value="">Todos os tipos</option>
              ${typeOpts}
            </select>
            <button class="btn btn-primary btn-sm" id="btn-new-cost">+ Novo Custo</button>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Tipo</th><th>Descrição</th><th>Período</th><th>Valor</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    wrap.querySelector("#f-cost-month").addEventListener("change", (e) => { state.costFilterMonth = e.target.value; renderCustosTab(wrap); });
    wrap.querySelector("#f-cost-type").addEventListener("change", (e) => { state.costFilterType = e.target.value; renderCustosTab(wrap); });
    wrap.querySelector("#btn-new-cost").addEventListener("click", () => openCostModal(null, () => renderCustosTab(wrap)));

    wrap.querySelectorAll("[data-edit-cost]").forEach((btn) => {
      btn.addEventListener("click", () => openCostModal(btn.dataset.editCost, () => renderCustosTab(wrap)));
    });
    wrap.querySelectorAll("[data-delete-cost]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (UI.confirmDialog("Excluir este custo?")) {
          DB.Costs.remove(btn.dataset.deleteCost);
          UI.toast("Custo excluído.", "success");
          renderCustosTab(wrap);
        }
      });
    });
  }

  /* ================================================================= */
  /* EMPRESAS TAB                                                       */
  /* ================================================================= */

  function renderEmpresasTab(wrap) {
    const companies = DB.Companies.list();
    const boletos   = DB.Boletos.list();

    /* IDs de empresas com usuário de portal ativo mas sem contrato cadastrado */
    const allPortalUsers = DB.Users.list().filter((u) => u.role === "company");
    const newCoIds = new Set(
      companies
        .filter((co) => {
          const hasUser = allPortalUsers.some((u) => u.companyId === co.id);
          const hasCtr  = (co.contractText && co.contractText.trim()) || co.contractFile;
          return hasUser && !hasCtr;
        })
        .map((co) => co.id)
    );

    const cards = companies.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🏢</div>Nenhuma empresa cadastrada ainda.</div>`
      : companies.map((co) => {
          const coB      = boletos.filter((b) => b.companyId === co.id);
          const recebido = coB.filter((b) => b.status === "pago").reduce((s, b) => s + b.amount, 0);
          const aReceber = coB.filter((b) => b.status === "pendente" || b.status === "vencido").reduce((s, b) => s + b.amount, 0);
          const initials = co.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
          const hasCtr   = (co.contractText && co.contractText.trim()) || co.contractFile;
          const signed   = hasCtr && co.contractSignedAt;
          const isNew    = newCoIds.has(co.id) && !hasCtr;
          const contractBadge = hasCtr
            ? (signed
                ? `<span class="badge badge-concluida" style="font-size:11px;">✅ Contrato assinado</span>`
                : `<span class="badge badge-em_andamento" style="font-size:11px;">📝 Aguardando assinatura</span>`)
            : `<span class="badge badge-backlog" style="font-size:11px;">📄 Sem contrato</span>`;
          const durationBadge = co.contractDuration
            ? `<span class="badge badge-em_andamento" style="font-size:11px;">🗓️ ${UI.escapeHtml(co.contractDuration)}</span>`
            : `<span class="badge badge-backlog" style="font-size:11px;">🗓️ Prazo não informado</span>`;
          const newBadge = isNew
            ? `<span class="badge" style="font-size:11px;background:#7c3aed;color:#fff;margin-left:6px;">🆕 Novo cadastro</span>`
            : "";
          return `
          <div class="card" style="${isNew ? "border:1.5px solid var(--color-primary);" : ""}">
            <div class="card-pad">
              <div class="flex items-center justify-between" style="margin-bottom:8px;">
                <div class="flex items-center gap-2">
                  ${co.photo
                    ? `<div class="avatar" style="width:38px;height:38px;border-radius:10px;overflow:hidden;"><img src="${co.photo}" alt="${UI.escapeHtml(co.name)}" style="width:100%;height:100%;object-fit:cover;" /></div>`
                    : `<div class="avatar" style="width:38px;height:38px;background:var(--color-primary-light);color:var(--color-primary);font-weight:700;font-size:13px;border-radius:10px;display:flex;align-items:center;justify-content:center;">${initials}</div>`}
                  <div>
                    <div style="font-weight:700;line-height:1.2;">${UI.escapeHtml(co.name)}${newBadge}</div>
                    <div class="text-sm text-muted">${UI.escapeHtml(co.cnpj || "")}</div>
                  </div>
                </div>
                <span class="badge ${co.status === "ativo" ? "badge-concluida" : "badge-backlog"}">${co.status === "ativo" ? "Ativo" : "Inativo"}</span>
              </div>
              <div class="flex gap-2" style="margin-bottom:10px;flex-wrap:wrap;">${contractBadge}${durationBadge}</div>
              <div class="flex-col gap-1" style="font-size:13px;margin-bottom:14px;">
                ${co.contact ? `<div>👤 ${UI.escapeHtml(co.contact)}</div>` : ""}
                ${co.email   ? `<div>✉️ ${UI.escapeHtml(co.email)}</div>`   : ""}
                ${co.phone   ? `<div>📞 ${UI.escapeHtml(co.phone)}</div>`   : ""}
                ${co.since   ? `<div class="text-muted">Cliente desde ${monthLabel(co.since)}</div>` : ""}
              </div>
              <div class="flex gap-4" style="font-size:13px;border-top:1px solid var(--border-color);padding-top:12px;margin-bottom:14px;">
                <div><div style="color:var(--color-success);font-weight:700;">${brl(recebido)}</div><div class="text-muted">Recebido</div></div>
                <div><div style="color:var(--color-warning);font-weight:700;">${brl(aReceber)}</div><div class="text-muted">A Receber</div></div>
                <div><div style="font-weight:700;">${coB.length}</div><div class="text-muted">Boleto${coB.length !== 1 ? "s" : ""}</div></div>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-secondary btn-sm" style="flex:1;" data-edit-company="${co.id}">✏️ Editar</button>
                <button class="btn btn-secondary btn-sm" data-contract-company="${co.id}" title="Gerenciar contrato">📄</button>
                <button class="btn btn-primary btn-sm" data-access-company="${co.id}" title="Gerenciar acesso ao portal">🔑</button>
                <button class="btn btn-ghost btn-sm" data-delete-company="${co.id}" title="Excluir">🗑️</button>
              </div>
            </div>
          </div>`;
        }).join("");

    const newCount = newCoIds.size;
    const alertBanner = newCount > 0
      ? `<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--color-primary-light);border:1px solid var(--color-primary);border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--color-primary);">
           🆕 ${newCount} empresa${newCount > 1 ? "s" : ""} com acesso ativo aguardando contrato — veja os cards destacados abaixo.
         </div>`
      : "";

    wrap.innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <h3 class="card-title">Empresas Atendidas</h3>
          <button class="btn btn-primary btn-sm" id="btn-new-company">+ Nova Empresa</button>
        </div>
      </div>
      ${alertBanner}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;">
        ${cards}
      </div>`;

    wrap.querySelector("#btn-new-company").addEventListener("click", () => openCompanyModal(null, () => renderEmpresasTab(wrap)));
    wrap.querySelectorAll("[data-edit-company]").forEach((btn) => {
      btn.addEventListener("click", () => openCompanyModal(btn.dataset.editCompany, () => renderEmpresasTab(wrap)));
    });
    wrap.querySelectorAll("[data-contract-company]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const co = DB.Companies.get(btn.dataset.contractCompany);
        if (co) openContractModal(co, () => renderEmpresasTab(wrap));
      });
    });
    wrap.querySelectorAll("[data-access-company]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const co = DB.Companies.get(btn.dataset.accessCompany);
        if (co) openCompanyAccessModal(co, () => renderEmpresasTab(wrap));
      });
    });
    wrap.querySelectorAll("[data-delete-company]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (UI.confirmDialog("Excluir esta empresa? Os boletos associados não serão apagados.")) {
          DB.Companies.remove(btn.dataset.deleteCompany);
          UI.toast("Empresa removida.", "success");
          renderEmpresasTab(wrap);
        }
      });
    });
  }

  /* ================================================================= */
  /* MODAIS                                                             */
  /* ================================================================= */

  /* "2026-08" -> "2026-09" */
  function nextMonthYM(ym) {
    const [y, m] = ym.split("-").map(Number);
    if (!y || !m) return ym;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return ny + "-" + String(nm).padStart(2, "0");
  }

  /* "2026-08-31" -> "2026-09-30" (mantém o dia, limitado ao fim do mês) */
  function nextMonthDate(iso) {
    const [y, m, d] = (iso || "").split("-").map(Number);
    if (!y || !m || !d) return iso;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const lastDay = new Date(ny, nm, 0).getDate();
    return ny + "-" + String(nm).padStart(2, "0") + "-" + String(Math.min(d, lastDay)).padStart(2, "0");
  }

  /* Atualiza referências ao mês de origem na descrição (ex.: "Jul/2026" ou
     "07/2026" viram o mês seguinte). Se não encontrar, mantém o texto. */
  function bumpMonthInText(text, fromYM) {
    if (!text || !fromYM) return text;
    const abbr = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const [fy, fm] = fromYM.split("-").map(Number);
    const toYM = nextMonthYM(fromYM);
    const [ty, tm] = toYM.split("-").map(Number);
    let out = text.replace(
      new RegExp(abbr[fm - 1] + "\\s*\\/\\s*" + fy, "gi"),
      abbr[tm - 1] + "/" + ty
    );
    out = out.replace(
      new RegExp(String(fm).padStart(2, "0") + "\\s*\\/\\s*" + fy, "g"),
      String(tm).padStart(2, "0") + "/" + ty
    );
    return out;
  }

  function openBoletoModal(boletoId, onSaved, cloneFromId) {
    const companies = DB.Companies.list();
    const isNew     = !boletoId;

    /* Clonagem: pré-preenche com os dados do boleto de origem, avançando o
       mês de referência e o vencimento em um mês; volta a "pendente" e não
       copia anexo nem data de pagamento (cada boleto tem os seus). */
    let bol = boletoId ? DB.Boletos.get(boletoId) : null;
    const cloneSource = !boletoId && cloneFromId ? DB.Boletos.get(cloneFromId) : null;
    if (cloneSource) {
      bol = {
        companyId:   cloneSource.companyId,
        description: bumpMonthInText(cloneSource.description, cloneSource.month),
        amount:      cloneSource.amount,
        month:       nextMonthYM(cloneSource.month),
        dueDate:     nextMonthDate(cloneSource.dueDate),
        status:      "pendente",
        paidDate:    null,
        notes:       cloneSource.notes || "",
        attachment:  null
      };
    }

    const html = `
      <div class="modal-header">
        <h3>${isNew ? (cloneSource ? "Clonar Boleto" : "Novo Boleto") : "Editar Boleto"}</h3>
        <button class="modal-close" id="bm-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Empresa *</label>
          <select class="form-control" id="bm-company">
            <option value="">Selecione a empresa...</option>
            ${companies.map((c) => `<option value="${c.id}" ${bol && bol.companyId === c.id ? "selected" : ""}>${UI.escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição *</label>
          <input type="text" class="form-control" id="bm-desc" value="${bol ? UI.escapeHtml(bol.description) : ""}" placeholder="Ex: Mensalidade Gestão Jul/2026" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Valor (R$) *</label>
            <input type="number" class="form-control" id="bm-amount" value="${bol ? bol.amount : ""}" min="0" step="0.01" placeholder="0,00" />
          </div>
          <div class="form-group">
            <label class="form-label">Mês de referência *</label>
            <input type="month" class="form-control" id="bm-month" value="${bol ? bol.month : currentYM()}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Data de vencimento *</label>
            <input type="date" class="form-control" id="bm-due" value="${bol ? bol.dueDate : ""}" />
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-control" id="bm-status">
              ${Object.entries(STATUS_CFG).map(([k, v]) => `<option value="${k}" ${(bol ? bol.status : "pendente") === k ? "selected" : ""}>${v.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="form-group" id="bm-paid-wrap" style="${bol && bol.status === "pago" ? "" : "display:none"}">
          <label class="form-label">Data de pagamento</label>
          <input type="date" class="form-control" id="bm-paiddate" value="${bol && bol.paidDate ? bol.paidDate : ""}" />
        </div>
        <div class="form-group">
          <label class="form-label">Observações</label>
          <input type="text" class="form-control" id="bm-notes" value="${bol ? UI.escapeHtml(bol.notes || "") : ""}" placeholder="Opcional" />
        </div>
        <div class="form-group">
          <label class="form-label">Anexo do boleto</label>
          ${bol && bol.attachment ? `
          <div id="bm-attach-current" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-soft,var(--bg-surface));border:1px solid var(--border-color);border-radius:8px;margin-bottom:8px;">
            <span>📎</span>
            <span class="text-sm" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${UI.escapeHtml(bol.attachment.name)}</span>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-view-cur" title="Visualizar">👁️</button>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-remove-attach" title="Remover anexo" style="color:var(--color-danger);">✕</button>
          </div>` : ""}
          <input type="file" class="form-control" id="bm-file" accept=".pdf,.png,.jpg,.jpeg" style="padding:6px;" />
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">PDF, PNG ou JPG — máximo 3 MB${bol && bol.attachment ? " · Selecione um arquivo para substituir o atual" : ""}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="bm-cancel">Cancelar</button>
        <button class="btn btn-primary" id="bm-save">${isNew ? "Criar Boleto" : "Salvar Alterações"}</button>
      </div>`;

    const overlay = UI.showModal(html, { static: true });
    overlay.querySelector("#bm-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#bm-cancel").addEventListener("click", UI.hideModal);

    overlay.querySelector("#bm-status").addEventListener("change", (e) => {
      overlay.querySelector("#bm-paid-wrap").style.display = e.target.value === "pago" ? "" : "none";
      if (e.target.value === "pago" && !overlay.querySelector("#bm-paiddate").value) {
        overlay.querySelector("#bm-paiddate").value = DB.todayISO();
      }
    });

    let removeAttachment = false;

    const viewCurBtn = overlay.querySelector("#bm-view-cur");
    if (viewCurBtn) {
      viewCurBtn.addEventListener("click", () => UI.openAttachment(bol.attachment));
    }
    const removeAttachBtn = overlay.querySelector("#bm-remove-attach");
    if (removeAttachBtn) {
      removeAttachBtn.addEventListener("click", () => {
        removeAttachment = true;
        overlay.querySelector("#bm-attach-current").style.display = "none";
        UI.toast("Anexo será removido ao salvar.", "success");
      });
    }

    overlay.querySelector("#bm-save").addEventListener("click", () => {
      const companyId   = overlay.querySelector("#bm-company").value;
      const description = overlay.querySelector("#bm-desc").value.trim();
      const amount      = parseFloat(overlay.querySelector("#bm-amount").value);
      const month       = overlay.querySelector("#bm-month").value;
      const dueDate     = overlay.querySelector("#bm-due").value;
      const status      = overlay.querySelector("#bm-status").value;
      const paidDate    = overlay.querySelector("#bm-paiddate").value || null;
      const notes       = overlay.querySelector("#bm-notes").value.trim();

      if (!companyId || !description || !amount || !month || !dueDate) {
        UI.toast("Preencha todos os campos obrigatórios (*).","error");
        return;
      }

      const payload = { companyId, description, amount, month, dueDate, status, paidDate, notes };
      if (removeAttachment) payload.attachment = null;

      function doSave(finalPayload) {
        try {
          if (isNew) {
            DB.Boletos.create(finalPayload);
            UI.toast("Boleto criado com sucesso.", "success");
          } else {
            DB.Boletos.update(bol.id, finalPayload);
            UI.toast("Boleto atualizado.", "success");
          }
          UI.hideModal();
          if (onSaved) onSaved();
        } catch (err) {
          if (err.name === "QuotaExceededError") {
            UI.toast("Armazenamento insuficiente. Reduza o tamanho do arquivo e tente novamente.", "error");
          } else {
            UI.toast("Erro ao salvar o boleto.", "error");
          }
        }
      }

      const fileInput = overlay.querySelector("#bm-file");
      const file      = fileInput && fileInput.files[0];

      if (file) {
        if (file.size > 3 * 1024 * 1024) {
          UI.toast("Arquivo muito grande. O limite é 3 MB.", "error");
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          payload.attachment = { name: file.name, type: file.type, data: e.target.result };
          doSave(payload);
        };
        reader.onerror = () => UI.toast("Não foi possível ler o arquivo.", "error");
        reader.readAsDataURL(file);
      } else {
        doSave(payload);
      }
    });
  }

  function openCostModal(costId, onSaved) {
    const isNew = !costId;
    const cost  = costId ? DB.Costs.get(costId) : null;
    const knownTypes = Array.from(new Set([...COST_TYPES, ...DB.Costs.list().map((c) => c.type)])).filter(Boolean);

    const html = `
      <div class="modal-header">
        <h3>${isNew ? "Novo Custo" : "Editar Custo"}</h3>
        <button class="modal-close" id="cs-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Tipo de custo *</label>
          <input type="text" class="form-control" id="cs-type" list="cs-type-options" value="${cost ? UI.escapeHtml(cost.type) : ""}" placeholder="Ex: Funcionários, Inteligência Artificial, Banco de Dados..." />
          <datalist id="cs-type-options">
            ${knownTypes.map((t) => `<option value="${UI.escapeHtml(t)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição *</label>
          <input type="text" class="form-control" id="cs-desc" value="${cost ? UI.escapeHtml(cost.description) : ""}" placeholder="Ex: Salário equipe de dev, Assinatura Claude API..." />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Valor (R$) *</label>
            <input type="number" class="form-control" id="cs-amount" value="${cost ? cost.amount : ""}" min="0" step="0.01" placeholder="0,00" />
          </div>
          <div class="form-group">
            <label class="form-label">De *</label>
            <input type="month" class="form-control" id="cs-month" value="${cost ? cost.month : currentYM()}" />
          </div>
          <div class="form-group">
            <label class="form-label">Até (opcional)</label>
            <input type="month" class="form-control" id="cs-end-month" value="${cost && cost.endMonth ? cost.endMonth : ""}" />
          </div>
        </div>
        <div class="text-sm text-muted" style="margin-top:-8px;">
          Preencha "Até" para um custo que se repete por vários meses (ex: Software de Out a Dez) — o valor acima é considerado mensal e será contado em cada mês do período.
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cs-cancel">Cancelar</button>
        <button class="btn btn-primary" id="cs-save">${isNew ? "Criar Custo" : "Salvar Alterações"}</button>
      </div>`;

    const overlay = UI.showModal(html, { static: true });
    overlay.querySelector("#cs-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#cs-cancel").addEventListener("click", UI.hideModal);

    overlay.querySelector("#cs-save").addEventListener("click", () => {
      const type        = overlay.querySelector("#cs-type").value.trim();
      const description = overlay.querySelector("#cs-desc").value.trim();
      const amount      = parseFloat(overlay.querySelector("#cs-amount").value);
      const month       = overlay.querySelector("#cs-month").value;
      const endMonth    = overlay.querySelector("#cs-end-month").value || null;

      if (!type || !description || !amount || !month) {
        UI.toast("Preencha todos os campos obrigatórios (*).", "error");
        return;
      }
      if (endMonth && endMonth < month) {
        UI.toast('O mês "Até" não pode ser anterior ao mês "De".', "error");
        return;
      }

      const payload = { type, description, amount, month, endMonth };
      if (isNew) {
        DB.Costs.create(payload);
        UI.toast("Custo cadastrado com sucesso.", "success");
      } else {
        DB.Costs.update(cost.id, payload);
        UI.toast("Custo atualizado.", "success");
      }
      UI.hideModal();
      if (onSaved) onSaved();
    });
  }

  function openContractModal(co, onSaved) {
    const signed = co.contractSignedAt;
    const hasCtr = (co.contractText && co.contractText.trim()) || co.contractFile;

    function fmtDT(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    const signatureInfo = signed
      ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--color-success-light,#dcfce7);border-radius:8px;font-size:13px;font-weight:600;color:var(--color-success,#16a34a);margin-bottom:14px;">
           ✅ Assinado por <strong>${UI.escapeHtml(co.contractSignedBy || "")}</strong> em ${fmtDT(co.contractSignedAt)}
           ${signed ? `<button class="btn btn-ghost btn-sm" id="ct-reset" style="margin-left:auto;color:var(--color-danger);font-weight:600;">🔄 Resetar assinatura</button>` : ""}
         </div>`
      : (hasCtr
          ? `<div style="padding:8px 14px;background:var(--color-warning-light,#fff8e1);border-radius:8px;font-size:13px;font-weight:600;color:var(--color-warning,#b45309);margin-bottom:14px;">📝 Aguardando assinatura da empresa</div>`
          : `<div style="padding:8px 14px;background:var(--bg-surface);border:1px dashed var(--border-color);border-radius:8px;font-size:13px;color:var(--text-muted);margin-bottom:14px;">📄 Nenhum contrato cadastrado</div>`);

    const fileRow = co.contractFile ? `
      <div id="ct-file-current" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-soft,var(--bg-surface));border:1px solid var(--border-color);border-radius:8px;margin-bottom:8px;">
        <span>📎</span>
        <span class="text-sm" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${UI.escapeHtml(co.contractFile.name)}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="ct-view-file" title="Visualizar">👁️</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ct-remove-file" title="Remover arquivo" style="color:var(--color-danger);">✕</button>
      </div>` : "";

    const html = `
      <div class="modal-header">
        <h3>📄 Contrato — ${UI.escapeHtml(co.name)}</h3>
        <button class="modal-close" id="ct-close">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-muted" style="margin-bottom:14px;">Configure o contrato desta empresa. Pode anexar um arquivo PDF ou escrever o texto. A empresa precisará assinar antes de acessar os boletos.</p>
        ${signatureInfo}

        <div class="form-group">
          <label class="form-label">📎 Arquivo do contrato (PDF, PNG ou JPG — máx. 5 MB)</label>
          ${fileRow}
          <input type="file" class="form-control" id="ct-file" accept=".pdf,.png,.jpg,.jpeg" style="padding:6px;" />
          ${co.contractFile ? `<div class="text-sm text-muted" style="margin-top:4px;">Selecione um novo arquivo para substituir o atual.</div>` : ""}
        </div>

        <div class="form-group">
          <label class="form-label">Texto complementar do contrato (opcional)</label>
          <textarea class="form-control" id="ct-text" rows="7" style="resize:vertical;font-size:13px;line-height:1.7;" placeholder="Cole ou escreva aqui o texto do contrato (pode usar junto com o arquivo acima)...">${UI.escapeHtml(co.contractText || "")}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="ct-cancel">Cancelar</button>
        <button class="btn btn-primary" id="ct-save">Salvar Contrato</button>
      </div>`;

    const overlay = UI.showModal(html);
    overlay.querySelector("#ct-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#ct-cancel").addEventListener("click", UI.hideModal);

    const resetBtn = overlay.querySelector("#ct-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (UI.confirmDialog(`Resetar a assinatura de ${co.name}? A empresa precisará assinar novamente ao acessar o portal.`)) {
          DB.Companies.resetContractSign(co.id);
          UI.toast("Assinatura resetada. A empresa deverá assinar novamente.", "success");
          UI.hideModal();
          if (onSaved) onSaved();
        }
      });
    }

    const viewFileBtn = overlay.querySelector("#ct-view-file");
    if (viewFileBtn) {
      viewFileBtn.addEventListener("click", () => UI.openAttachment(co.contractFile));
    }

    let removeFile = false;
    const removeFileBtn = overlay.querySelector("#ct-remove-file");
    if (removeFileBtn) {
      removeFileBtn.addEventListener("click", () => {
        removeFile = true;
        overlay.querySelector("#ct-file-current").style.display = "none";
        UI.toast("Arquivo será removido ao salvar.", "success");
      });
    }

    overlay.querySelector("#ct-save").addEventListener("click", () => {
      const text     = overlay.querySelector("#ct-text").value;
      const fileInput = overlay.querySelector("#ct-file");
      const file      = fileInput && fileInput.files[0];

      const patch = { contractText: text };
      if (removeFile) patch.contractFile = null;

      function doSave(finalPatch) {
        try {
          DB.Companies.update(co.id, finalPatch);
          UI.toast("Contrato salvo com sucesso.", "success");
          UI.hideModal();
          if (onSaved) onSaved();
        } catch (err) {
          if (err.name === "QuotaExceededError") {
            UI.toast("Arquivo muito grande para o armazenamento. Reduza o tamanho e tente novamente.", "error");
          } else {
            UI.toast("Erro ao salvar o contrato.", "error");
          }
        }
      }

      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          UI.toast("Arquivo muito grande. O limite é 5 MB.", "error");
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          patch.contractFile = { name: file.name, type: file.type, data: e.target.result };
          doSave(patch);
        };
        reader.onerror = () => UI.toast("Não foi possível ler o arquivo.", "error");
        reader.readAsDataURL(file);
      } else {
        doSave(patch);
      }
    });
  }

  function openCompanyAccessModal(co, onSaved) {
    const existing = DB.Users.list().find((u) => u.role === "company" && u.companyId === co.id);

    const statusBadge = existing
      ? `<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--color-success-light);border-radius:8px;margin-bottom:16px;font-size:13px;color:var(--color-success);font-weight:600;">✅ Acesso ativo · E-mail: ${UI.escapeHtml(existing.email)}</div>`
      : `<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--bg-surface);border:1px dashed var(--border-color);border-radius:8px;margin-bottom:16px;font-size:13px;color:var(--text-muted);">⚪ Sem acesso configurado para esta empresa</div>`;

    const html = `
      <div class="modal-header">
        <h3>🔑 Acesso ao Portal — ${UI.escapeHtml(co.name)}</h3>
        <button class="modal-close" id="ca-close">✕</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-muted" style="margin-bottom:16px;">Defina as credenciais de acesso desta empresa ao portal de boletos. Ela verá apenas os próprios boletos.</p>
        ${statusBadge}
        <div class="form-group">
          <label class="form-label">E-mail de acesso</label>
          <input type="email" class="form-control" id="ca-email" value="${existing ? UI.escapeHtml(existing.email) : UI.escapeHtml(co.email || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Senha ${existing ? "(deixe em branco para manter a atual)" : "*"}</label>
          <input type="text" class="form-control" id="ca-pass" placeholder="${existing ? "••••••••" : "Defina uma senha"}" autocomplete="new-password" />
        </div>
      </div>
      <div class="modal-footer">
        ${existing ? `<button class="btn btn-ghost" id="ca-revoke" style="margin-right:auto;color:var(--color-danger);">🚫 Revogar Acesso</button>` : ""}
        <button class="btn btn-secondary" id="ca-cancel">Cancelar</button>
        <button class="btn btn-primary" id="ca-save">${existing ? "Atualizar Acesso" : "Criar Acesso"}</button>
      </div>`;

    const overlay = UI.showModal(html);
    overlay.querySelector("#ca-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#ca-cancel").addEventListener("click", UI.hideModal);

    const revokeBtn = overlay.querySelector("#ca-revoke");
    if (revokeBtn) {
      revokeBtn.addEventListener("click", async () => {
        if (UI.confirmDialog(`Revogar o acesso de ${co.name} ao portal? Ela não poderá mais entrar.`)) {
          const result = await DB.Users.remove(existing.id);
          if (!result.ok) {
            UI.toast(result.message || "Não foi possível revogar o acesso.", "error");
            return;
          }
          UI.toast("Acesso revogado.", "success");
          UI.hideModal();
          if (onSaved) onSaved();
        }
      });
    }

    overlay.querySelector("#ca-save").addEventListener("click", async () => {
      const email = overlay.querySelector("#ca-email").value.trim();
      const pass  = overlay.querySelector("#ca-pass").value.trim();
      if (!email) { UI.toast("Informe o e-mail de acesso.", "error"); return; }
      if (!existing && !pass) { UI.toast("Defina uma senha para criar o acesso.", "error"); return; }

      const saveBtn = overlay.querySelector("#ca-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando...";

      let result;
      if (existing) {
        const patch = { name: co.name, email, companyId: co.id };
        if (pass) patch.password = pass;
        result = await DB.Users.update(existing.id, patch);
      } else {
        result = await DB.Users.create({
          name: co.name, email, password: pass, role: "company",
          companyId: co.id, team: null, position: "Portal Empresa",
          avatar: co.name.split(" ").slice(0,2).map((p) => p[0]).join("").toUpperCase(),
          status: "offline", permissions: ["boletos:own"], performance: 0
        });
      }

      if (!result.ok) {
        UI.toast(result.message || "Não foi possível salvar o acesso.", "error");
        saveBtn.disabled = false;
        saveBtn.textContent = existing ? "Atualizar Acesso" : "Criar Acesso";
        return;
      }
      UI.toast(existing ? "Acesso atualizado." : "Acesso ao portal criado com sucesso.", "success");
      UI.hideModal();
      if (onSaved) onSaved();
    });
  }

  function openCompanyModal(companyId, onSaved) {
    const co    = companyId ? DB.Companies.get(companyId) : null;
    const isNew = !co;

    const html = `
      <div class="modal-header">
        <h3>${isNew ? "Nova Empresa" : "Editar Empresa"}</h3>
        <button class="modal-close" id="cm-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="flex items-center gap-3" style="margin-bottom:18px;">
          <div id="cm-photo-wrap">${co && co.photo
            ? `<div class="avatar avatar-lg"><img src="${co.photo}" alt="${UI.escapeHtml(co.name)}" /></div>`
            : `<div class="avatar avatar-lg">${UI.escapeHtml(co ? co.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "?")}</div>`}</div>
          <div>
            <div class="flex gap-2">
              <label class="btn btn-secondary" style="cursor:pointer; padding:6px 12px; font-size:12px;">
                Trocar foto
                <input type="file" accept="image/*" id="cm-photo-input" style="display:none;" />
              </label>
              <button type="button" class="btn btn-ghost" id="cm-remove-photo" style="padding:6px 12px; font-size:12px; ${co && co.photo ? "" : "display:none;"}">Remover foto</button>
            </div>
            <div class="text-sm text-muted" style="margin-top:6px;">Logo ou foto da empresa (opcional, máx. 3MB).</div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label class="form-label">Razão social *</label>
            <input type="text" class="form-control" id="cm-name" value="${co ? UI.escapeHtml(co.name) : ""}" placeholder="Nome da empresa" />
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">Status</label>
            <select class="form-control" id="cm-status">
              <option value="ativo"   ${!co || co.status === "ativo"   ? "selected" : ""}>Ativo</option>
              <option value="inativo" ${co && co.status === "inativo"  ? "selected" : ""}>Inativo</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">CNPJ</label>
          <input type="text" class="form-control" id="cm-cnpj" value="${co ? UI.escapeHtml(co.cnpj || "") : ""}" placeholder="00.000.000/0001-00" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Contato responsável</label>
            <input type="text" class="form-control" id="cm-contact" value="${co ? UI.escapeHtml(co.contact || "") : ""}" />
          </div>
          <div class="form-group">
            <label class="form-label">Telefone</label>
            <input type="text" class="form-control" id="cm-phone" value="${co ? UI.escapeHtml(co.phone || "") : ""}" placeholder="(00) 00000-0000" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label class="form-label">E-mail</label>
            <input type="email" class="form-control" id="cm-email" value="${co ? UI.escapeHtml(co.email || "") : ""}" />
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">Cliente desde</label>
            <input type="month" class="form-control" id="cm-since" value="${co ? co.since || "" : ""}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Duração do contrato</label>
          <input type="text" class="form-control" id="cm-contract-duration" value="${co ? UI.escapeHtml(co.contractDuration || "") : ""}" placeholder="Ex: 12 meses, 1 ano, indeterminado" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cm-cancel">Cancelar</button>
        <button class="btn btn-primary" id="cm-save">${isNew ? "Cadastrar Empresa" : "Salvar Alterações"}</button>
      </div>`;

    let photoDataUrl = co ? co.photo || null : null;

    const overlay = UI.showModal(html, { static: true });
    overlay.querySelector("#cm-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#cm-cancel").addEventListener("click", UI.hideModal);

    function renderPhotoPreview() {
      const initials = UI.escapeHtml(overlay.querySelector("#cm-name").value.trim().split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?");
      overlay.querySelector("#cm-photo-wrap").innerHTML = photoDataUrl
        ? `<div class="avatar avatar-lg"><img src="${photoDataUrl}" alt="" /></div>`
        : `<div class="avatar avatar-lg">${initials}</div>`;
      overlay.querySelector("#cm-remove-photo").style.display = photoDataUrl ? "" : "none";
    }

    overlay.querySelector("#cm-photo-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) { UI.toast("Selecione um arquivo de imagem.", "error"); return; }
      if (file.size > 3 * 1024 * 1024) { UI.toast("Imagem muito grande (máx. 3MB).", "error"); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        photoDataUrl = ev.target.result;
        renderPhotoPreview();
      };
      reader.readAsDataURL(file);
    });
    overlay.querySelector("#cm-remove-photo").addEventListener("click", () => {
      photoDataUrl = null;
      renderPhotoPreview();
    });

    overlay.querySelector("#cm-save").addEventListener("click", () => {
      const name = overlay.querySelector("#cm-name").value.trim();
      if (!name) { UI.toast("Informe o nome da empresa.", "error"); return; }
      const payload = {
        name,
        cnpj:    overlay.querySelector("#cm-cnpj").value.trim(),
        contact: overlay.querySelector("#cm-contact").value.trim(),
        email:   overlay.querySelector("#cm-email").value.trim(),
        phone:   overlay.querySelector("#cm-phone").value.trim(),
        since:   overlay.querySelector("#cm-since").value,
        status:  overlay.querySelector("#cm-status").value,
        contractDuration: overlay.querySelector("#cm-contract-duration").value.trim(),
        photo:   photoDataUrl
      };
      if (isNew) {
        DB.Companies.create(payload);
        UI.toast("Empresa cadastrada com sucesso.", "success");
      } else {
        DB.Companies.update(co.id, payload);
        UI.toast("Empresa atualizada.", "success");
      }
      UI.hideModal();
      if (onSaved) onSaved();
    });
  }

  /* ================================================================= */
  /* RENDER PRINCIPAL                                                   */
  /* ================================================================= */

  window.Views.financial = function (container, ctx) {
    function render() {
      container.innerHTML = `
        <div class="page-header">
          <div>
            <h1>Financeiro</h1>
            <p class="page-subtitle">Gerencie boletos, empresas atendidas e recebíveis mensais.</p>
          </div>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:24px;border-bottom:2px solid var(--border-color);">
          ${[["boletos","💰 Boletos"],["custos","💸 Custos"],["empresas","🏢 Empresas"]].map(([id, label]) => {
            const active = state.tab === id;
            return `<button data-tab="${id}" style="padding:10px 22px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;color:${active ? "var(--color-primary)" : "var(--text-muted)"};border-bottom:2px solid ${active ? "var(--color-primary)" : "transparent"};margin-bottom:-2px;transition:color .2s,border-color .2s;">${label}</button>`;
          }).join("")}
        </div>
        <div id="fin-content"></div>`;

      container.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.tab = btn.dataset.tab;
          render();
        });
      });

      const wrap = container.querySelector("#fin-content");
      if (state.tab === "boletos") renderBoletosTab(wrap);
      else if (state.tab === "custos") renderCustosTab(wrap);
      else renderEmpresasTab(wrap);
    }

    render();
  };
})();
