// The setup page's server: on 127.0.0.1 only, with a random token in every request, the Host and
// Origin checked (so no other web page can drive it), and a body that can only pick from the
// catalog's own command lines. It stops when the page says Done, or soon after the tab closes.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS, byId } from "./catalog.mjs";
import { readState, defaultChoices } from "./state.mjs";
import { plan } from "./plan.mjs";
import { runSteps, runTool } from "./run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "ui", "setup.html");

/** The glow themes with their swatches, from the downloaded glow, for the picker. */
export function glowThemes(sources) {
  const dir = sources.dirOf("claude-code-glow");
  if (!dir) return [];
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, "hud", "data", "themes.json"), "utf8"));
    return list.map((t) => ({ slug: t.slug, name: t.name, base: t.base, swatches: (t.glow?.swatches || t.swatches || []).slice(0, 5) }));
  } catch {
    return [];
  }
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function publicTools(state) {
  return TOOLS.map((t) => ({
    id: t.id, name: t.name, scope: t.scope, summary: t.summary, tokens: t.tokens, recommended: !!t.recommended,
    defaults: t.defaults, removable: !!t.uninstall, removeHint: t.removeHint || "",
    actions: Object.entries(t.actions || {}).map(([id, a]) => ({ id, label: a.label })),
    ...state.tools[t.id], current: state.tools[t.id].current,
  }));
}

/**
 * @param o { sources, env?, project?, port?, idleMs?, startMs?, onClose? }
 * @returns { url, token, close(), closed: Promise }
 */
export function startServer({ sources, env = process.env, project = process.cwd(), port = 0, idleMs = 120_000, startMs = 600_000, onLog = () => {} }) {
  const token = crypto.randomBytes(24).toString("base64url");
  let currentProject = path.resolve(project);
  let lastSeen = Date.now();
  let pageSeen = false;
  let busy = false;
  let ready = false;
  const failed = [];
  sources.ready.then(() => {
    ready = true;
    for (const t of TOOLS) if (!sources.dirOf(t.repo)) failed.push({ repo: t.repo, error: sources.errorOf?.(t.repo)?.message || "not available" });
  });

  const state = () => {
    const s = readState({ env, project: currentProject });
    return { configDir: s.configDir, settings: s.settings, project: s.project, ready, failed, tools: publicTools(s), choices: defaultChoices(s), glowThemes: ready ? glowThemes(sources) : [] };
  };

  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  let server;
  const send = (res, code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 65536) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("not JSON")); } });
    req.on("error", reject);
  });

  const handle = async (req, res) => {
    const { port: p } = server.address();
    const okHosts = [`127.0.0.1:${p}`, `localhost:${p}`];
    if (!okHosts.includes(req.headers.host)) return send(res, 403, { error: "wrong host" });
    if (req.headers.origin && !okHosts.map((h) => `http://${h}`).includes(req.headers.origin)) return send(res, 403, { error: "wrong origin" });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      if (!sameToken(url.searchParams.get("t"), token)) return send(res, 403, "This setup page link has expired. Run the command again.", "text/plain; charset=utf-8");
      pageSeen = true;
      lastSeen = Date.now();
      const nonce = crypto.randomBytes(16).toString("base64");
      const html = fs.readFileSync(PAGE, "utf8").replaceAll("__NONCE__", nonce);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      return res.end(html);
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (!sameToken(req.headers["x-toolkit-token"], token)) return send(res, 403, { error: "bad token" });
    lastSeen = Date.now();
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, state());
    if (req.method !== "POST") return send(res, 405, { error: "method" });
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) return send(res, 415, { error: "JSON only" });
    let body;
    try { body = await readBody(req); } catch (err) { return send(res, 400, { error: err.message }); }

    if (url.pathname === "/api/ping") return send(res, 200, { ok: true });
    if (url.pathname === "/api/quit") {
      send(res, 200, { ok: true });
      setTimeout(close, 50);
      return undefined;
    }
    if (url.pathname === "/api/project") {
      const dir = path.resolve(String(body.dir || ""));
      try { if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch { return send(res, 400, { error: `${dir} is not a folder` }); }
      currentProject = dir;
      return send(res, 200, state());
    }
    if (url.pathname === "/api/action") {
      const tool = byId(String(body.tool || ""));
      const action = tool?.actions?.[String(body.action || "")];
      if (!tool || !action) return send(res, 400, { error: "unknown action" });
      if (!ready) return send(res, 409, { error: "still downloading the tools" });
      const ctx = { project: currentProject };
      let options = {};
      try { options = tool.validate(body.options || {}, { glowThemes: glowThemes(sources) }); } catch { options = { ...tool.defaults }; }
      const r = await runTool({ sources, tool, args: action.args(options, ctx), cwd: currentProject, env });
      return send(res, 200, { ok: r.ok, output: r.output });
    }
    if (url.pathname === "/api/apply") {
      if (!ready) return send(res, 409, { error: "still downloading the tools" });
      if (busy) return send(res, 409, { error: "already applying" });
      const s = readState({ env, project: currentProject });
      const { steps, errors, notes } = plan(s, body.choices || {}, { project: currentProject, glowThemes: glowThemes(sources) });
      if (errors.length) return send(res, 400, { errors, notes });
      busy = true;
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      const line = (o) => res.write(`${JSON.stringify(o)}\n`);
      line({ type: "plan", steps: steps.map((st) => st.label), notes });
      try {
        const results = await runSteps({ steps, sources, env, onEvent: (e) => { lastSeen = Date.now(); line({ type: "step", ...e }); } });
        line({ type: "done", ok: results.every((r) => r.status === "ok"), notes });
        onLog(results);
      } finally {
        busy = false;
        res.end();
      }
      return undefined;
    }
    return send(res, 404, { error: "not found" });
  };

  server = http.createServer((req, res) => {
    handle(req, res).catch((err) => { if (!res.headersSent) send(res, 500, { error: err.message }); else res.end(); });
  });
  const idle = setInterval(() => {
    const limit = pageSeen ? idleMs : startMs;
    if (!busy && Date.now() - lastSeen > limit) close();
  }, 5000);
  idle.unref?.();
  function close() {
    clearInterval(idle);
    server.close(() => resolveClosed());
    server.closeAllConnections?.();
  }
  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    token,
    listening: listening.then(() => `http://127.0.0.1:${server.address().port}/?t=${token}`),
    close,
    closed,
  };
}
