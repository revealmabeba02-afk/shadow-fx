(() => {
  "use strict";

  const Auth = window.Auth;
  const root = document.documentElement;
  const revealPage = () => root.classList.remove("auth-check");
  const toLogin = () => location.replace("/login?next=" + encodeURIComponent("/app"));

  let sessionToken = null;

  if (!Auth.ready) {
    const notice = document.getElementById("setup-notice");
    const message = Auth.problemMessage();
    if (message) notice.textContent = message;
    notice.hidden = false;
    revealPage();
    return;
  }

  async function authHeader() {
    const session = await Auth.getSession();
    if (!session) { toLogin(); return null; }
    sessionToken = session.access_token;
    return { Authorization: `Bearer ${sessionToken}` };
  }

  // --------------------------------------------------------------
  // Boot: confirm session, make sure a profile row exists, reveal page.
  // --------------------------------------------------------------
  (async () => {
    const session = await Auth.getSession();
    if (!session) return toLogin();
    sessionToken = session.access_token;
    document.getElementById("account-email").textContent = session.user.email || "";
    revealPage();

    try {
      await fetch("/api/me/ensure", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } });
    } catch { /* non-fatal — profile gets created on next successful call anyway */ }

    loadLessons();
    loadSignals();
    loadVipStatus();
  })();

  document.getElementById("logout-btn").addEventListener("click", () => Auth.signOut());

  // --------------------------------------------------------------
  // Tabs
  // --------------------------------------------------------------
  const tabs = document.querySelectorAll(".dash-tab");
  const views = {
    learn: document.getElementById("view-learn"),
    signals: document.getElementById("view-signals"),
    vip: document.getElementById("view-vip")
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.view;
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      Object.entries(views).forEach(([key, el]) => el.classList.toggle("is-active", key === name));
    });
  });

  // --------------------------------------------------------------
  // Learning Hub
  // --------------------------------------------------------------
  const LESSONS = [
    { slug: "forex-basics", title: "Forex basics", file: "/content/forex-basics.md" },
    { slug: "risk-management", title: "Risk management", file: "/content/risk-management.md" },
    { slug: "chart-structure", title: "Chart structure", file: "/content/chart-structure.md" }
  ];

  // Small, deliberately limited markdown renderer — just enough for these
  // lesson files (headings, bullet lists, bold). Not a general parser.
  function renderMarkdown(text) {
    const lines = text.split("\n");
    let html = "";
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (inList) { html += "</ul>"; inList = false; } continue; }
      if (line.startsWith("## ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h3>${escapeHtml(line.slice(3))}</h3>`; continue; }
      if (line.startsWith("# ")) { if (inList) { html += "</ul>"; inList = false; } continue; } // page title, shown elsewhere
      if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${inlineMd(line.replace(/^[-*]\s+|^\d+\.\s+/, ""))}</li>`;
        continue;
      }
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${inlineMd(line)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
  }
  function inlineMd(s) {
    return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function loadLessons() {
    const listEl = document.getElementById("lesson-list");
    let done = [];
    try {
      const headers = await authHeader();
      if (!headers) return;
      const r = await fetch("/api/learning/progress", { headers });
      const data = await r.json().catch(() => null);
      if (r.ok && data) done = data.done || [];
    } catch { /* show lessons anyway, just without progress */ }

    listEl.innerHTML = "<p class=\"status-line\">Loading lessons…</p>";
    const cards = await Promise.all(
      LESSONS.map(async (lesson) => {
        let body = "Could not load this lesson.";
        try {
          const res = await fetch(lesson.file);
          if (res.ok) body = renderMarkdown(await res.text());
        } catch { /* keep fallback text */ }
        const isDone = done.includes(lesson.slug);
        return `
          <div class="lesson-card">
            <div class="lesson-card__head">
              <h3 style="margin:0;">${lesson.title}</h3>
              <span class="lesson-badge ${isDone ? "" : "lesson-badge--todo"}">${isDone ? "Completed" : "Not started"}</span>
            </div>
            <div class="lesson-card__body">${body}</div>
            <button class="btn btn--ghost" data-complete="${lesson.slug}" ${isDone ? "disabled" : ""} style="margin-top:14px;">
              ${isDone ? "Marked complete" : "Mark as complete"}
            </button>
          </div>`;
      })
    );
    listEl.innerHTML = cards.join("");

    listEl.querySelectorAll("[data-complete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const slug = btn.dataset.complete;
        btn.disabled = true;
        try {
          const headers = await authHeader();
          if (!headers) return;
          const r = await fetch("/api/learning/complete", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ slug })
          });
          if (r.ok) {
            btn.textContent = "Marked complete";
            const badge = btn.closest(".lesson-card").querySelector(".lesson-badge");
            badge.textContent = "Completed";
            badge.classList.remove("lesson-badge--todo");
          } else {
            btn.disabled = false;
          }
        } catch {
          btn.disabled = false;
        }
      });
    });
  }

  // --------------------------------------------------------------
  // Signal Center
  // --------------------------------------------------------------
  async function loadSignals() {
    const listEl = document.getElementById("note-list");
    const emptyEl = document.getElementById("note-empty");
    try {
      const headers = await authHeader();
      if (!headers) return;
      const r = await fetch("/api/signals", { headers });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && data.error) || "Could not load notes.");
      const notes = data.notes || [];
      if (notes.length === 0) { listEl.innerHTML = ""; emptyEl.hidden = false; return; }
      emptyEl.hidden = true;
      listEl.innerHTML = notes.map((n) => `
        <div class="note-item" data-id="${n.id}">
          <div class="note-item__head">
            <span class="note-item__pair">${escapeHtml(n.pair)}</span>
            <span class="note-item__date">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          <div class="note-item__body">${escapeHtml(n.notes)}</div>
          <button class="note-item__del" data-del="${n.id}">Delete</button>
        </div>
      `).join("");
      listEl.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const headers2 = await authHeader();
          if (!headers2) return;
          await fetch(`/api/signals/${btn.dataset.del}`, { method: "DELETE", headers: headers2 });
          loadSignals();
        });
      });
    } catch (err) {
      listEl.innerHTML = `<p class="status-line status-line--error">${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById("note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pair = document.getElementById("note-pair");
    const notes = document.getElementById("note-notes");
    const submitBtn = document.getElementById("note-submit");
    const status = document.getElementById("note-status");
    if (!notes.value.trim()) return;

    submitBtn.disabled = true;
    status.hidden = true;
    try {
      const headers = await authHeader();
      if (!headers) return;
      const r = await fetch("/api/signals", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ pair: pair.value.trim() || "XAUUSD", notes: notes.value.trim() })
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && data.error) || "Could not save the note.");
      notes.value = "";
      loadSignals();
    } catch (err) {
      status.textContent = err.message;
      status.className = "status-line status-line--error";
      status.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // --------------------------------------------------------------
  // VIP status
  // --------------------------------------------------------------
  async function loadVipStatus() {
    try {
      const headers = await authHeader();
      if (!headers) return;
      const r = await fetch("/api/me/vip", { headers });
      const data = await r.json().catch(() => null);
      const isVip = Boolean(r.ok && data && data.isVip);
      document.getElementById("vip-locked").hidden = isVip;
      document.getElementById("vip-unlocked").hidden = !isVip;
    } catch { /* leave default locked view showing */ }
  }
})();
