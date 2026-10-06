// The setup page's server: who may talk to it, what it shows, and that Install runs the tools'
// own commands in order, streaming each step.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "../src/server.mjs";
import { sandbox, fakeTools } from "./helpers.mjs";

/** A request with full control over the headers (fetch will not set Host). */
function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: "127.0.0.1", port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function start() {
  const box = sandbox();
  const tools = fakeTools();
  const server = startServer({ sources: tools.sources, env: box.env, project: box.project });
  const url = await server.listening;
  const { port } = new URL(url);
  const base = `http://127.0.0.1:${port}`;
  const api = (path, body, extra = {}) => request(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { host: `127.0.0.1:${port}`, "x-toolkit-token": server.token, ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
    body,
  });
  return { box, tools, server, url, port, base, api };
}

test("the page needs the token from the link; its script and style run only with the page's nonce", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  assert.equal((await request(`${s.base}/`, { headers: { host: `127.0.0.1:${s.port}` } })).status, 403);
  assert.equal((await request(`${s.base}/?t=wrong`, { headers: { host: `127.0.0.1:${s.port}` } })).status, 403);
  const page = await request(s.url, { headers: { host: `127.0.0.1:${s.port}` } });
  assert.equal(page.status, 200);
  const csp = page.headers["content-security-policy"];
  const nonce = /'nonce-([^']+)'/.exec(csp)[1];
  assert.match(csp, /default-src 'none'/);
  assert.ok(page.text.includes(`<script nonce="${nonce}">`) && page.text.includes(`<style nonce="${nonce}">`));
  assert.equal(page.text.includes("__NONCE__"), false);
});

test("requests for another host name, from another origin, or without the token are refused", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  assert.equal((await request(s.url, { headers: { host: "evil.example:80" } })).status, 403, "DNS rebinding");
  assert.equal((await s.api("/api/state", undefined, { "x-toolkit-token": "nope" })).status, 403);
  assert.equal((await s.api("/api/apply", { choices: {} }, { origin: "https://evil.example" })).status, 403, "another site's page");
  assert.equal((await s.api("/api/apply", "{}", { "content-type": "text/plain" })).status, 415, "a plain form post");
  assert.equal((await s.api("/api/state")).status, 200);
});

test("the state lists all ten tools, the recommended ones switched on, and the glow themes", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  const st = JSON.parse((await s.api("/api/state")).text);
  assert.equal(st.tools.length, 10);
  assert.equal(st.ready, true);
  assert.deepEqual(st.glowThemes.map((x) => x.slug), ["classic", "nord"]);
  assert.deepEqual(Object.entries(st.choices).filter(([, c]) => c.enabled).map(([id]) => id), ["guardrails", "notify", "glow"]);
  assert.equal(st.configDir, s.box.cfg);
});

test("Install runs each tool's own command, in order, and streams every step", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  const res = await s.api("/api/apply", { choices: { guardrails: { enabled: true, options: { preset: "strict" } }, glow: { enabled: true, options: { theme: "nord" } } } });
  assert.equal(res.status, 200);
  const events = res.text.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(events[0], { type: "plan", steps: ["Install Guardrails", "Install Glow"], notes: [] });
  assert.deepEqual(events.slice(1, -1).map((e) => `${e.index}:${e.status}`), ["0:running", "0:ok", "1:running", "1:ok"]);
  assert.deepEqual(events.at(-1), { type: "done", ok: true, notes: [] });
  assert.deepEqual(s.tools.calls().map((c) => [c.repo, ...c.args]), [
    ["claude-code-guardrails", "init", "--preset", "strict", "--scope", "user"],
    ["claude-code-glow", "install", "--theme", "nord", "--icons", "unicode"],
  ]);
});

test("a failing tool is reported with its output, and the others still run", async (t) => {
  const s = await start();
  s.box.env.FAKE_FAIL = "claude-code-notify";
  t.after(() => s.server.close());
  const res = await s.api("/api/apply", { choices: { notify: { enabled: true, options: {} }, glow: { enabled: true, options: {} } } });
  const events = res.text.trim().split("\n").map((l) => JSON.parse(l));
  const steps = events.filter((e) => e.type === "step" && e.status !== "running");
  assert.deepEqual(steps.map((e) => e.status), ["failed", "skipped", "ok"], "notify init fails, its set line is skipped, glow installs");
  assert.match(steps[0].output, /it broke/);
  assert.equal(events.at(-1).ok, false);
});

test("bad choices come back as reasons, and nothing runs", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  const res = await s.api("/api/apply", { choices: { guardrails: { enabled: true, options: { preset: "max" } } } });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.text).errors[0], /preset must be one of/);
  assert.deepEqual(s.tools.calls(), []);
});

test("Run now actions run in the project; unknown ones are refused; another project folder can be chosen", async (t) => {
  const s = await start();
  t.after(() => s.server.close());
  const ok = JSON.parse((await s.api("/api/action", { tool: "md-doctor", action: "check" })).text);
  assert.equal(ok.ok, true);
  assert.deepEqual(s.tools.calls().map((c) => [c.repo, ...c.args]), [["claude-md-doctor", s.box.project]]);
  assert.equal((await s.api("/api/action", { tool: "md-doctor", action: "rm" })).status, 400);
  assert.equal((await s.api("/api/action", { tool: "nope", action: "check" })).status, 400);
  assert.equal((await s.api("/api/project", { dir: `${s.box.project}/missing` })).status, 400);
  const moved = JSON.parse((await s.api("/api/project", { dir: s.box.home })).text);
  assert.equal(moved.project.dir, s.box.home);
});

test("Done stops the server", async () => {
  const s = await start();
  assert.equal((await s.api("/api/quit", {})).status, 200);
  await s.server.closed;
});
