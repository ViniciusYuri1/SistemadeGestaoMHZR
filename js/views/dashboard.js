/* ==========================================================================
   views/dashboard.js — Painel com indicadores, gráficos, calendário mini
   e atividades recentes.
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const STATUS_LABELS = {
    backlog: "Backlog",
    nao_iniciada: "A Fazer",
    em_andamento: "Em Progresso",
    em_revisao: "Revisão",
    concluida: "Concluído"
  };
  const PRIORITY_COLORS = {
    baixa: "#6a8caf",
    media: "#d9a441",
    alta: "#c1543d",
    urgente: "#a8432e"
  };
  const PRIORITY_LABELS = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };

  function scopedTasks(ctx) {
    return DB.Tasks.list({ assignee: DB.canSeeAllTasks(ctx.user) ? undefined : ctx.user.id, includeArchived: true });
  }

  function statCardsHtml(ctx) {
    const tasks = scopedTasks(ctx);
    const total = tasks.length;
    const concluded = tasks.filter((t) => t.status === "concluida").length;
    const inProgress = tasks.filter((t) => t.status === "em_andamento").length;
    const overdue = tasks.filter((t) => DB.Tasks.isOverdue(t)).length;
    const activeUsers = DB.Users.list().filter((u) => u.status !== "offline").length;
    const productivity = total ? Math.round((concluded / total) * 100) : 0;

    const cards = [
      { label: "Total de Tarefas", value: total, icon: "📋", bg: "var(--color-primary-light)", color: "var(--color-primary)" },
      { label: "Concluídas", value: concluded, icon: "✅", bg: "var(--color-success-light)", color: "var(--color-success)" },
      { label: "Em andamento", value: inProgress, icon: "⏳", bg: "var(--color-info-light)", color: "var(--color-info)" },
      { label: "Atrasadas", value: overdue, icon: "⚠️", bg: "var(--color-danger-light)", color: "var(--color-danger)" }
    ];
    if (ctx.user.role === "admin") {
      cards.push({ label: "Funcionários ativos", value: activeUsers, icon: "👥", bg: "var(--color-warning-light)", color: "var(--color-warning)" });
    }
    cards.push({ label: "Produtividade", value: productivity + "%", icon: "📈", bg: "var(--color-primary-light)", color: "var(--color-primary)" });

    return `<div class="stat-grid">${cards
      .map(
        (c) => `
      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-icon" style="background:${c.bg}; color:${c.color};">${c.icon}</div>
        </div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>`
      )
      .join("")}</div>`;
  }

  function statusBarChartHtml(ctx) {
    const tasks = scopedTasks(ctx);
    const statuses = Object.keys(STATUS_LABELS);
    const max = Math.max(1, ...statuses.map((s) => tasks.filter((t) => t.status === s).length));
    const colors = { backlog: "var(--text-muted)", nao_iniciada: "var(--color-accent-soft)", em_andamento: "var(--color-info)", em_revisao: "var(--color-warning)", concluida: "var(--color-success)" };

    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">Tarefas por status</h3></div>
        <div class="card-pad">
          <div style="display:flex; align-items:flex-end; gap:20px; height:180px;">
            ${statuses
              .map((s) => {
                const count = tasks.filter((t) => t.status === s).length;
                const h = Math.max(6, Math.round((count / max) * 140));
                return `
                <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:8px;">
                  <div style="font-size:13px; font-weight:700;">${count}</div>
                  <div style="width:100%; max-width:46px; height:${h}px; background:${colors[s]}; border-radius:8px 8px 0 0; transition:height .4s;"></div>
                  <div style="font-size:11.5px; color:var(--text-secondary); text-align:center;">${STATUS_LABELS[s]}</div>
                </div>`;
              })
              .join("")}
          </div>
        </div>
      </div>`;
  }

  function priorityDonutHtml(ctx) {
    const tasks = scopedTasks(ctx);
    const priorities = Object.keys(PRIORITY_LABELS);
    const total = tasks.length || 1;
    let acc = 0;
    const stops = priorities
      .map((p) => {
        const count = tasks.filter((t) => t.priority === p).length;
        const pct = (count / total) * 100;
        const from = acc;
        acc += pct;
        return `${PRIORITY_COLORS[p]} ${from}% ${acc}%`;
      })
      .join(", ");

    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">Tarefas por prioridade</h3></div>
        <div class="card-pad flex items-center gap-5" style="padding-top:24px;padding-bottom:24px;">
          <div style="width:150px;height:150px;border-radius:50%;background:conic-gradient(${stops});flex-shrink:0;position:relative;">
            <div style="position:absolute;inset:20px;background:var(--bg-surface);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;">${tasks.length}</div>
          </div>
          <div style="display:grid;grid-template-columns:12px auto 24px;align-items:center;row-gap:11px;column-gap:8px;">
            ${priorities.map((p) => {
                const count = tasks.filter((t) => t.priority === p).length;
                return `
                  <span style="width:11px;height:11px;border-radius:50%;background:${PRIORITY_COLORS[p]};display:block;"></span>
                  <span style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">${PRIORITY_LABELS[p]}</span>
                  <strong style="font-size:13px;text-align:right;">${count}</strong>`;
              }).join("")}
          </div>
        </div>
      </div>`;
  }

  function weeklyChartHtml(ctx) {
    const data = DB.Stats.weeklyCompletion(DB.canSeeAllTasks(ctx.user) ? undefined : ctx.user.id);
    const max = Math.max(1, ...data.map((d) => d.count));
    const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">Entregas nos últimos 7 dias</h3></div>
        <div class="card-pad">
          <div style="display:flex; align-items:flex-end; gap:10px; height:140px;">
            ${data
              .map((d) => {
                const h = Math.max(4, Math.round((d.count / max) * 100));
                const wd = weekdays[new Date(d.date + "T00:00:00").getDay()];
                return `
                <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px;">
                  <div style="font-size:11px; font-weight:700;">${d.count}</div>
                  <div style="width:100%; max-width:30px; height:${h}px; background:linear-gradient(180deg, var(--color-primary), var(--color-accent-soft)); border-radius:6px 6px 0 0;"></div>
                  <div style="font-size:10.5px; color:var(--text-muted);">${wd}</div>
                </div>`;
              })
              .join("")}
          </div>
        </div>
      </div>`;
  }

  function activitiesHtml() {
    const activities = DB.Activities.list(8);
    const users = DB.Users.list();
    if (!activities.length) {
      return `<div class="empty-state"><div class="empty-icon">🕊️</div>Nenhuma atividade recente.</div>`;
    }
    return activities
      .map((a) => {
        const u = users.find((x) => x.id === a.user);
        return `
        <div class="activity-item">
          ${UI.avatarHtml(u, "avatar-sm")}
          <div>
            <div class="activity-text"><strong>${UI.escapeHtml(u ? u.name : "Usuário")}</strong> ${UI.escapeHtml(a.text)}</div>
            <div class="activity-time">${UI.formatDate(a.date)}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function miniCalendarHtml(ctx) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = DB.todayISO();
    const tasksWithDue = DB.Tasks.list({ assignee: DB.canSeeAllTasks(ctx.user) ? undefined : ctx.user.id }).map((t) => t.dueDate);

    let cells = "";
    for (let i = 0; i < firstDay; i++) cells += `<td class="empty"></td>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const classes = [];
      if (iso === todayStr) classes.push("today");
      if (tasksWithDue.includes(iso)) classes.push("has-task");
      cells += `<td class="${classes.join(" ")}">${day}</td>`;
    }

    const totalCells = firstDay + daysInMonth;
    const rows = [];
    let allCells = cells.match(/<td[\s\S]*?<\/td>/g) || [];
    while (allCells.length % 7 !== 0) allCells.push(`<td class="empty"></td>`);
    for (let i = 0; i < allCells.length; i += 7) {
      rows.push(`<tr>${allCells.slice(i, i + 7).join("")}</tr>`);
    }

    const monthName = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title" style="text-transform:capitalize;">${monthName}</h3></div>
        <div class="card-pad">
          <div class="mini-calendar">
            <table>
              <thead><tr><th>D</th><th>S</th><th>T</th><th>Q</th><th>Q</th><th>S</th><th>S</th></tr></thead>
              <tbody>${rows.join("")}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  window.Views.dashboard = function (container, ctx) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Olá, ${UI.escapeHtml(ctx.user.name.split(" ")[0])} 👋</h1>
          <p class="page-subtitle">Aqui está um resumo da produtividade ${DB.canSeeAllTasks(ctx.user) ? "da equipe" : "das suas tarefas"} hoje.</p>
        </div>
        <div class="page-actions">
          ${DB.canManageTasks(ctx.user) ? `<button class="btn btn-primary" id="dash-new-task">+ Nova Tarefa</button>` : ""}
        </div>
      </div>

      ${statCardsHtml(ctx)}

      <div class="dashboard-grid">
        <div class="flex-col gap-4">
          ${statusBarChartHtml(ctx)}
          ${weeklyChartHtml(ctx)}
        </div>
        <div class="flex-col gap-4">
          ${miniCalendarHtml(ctx)}
          ${priorityDonutHtml(ctx)}
        </div>
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="card-header"><h3 class="card-title">Atividades recentes</h3></div>
        <div class="card-pad" style="max-height:320px;overflow-y:auto;">${activitiesHtml()}</div>
      </div>
    `;

    const newTaskBtn = container.querySelector("#dash-new-task");
    if (newTaskBtn) {
      newTaskBtn.addEventListener("click", () => {
        if (window.Views.openTaskModal) {
          window.Views.openTaskModal(ctx, null, () => ctx.navigate("tasks"));
        } else {
          ctx.navigate("tasks");
        }
      });
    }
  };
})();
