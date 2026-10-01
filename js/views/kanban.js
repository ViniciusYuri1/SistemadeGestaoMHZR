/* ==========================================================================
   views/kanban.js — Quadro Kanban com colunas Backlog, A Fazer,
   Em Progresso, Revisão e Concluído. Suporta arrastar e soltar (drag and
   drop) com atualização automática de status.
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const COLUMNS = [
    { status: "backlog", label: "Backlog" },
    { status: "nao_iniciada", label: "A Fazer" },
    { status: "em_andamento", label: "Em Progresso" },
    { status: "em_revisao", label: "Revisão" },
    { status: "concluida", label: "Concluído" }
  ];

  const PRIORITY_LABELS = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };

  let scope = null; // "__me__" | "" (todos) | userId — definido por perfil no 1º render

  function cardHtml(task, ctx, isAdmin) {
    const assignee = DB.Users.get(task.assignee);
    const overdue = DB.Tasks.isOverdue(task);
    const isOwner = task.assignee === ctx.user.id;
    const handoffs = task.handoffs || [];
    const handoff = handoffs.length && handoffs[handoffs.length - 1].to === task.assignee ? handoffs[handoffs.length - 1] : null;
    const handoffFrom = handoff ? (DB.Users.get(handoff.from) || {}).name || "—" : "";
    return `
      <div class="kanban-card" draggable="${isAdmin || isOwner}" data-id="${task.id}" data-readonly="${!(isAdmin || isOwner)}">
        <div class="kc-title-row">
          <span class="kc-title">${UI.escapeHtml(task.title)}</span>
          ${isAdmin ? `<button class="kc-delete-btn" data-delete-id="${task.id}" title="Excluir tarefa">🗑️</button>` : ""}
        </div>
        <div class="kc-tags">
          ${(task.tags || []).slice(0, 3).map((t) => `<span class="tag-pill">${UI.escapeHtml(t)}</span>`).join("")}
          ${handoff ? `<span class="tag-pill" title="${UI.escapeHtml(handoff.note || "")}">📨 de ${UI.escapeHtml(handoffFrom)}</span>` : ""}
        </div>
        <div class="kc-meta">
          <span class="badge badge-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>
          ${UI.avatarHtml(assignee, "avatar-sm", `title="${assignee ? UI.escapeHtml(assignee.name) : ""}"`)}
        </div>
        <div class="text-sm ${overdue ? "" : "text-muted"}" style="${overdue ? "color:var(--color-danger); font-weight:700;" : ""}">
          ${overdue ? "⚠️ Atrasada — " : "📅 "}${UI.formatDate(task.dueDate)}
        </div>
      </div>`;
  }

  function render(container, ctx) {
    const canManage = DB.canManageTasks(ctx.user);
    const canSeeAll = DB.canSeeAllTasks(ctx.user);
    if (scope === null) scope = canSeeAll ? "" : "__me__";

    const users = DB.Users.list();
    let tasks = DB.Tasks.list();
    if (scope === "__me__") tasks = tasks.filter((t) => t.assignee === ctx.user.id);
    else if (scope) tasks = tasks.filter((t) => t.assignee === scope);

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Quadro Kanban</h1>
          <p class="page-subtitle">Arraste os cartões entre as colunas para atualizar o status automaticamente. Cartões de colegas ficam disponíveis para consulta.</p>
        </div>
        <div class="page-actions">
          <select id="kb-scope">
            ${canSeeAll ? "" : `<option value="__me__" ${scope === "__me__" ? "selected" : ""}>Minhas tarefas</option>`}
            <option value="" ${scope === "" ? "selected" : ""}>Todos os responsáveis</option>
            ${users.map((u) => `<option value="${u.id}" ${scope === u.id ? "selected" : ""}>${UI.escapeHtml(u.name)}</option>`).join("")}
          </select>
          ${canManage ? `<button class="btn btn-primary" id="kb-new-task">+ Nova Tarefa</button>` : ""}
        </div>
      </div>

      <div class="kanban-board">
        ${COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          return `
          <div class="kanban-column">
            <div class="kanban-column-header">
              <span>${col.label}</span>
              <span class="kanban-count">${colTasks.length}</span>
            </div>
            <div class="kanban-cards" data-status="${col.status}">
              ${colTasks.map((t) => cardHtml(t, ctx, canManage)).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
    `;

    bindEvents(container, ctx);
  }

  function bindEvents(container, ctx) {
    container.querySelector("#kb-scope").addEventListener("change", (e) => {
      scope = e.target.value;
      render(container, ctx);
    });

    const newBtn = container.querySelector("#kb-new-task");
    if (newBtn) {
      newBtn.addEventListener("click", () => {
        window.Views.openTaskModal(ctx, null, () => render(container, ctx));
      });
    }

    container.querySelectorAll(".kc-delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.deleteId;
        const task = DB.Tasks.get(taskId);
        if (!task) return;
        if (!confirm(`Excluir a tarefa "${task.title}"?\n\nEsta ação não pode ser desfeita.`)) return;
        DB.Tasks.remove(taskId);
        UI.toast("Tarefa excluída.", "success");
        render(container, ctx);
      });
    });

    container.querySelectorAll(".kanban-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        if (card.dataset.readonly === "true") { e.preventDefault(); return; }
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", card.dataset.id);
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("click", () => {
        window.Views.openTaskModal(ctx, card.dataset.id, () => render(container, ctx));
      });
    });

    container.querySelectorAll(".kanban-cards").forEach((column) => {
      column.addEventListener("dragover", (e) => {
        e.preventDefault();
        column.classList.add("drag-over");
      });
      column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
      column.addEventListener("drop", (e) => {
        e.preventDefault();
        column.classList.remove("drag-over");
        const taskId = e.dataTransfer.getData("text/plain");
        const newStatus = column.dataset.status;
        const task = DB.Tasks.get(taskId);
        if (task && task.status !== newStatus && (DB.canManageTasks(ctx.user) || task.assignee === ctx.user.id)) {
          DB.Tasks.update(taskId, { status: newStatus });
          UI.toast(
            newStatus === "concluida"
              ? "Tarefa concluída e arquivada."
              : "Status atualizado para " + COLUMNS.find((c) => c.status === newStatus).label,
            "success"
          );
        }
        render(container, ctx);
      });
    });
  }

  window.Views.kanban = function (container, ctx) {
    render(container, ctx);
  };
})();
