const path = require("path");

// Load server/.env by absolute path, same as Vertex, so it's found no matter
// which folder the process is started from. Real environment variables
// (Render, etc.) always win over the file.
const ENV_PATH = path.join(__dirname, ".env");
require("dotenv").config({ path: ENV_PATH });

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const ADMIN_EMAIL = "revealmabeba02@gmail.com";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!SUPABASE_READY) {
  console.warn(
    "\n[WARNING] SUPABASE_URL / SUPABASE_ANON_KEY not set.\n" +
    "Accounts, Learning Hub progress, Signal Center notes and VIP status\n" +
    "will not work until server/.env has real values (see .env.example).\n"
  );
}

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "200kb" }));

// --- Pages ----------------------------------------------------------------
function page(name) {
  return path.join(__dirname, "..", "pages", name);
}
function sendFreshPage(res, name) {
  res.set("Cache-Control", "no-store");
  res.sendFile(page(name));
}

app.get("/", (req, res) => sendFreshPage(res, "landing.html"));
app.get("/login", (req, res) => sendFreshPage(res, "login.html"));
app.get("/signup", (req, res) => sendFreshPage(res, "signup.html"));
app.get("/app", (req, res) => sendFreshPage(res, "app.html"));
app.get("/admin", (req, res) => sendFreshPage(res, "admin.html"));

app.get("/config.js", (req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-store");
  res.send(
    "window.APP_CONFIG = " +
      JSON.stringify({
        supabaseUrl: SUPABASE_READY ? SUPABASE_URL : "",
        supabaseAnonKey: SUPABASE_READY ? SUPABASE_ANON_KEY : "",
        ready: SUPABASE_READY
      }) +
      ";"
  );
});

app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
app.use("/content", express.static(path.join(__dirname, "..", "content")));

// --- Auth: verify a Supabase access token, same pattern as Vertex ---------
async function requireUser(req, res, next) {
  if (!SUPABASE_READY) {
    return res.status(503).json({ error: "Accounts are not set up on this server yet." });
  }
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) return res.status(401).json({ error: "Please log in." });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${match[1]}` },
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(401).json({ error: "Your session has expired. Please log in again." });
    }
    if (!r.ok) return res.status(502).json({ error: "Could not verify your account right now." });
    const user = await r.json();
    if (!user?.id) return res.status(401).json({ error: "Please log in." });
    req.user = { id: user.id, email: user.email, token: match[1] };
    next();
  } catch (err) {
    console.error("Supabase user check error:", err.message);
    res.status(502).json({ error: "Could not verify your account right now." });
  }
}

async function supabaseRpc(fnName, args, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args || {}),
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const message = (data && (data.message || data.error)) || `RPC ${fnName} failed (${r.status})`;
    throw new Error(message);
  }
  return data;
}

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." }
});

// --- Routes -----------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, accounts: SUPABASE_READY });
});

// Called once right after login (see public/app.js) to make sure this
// account has a profiles row — see ensure_profile() in supabase/schema.sql.
app.post("/api/me/ensure", requireUser, async (req, res) => {
  try {
    await supabaseRpc("ensure_profile", {}, req.user.token);
    res.json({ ok: true });
  } catch (err) {
    console.error("ensure_profile error:", err.message);
    res.status(502).json({ error: "Could not set up your profile. Please try again." });
  }
});

app.get("/api/me/vip", requireUser, async (req, res) => {
  try {
    const isVip = await supabaseRpc("my_vip_status", {}, req.user.token);
    res.json({ isVip: isVip === true });
  } catch (err) {
    console.error("my_vip_status error:", err.message);
    res.status(502).json({ error: "Could not check VIP status." });
  }
});

// --- Signal Center: a user's own setup notes --------------------------------
app.get("/api/signals", requireUser, async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/signal_notes?select=id,pair,notes,created_at&order=created_at.desc&limit=50`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${req.user.token}` } }
    );
    const data = await r.json().catch(() => []);
    if (!r.ok) throw new Error("Could not load signal notes.");
    res.json({ notes: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error("List signal notes error:", err.message);
    res.status(502).json({ error: "Could not load your setup notes." });
  }
});

app.post("/api/signals", requireUser, writeLimiter, async (req, res) => {
  const pair = String(req.body?.pair || "XAUUSD").trim().slice(0, 20) || "XAUUSD";
  const notes = String(req.body?.notes || "").trim();
  if (!notes) return res.status(400).json({ error: "Write a note first." });
  if (notes.length > 2000) return res.status(400).json({ error: "Keep it under 2000 characters." });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/signal_notes`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${req.user.token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ user_id: req.user.id, pair, notes })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error("Could not save the note.");
    res.json({ note: Array.isArray(data) ? data[0] : data });
  } catch (err) {
    console.error("Create signal note error:", err.message);
    res.status(502).json({ error: "Could not save your note. Please try again." });
  }
});

app.delete("/api/signals/:id", requireUser, async (req, res) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/signal_notes?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${req.user.token}` }
    });
    if (!r.ok) throw new Error("Could not delete the note.");
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete signal note error:", err.message);
    res.status(502).json({ error: "Could not delete that note." });
  }
});

// --- Learning Hub progress ---------------------------------------------------
const LESSON_SLUGS = ["forex-basics", "risk-management", "chart-structure"];

app.get("/api/learning/progress", requireUser, async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/learning_progress?select=lesson_slug&user_id=eq.${req.user.id}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${req.user.token}` } }
    );
    const data = await r.json().catch(() => []);
    if (!r.ok) throw new Error("Could not load progress.");
    const done = Array.isArray(data) ? data.map((row) => row.lesson_slug) : [];
    res.json({ done });
  } catch (err) {
    console.error("Learning progress error:", err.message);
    res.status(502).json({ error: "Could not load your learning progress." });
  }
});

app.post("/api/learning/complete", requireUser, writeLimiter, async (req, res) => {
  const slug = String(req.body?.slug || "");
  if (!LESSON_SLUGS.includes(slug)) return res.status(400).json({ error: "Unknown lesson." });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/learning_progress`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${req.user.token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({ user_id: req.user.id, lesson_slug: slug })
    });
    if (!r.ok) throw new Error("Could not save progress.");
    res.json({ ok: true });
  } catch (err) {
    console.error("Mark lesson complete error:", err.message);
    res.status(502).json({ error: "Could not save your progress." });
  }
});

// --- Admin -------------------------------------------------------------------
app.get("/api/admin/users", requireUser, async (req, res) => {
  if ((req.user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Not authorized." });
  }
  try {
    const users = await supabaseRpc("admin_list_users", {}, req.user.token);
    res.json({ users: Array.isArray(users) ? users : [] });
  } catch (err) {
    console.error("Admin list users error:", err.message);
    res.status(502).json({ error: "Could not load users." });
  }
});

app.post("/api/admin/vip", requireUser, async (req, res) => {
  if ((req.user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Not authorized." });
  }
  const email = String(req.body?.email || "").trim();
  const vip = req.body?.vip === true;
  if (!email) return res.status(400).json({ error: "Missing email." });
  try {
    const found = await supabaseRpc("admin_set_vip", { p_email: email, p_vip: vip }, req.user.token);
    res.json({ ok: true, found: found === true });
  } catch (err) {
    console.error("Admin set VIP error:", err.message);
    res.status(502).json({ error: "Could not update VIP status." });
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.get("*", (req, res) => res.redirect("/"));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
  console.log(`Shadow FX server listening on port ${PORT}`);
});
