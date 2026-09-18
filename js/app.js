/* ==========================================================================
   app.js — Shell da aplicação: autenticação, sidebar (RBAC), topbar,
   roteamento por hash e alternância de tema.
   ========================================================================== */

(async function () {
  "use strict";

  UI.initThemeFromSettings();

  /* Carrega sessão + dados do Supabase antes de montar o shell */
  document.getElementById("view-content").innerHTML =
    '<div class="empty-state"><div class="empty-icon">⏳</div><div>Carregando dados...</div></div>';

  const user = await DB.init();
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const svgIcon = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  const ROUTES = [
    { id: "dashboard", label: "Dashboard", icon: svgIcon('<line x1="4" y1="19" x2="4" y2="10"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="20" y1="19" x2="20" y2="13"/>'), roles: ["admin", "employee"], section: "Principal" },
    { id: "tasks", label: "Tarefas", icon: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'), roles: ["admin", "employee"], section: "Principal" },
    { id: "kanban", label: "Quadro Kanban", icon: svgIcon('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/>'), roles: ["admin", "employee"], section: "Principal" },
    { id: "calendar", label: "Calendário", icon: svgIcon('<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>'), roles: ["admin", "employee"], section: "Principal" },
    { id: "team", label: "Equipe", icon: svgIcon('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.4 2.5-6.2 5.5-6.2s5.5 2.8 5.5 6.2"/><circle cx="17" cy="9" r="2.4"/><path d="M15 14c2.7.5 4.7 3 4.7 6"/>'), roles: ["admin"], section: "Gestão" },
    { id: "financial", label: "Financeiro", icon: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2.3-3-2.3s-3 .8-3 2.1c0 1.3 1.2 1.9 3 2.2 1.9.3 3 1 3 2.3 0 1.3-1.3 2.2-3 2.2s-3-.9-3-2.2"/>'), roles: ["admin"], section: "Gestão" },
    { id: "reports", label: "Relatórios", icon: svgIcon('<polyline points="3,17 9,10 13,14 21,5"/><polyline points="15,5 21,5 21,11"/>'), roles: ["admin"], section: "Gestão" },
    { id: "audit", label: "Auditoria", icon: svgIcon('<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="20.5" y2="20.5"/>'), roles: ["admin"], section: "Sistema" },
    { id: "settings", label: "Configurações", icon: svgIcon('<circle cx="12" cy="12" r="3.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/>'), roles: ["admin", "employee"], section: "Sistema" },
    { id: "portal", label: "Meus Boletos", icon: svgIcon('<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3V3z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>'), roles: ["company"], section: "Portal" }
  ];

  const sidebarNav = document.getElementById("sidebar-nav");
  const viewContent = document.getElementById("view-content");
  const sidebar = document.getElementById("sidebar");

  /* ------------------------------------------------------------------ */
  /* Sidebar (renderizada conforme perfil)                              */
  /* ------------------------------------------------------------------ */

  function renderSidebar(activeRoute) {
    const allowed = ROUTES.filter((r) => r.roles.includes(user.role));
    let html = "";
    let lastSection = null;
    allowed.forEach((r) => {
      if (r.section !== lastSection) {
        html += `<div class="nav-section-title">${r.section}</div>`;
        lastSection = r.section;
      }
      html += `
        <div class="nav-item ${r.id === activeRoute ? "active" : ""}" data-route="${r.id}">
          <span class="nav-icon">${r.icon}</span>
          <span class="nav-label">${r.label}</span>
        </div>`;
    });
    sidebarNav.innerHTML = html;
    sidebarNav.querySelectorAll(".nav-item").forEach((el) => {
      el.addEventListener("click", () => {
        navigate(el.dataset.route);
        if (window.innerWidth <= 900) closeMobileSidebar();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Topbar: usuário, tema, notificações                                */
  /* ------------------------------------------------------------------ */

  function renderUserBox() {
    const avatarEl = document.getElementById("user-avatar");
    if (user.photo) {
      avatarEl.innerHTML = `<img src="${user.photo}" alt="${UI.escapeHtml(user.name)}" />`;
    } else {
      avatarEl.textContent = user.avatar || user.name.slice(0, 2).toUpperCase();
    }
    document.getElementById("user-name").textContent = user.name;
    document.getElementById("user-role").textContent =
      user.role === "admin" ? "Administrador" :
      user.role === "company" ? "Portal Empresa" :
      DB.canManageTasks(user) ? "Funcionário 2" : "Funcionário";
  }

  function renderNotifications() {
    const tasks = DB.Tasks.list({ assignee: DB.canSeeAllTasks(user) ? undefined : user.id });
    const overdue = tasks.filter((t) => DB.Tasks.isOverdue(t));
    const dueSoon = tasks.filter((t) => {
      if (t.status === "concluida") return false;
      const diff = (new Date(t.dueDate) - new Date(DB.todayISO())) / 86400000;
      return diff >= 0 && diff <= 2;
    });

    const panel = document.getElementById("notif-panel");
    const dot = document.getElementById("notif-dot");
    const items = [];

    /* Workflow entre funcionários: minhas tarefas travadas por outra pessoa,
       e tarefas minhas que estão travando o trabalho de um colega. */
    const myOpenTasks = DB.Tasks.list({ assignee: user.id }).filter((t) => t.status !== "concluida");
    myOpenTasks.forEach((t) => {
      const blockers = DB.Tasks.blockers(t);
      if (!blockers.length) return;
      const names = blockers.map((b) => `${UI.escapeHtml(b.title)} (${UI.escapeHtml((DB.Users.get(b.assignee) || {}).name || "—")})`).join(", ");
      items.push(`<div class="notif-item">⛔ <strong>${UI.escapeHtml(t.title)}</strong> aguarda: ${names}<div class="notif-time">Você ainda não pode avançar esta tarefa</div></div>`);
    });
    myOpenTasks.forEach((t) => {
      const waiting = DB.Tasks.dependents(t.id).filter((d) => d.status !== "concluida" && d.assignee !== user.id);
      if (!waiting.length) return;
      const names = waiting.map((d) => `${UI.escapeHtml(d.title)} (${UI.escapeHtml((DB.Users.get(d.assignee) || {}).name || "—")})`).join(", ");
      items.push(`<div class="notif-item">👀 Colegas aguardam você concluir <strong>${UI.escapeHtml(t.title)}</strong> para seguir com: ${names}</div>`);
    });

    /* Notificações para admin: empresas com acesso ativo mas sem contrato */
    if (user.role === "admin") {
      const allCompanies = DB.Companies.list();
      const allUsers     = DB.Users.list();
      allCompanies.forEach((co) => {
        const hasPortalUser = allUsers.some((u) => u.role === "company" && u.companyId === co.id);
        const hasCtr = (co.contractText && co.contractText.trim()) || co.contractFile;
        if (hasPortalUser && !hasCtr) {
          items.push(`<div class="notif-item" style="cursor:pointer;" onclick="window.location.hash='#/financial'">🏢 <strong>${UI.escapeHtml(co.name)}</strong> aguarda contrato<div class="notif-time">Acesso ativo sem contrato cadastrado</div></div>`);
        }
      });
    }

    overdue.forEach((t) =>
      items.push(`<div class="notif-item">🔴 <strong>${UI.escapeHtml(t.title)}</strong> está atrasada<div class="notif-time">Prazo: ${UI.formatDate(t.dueDate)}</div></div>`)
    );
    dueSoon.forEach((t) =>
      items.push(`<div class="notif-item">🟡 <strong>${UI.escapeHtml(t.title)}</strong> vence em breve<div class="notif-time">Prazo: ${UI.formatDate(t.dueDate)}</div></div>`)
    );

    dot.style.display = items.length ? "block" : "none";
    panel.innerHTML = items.length
      ? items.join("")
      : `<div class="notif-item">Nenhuma notificação por aqui 🎉</div>`;
  }

  function setThemeIcon(theme) {
    document.getElementById("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
  }

  /* ------------------------------------------------------------------ */
  /* Roteamento                                                          */
  /* ------------------------------------------------------------------ */

  const ctx = {
    user,
    navigate,
    UI,
    DB
  };

  function currentRouteFromHash() {
    const hash = window.location.hash.replace("#/", "").replace("#", "");
    return hash || "dashboard";
  }

  function navigate(routeId) {
    window.location.hash = "#/" + routeId;
  }

  function renderRoute() {
    let routeId = currentRouteFromHash();

    /* Usuários de empresa só acessam o portal */
    if (user.role === "company" && routeId !== "portal") {
      window.location.hash = "#/portal";
      return;
    }

    const route = ROUTES.find((r) => r.id === routeId);

    if (!route || !route.roles.includes(user.role)) {
      routeId = user.role === "company" ? "portal" : "dashboard";
      window.location.hash = "#/" + routeId;
      return;
    }

    renderSidebar(routeId);
    viewContent.classList.remove("fade-in");
    requestAnimationFrame(() => viewContent.classList.add("fade-in"));

    const renderer = window.Views && window.Views[routeId];
    if (typeof renderer === "function") {
      viewContent.innerHTML = "";
      renderer(viewContent, ctx);
    } else {
      viewContent.innerHTML = `<div class="empty-state"><div class="empty-icon">🚧</div><div>Tela em construção.</div></div>`;
    }

    renderNotifications();
    closeAllDropdowns();
  }

  window.addEventListener("hashchange", renderRoute);

  /* ------------------------------------------------------------------ */
  /* Tema claro/escuro                                                   */
  /* ------------------------------------------------------------------ */

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = DB.Settings.get().theme;
    const next = current === "dark" ? "light" : "dark";
    DB.Settings.update({ theme: next });
    UI.applyTheme(next);
    setThemeIcon(next);
  });

  /* ------------------------------------------------------------------ */
  /* Dropdowns (notificações / usuário)                                  */
  /* ------------------------------------------------------------------ */

  function closeAllDropdowns() {
    document.querySelectorAll(".dropdown-panel").forEach((p) => p.classList.remove("open"));
  }

  document.getElementById("notif-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("notif-panel");
    const willOpen = !panel.classList.contains("open");
    closeAllDropdowns();
    if (willOpen) panel.classList.add("open");
  });

  document.getElementById("user-menu-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("user-panel");
    const willOpen = !panel.classList.contains("open");
    closeAllDropdowns();
    if (willOpen) panel.classList.add("open");
  });

  document.getElementById("user-panel").querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.route));
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await DB.logout();
    window.location.href = "index.html";
  });

  // A sessão vive em sessionStorage: expira ao fechar a aba (sem logout manual)
  window.addEventListener("pageshow", (e) => {
    // Se a página foi restaurada do cache do navegador (bfcache), redireciona para o login
    if (e.persisted && !DB.getCurrentUser()) {
      window.location.href = "index.html";
    }
  });

  document.addEventListener("click", closeAllDropdowns);

  /* ------------------------------------------------------------------ */
  /* Sidebar recolhível                                                  */
  /* ------------------------------------------------------------------ */

  const COLLAPSE_KEY = "sgt_sidebar_collapsed";

  function applyCollapsedState() {
    const collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    sidebar.classList.toggle("collapsed", collapsed);
    document.getElementById("collapse-icon").textContent = collapsed ? "⟩⟩" : "⟨⟨";
    document.getElementById("collapse-text").textContent = collapsed ? "" : "Recolher menu";
  }

  document.getElementById("collapse-btn").addEventListener("click", () => {
    const collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    applyCollapsedState();
  });

  const sidebarOverlay = document.getElementById("sidebar-overlay");

  function closeMobileSidebar() {
    sidebar.classList.remove("mobile-open");
    sidebarOverlay.classList.remove("active");
  }

  document.getElementById("mobile-toggle").addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("mobile-open");
    sidebarOverlay.classList.toggle("active", isOpen);
  });

  sidebarOverlay.addEventListener("click", closeMobileSidebar);

  /* ------------------------------------------------------------------ */
  /* Busca global → leva para Tarefas com o termo aplicado               */
  /* ------------------------------------------------------------------ */

  document.getElementById("global-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      sessionStorage.setItem("sgt_search_term", e.target.value.trim());
      navigate("tasks");
    }
  });

  /* ------------------------------------------------------------------ */
  /* Responsivo: exibir botão de menu mobile                             */
  /* ------------------------------------------------------------------ */

  function handleResize() {
    document.getElementById("mobile-toggle").style.display = window.innerWidth <= 900 ? "flex" : "none";
  }
  window.addEventListener("resize", handleResize);

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  renderUserBox();
  setThemeIcon(DB.Settings.get().theme);
  applyCollapsedState();
  handleResize();

  /* Portal de empresa: esconde elementos de topbar irrelevantes */
  if (user.role === "company") {
    const searchWrap = document.getElementById("global-search").closest(".topbar-search");
    if (searchWrap) searchWrap.style.display = "none";
    const notifWrap = document.getElementById("notif-btn").parentElement;
    if (notifWrap) notifWrap.style.display = "none";
    document.getElementById("theme-toggle").style.display = "none";
    const collapseBtn = document.getElementById("collapse-btn");
    if (collapseBtn) collapseBtn.style.display = "none";
  }

  renderRoute();
})();
