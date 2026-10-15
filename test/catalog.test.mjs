// What each tool is asked to run, and the answers each tool refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, byId, OptionError } from "../src/catalog.mjs";

const v = (id, o, ctx) => byId(id).validate(o, ctx);
const bad = (id, o, re, ctx) => assert.throws(() => v(id, o, ctx), (e) => e instanceof OptionError && re.test(e.message));

test("every tool has a repository, a command file, a summary, a token note and valid defaults", () => {
  assert.equal(TOOLS.length, 12);
  for (const t of TOOLS) {
    assert.match(t.repo, /^claude-[a-z-]+$/, t.id);
    assert.match(t.bin, /\.mjs$/, t.id);
    assert.ok(t.summary.length > 40 && t.tokens, t.id);
    assert.doesNotThrow(() => t.validate({ ...t.defaults }, {}), t.id);
  }
});

test("install, change and uninstall command lines", () => {
  const ctx = { project: "/work/app" };
  assert.deepEqual(byId("guardrails").install(v("guardrails", {})), [["init", "--preset", "balanced", "--scope", "user"]]);
  assert.deepEqual(byId("guardrails").change(v("guardrails", { preset: "strict" }), { preset: "balanced" }), [["preset", "strict", "--scope", "user"]]);
  assert.deepEqual(byId("guardrails").change(v("guardrails", { preset: "strict" }), { preset: "strict" }), []);
  assert.deepEqual(byId("glow").install(v("glow", { theme: "nord", uiTheme: false })), [["install", "--theme", "nord", "--icons", "unicode", "--no-ui-theme"]]);
  assert.deepEqual(byId("glow").change(v("glow", { theme: "nord" }), { theme: "nord", icons: "unicode", uiTheme: true }), []);
  assert.deepEqual(byId("handover").install(v("handover", { streams: "backend, frontend" }), ctx), [["init", "--dir", "/work/app", "--models", "Opus + Sonnet", "--streams", "backend, frontend"]]);
  assert.deepEqual(byId("team-sync").install(v("team-sync", { hub: "https://github.com/acme/hub.git", name: "Ana" })), [["init", "--hub", "https://github.com/acme/hub.git", "--name", "Ana", "--yes"]]);
  assert.deepEqual(byId("starter-kits").install(v("starter-kits", { stack: "go", merge: true }), ctx), [["--dir", "/work/app", "go", "--merge"]]);
  assert.deepEqual(byId("guardrails").uninstall(), [["uninstall", "--scope", "user"]]);
  assert.equal(byId("team-sync").uninstall, null, "project tools are not removed from here");
});

test("session tidy: init and uninstall with no options, a list to look at, and not in the recommended set", () => {
  const t = byId("session-tidy");
  assert.deepEqual([t.scope, t.plugin, t.recommended], ["user", "session-tidy", false]);
  assert.deepEqual(t.install(v("session-tidy", {})), [["init"]]);
  assert.deepEqual(t.install(v("session-tidy", { preset: "ignored" })), [["init"]], "init takes no options");
  assert.deepEqual(t.change(v("session-tidy", {}), {}), [], "so there is never anything to change");
  assert.deepEqual(t.uninstall(), [["uninstall"]]);
  assert.deepEqual(t.actions.list.args({}, { project: "/work/app" }), ["list", "--project", "/work/app"]);
});

test("permission doctor: an on-demand tool like md-doctor, with nothing to install and three commands that only read, run in the project", () => {
  const t = byId("permission-doctor");
  assert.deepEqual([t.scope, t.plugin, !!t.recommended, t.install, t.change, t.uninstall], ["action", undefined, false, undefined, undefined, undefined]);
  assert.deepEqual(v("permission-doctor", { preset: "ignored" }), {}, "it has no options");
  assert.deepEqual(Object.keys(t.actions), ["show", "lint", "suggest"]);
  const ctx = { project: "/work/app" };
  assert.deepEqual(Object.values(t.actions).map((a) => a.args({}, ctx)), [["show", "--project", "/work/app"], ["lint", "--project", "/work/app"], ["suggest", "--project", "/work/app"]]);
  for (const a of Object.values(t.actions)) assert.equal(a.args({}, ctx).some((x) => /^--(fix|write|dry-run)$/.test(x)), false, "the page never edits a settings file");
});

test("notify: a set line only for what differs, secrets kept unless replaced, an existing ntfy topic kept", () => {
  const n = byId("notify");
  assert.deepEqual(n.install(v("notify", {})), [["init"], ["set", "desktop", "on"]]);
  assert.deepEqual(n.install(v("notify", { desktop: false, ntfy: "auto", minTurnSeconds: 45 })), [["init"], ["set", "minTurnSeconds", "45"], ["set", "ntfy.topic", "auto"]]);
  const cur = { desktop: true, minTurnSeconds: 30, ntfy: "claude-x1", slack: "https://hooks.slack.com/a", quiet: "22:00-07:00" };
  assert.deepEqual(n.change(v("notify", { desktop: true, ntfy: "auto", slack: "", quiet: "" }), cur), [], "auto keeps the topic made earlier; empty keeps");
  assert.deepEqual(n.change(v("notify", { desktop: true, ntfy: "off", slack: "off", quiet: "off" }), cur),
    [["set", "ntfy.topic", "default"], ["set", "slack.url", "default"], ["set", "quiet", "off"]]);
  assert.deepEqual(n.change(v("notify", { desktop: true, discord: "https://discord.com/api/webhooks/1/x" }), cur), [["set", "discord.url", "https://discord.com/api/webhooks/1/x"]]);
});

test("cost guard: budgets set, kept, or cleared", () => {
  const c = byId("cost-guard");
  assert.deepEqual(c.install(v("cost-guard", {})), [["init"]], "no budget: only the hook");
  assert.deepEqual(c.install(v("cost-guard", { daily: "$20", mode: "hard" })), [["init"], ["budget", "set", "--daily", "20usd", "--mode", "hard"]]);
  assert.deepEqual(c.change(v("cost-guard", { weekly: "3M" }), { daily: "", weekly: "", mode: "soft" }), [["budget", "set", "--weekly", "3M", "--mode", "soft"]]);
  assert.deepEqual(c.change(v("cost-guard", { daily: "20usd" }), { daily: "20usd", weekly: "", mode: "soft" }), []);
  assert.deepEqual(c.change(v("cost-guard", {}), { daily: "20usd", weekly: "", mode: "soft" }), [["budget", "clear"]]);
});

test("answers that are refused, with a reason a person can act on", () => {
  bad("guardrails", { preset: "max" }, /preset must be one of strict, balanced, relaxed/);
  bad("glow", { theme: "nope" }, /no theme "nope"/, { glowThemes: [{ slug: "classic" }] });
  bad("glow", { icons: "emoji" }, /icons must be one of/);
  bad("cost-guard", { daily: "lots" }, /not an amount/);
  bad("cost-guard", { mode: "panic" }, /mode must be one of soft, hard/);
  bad("notify", { slack: "http://hooks.slack.com/x" }, /must start with https/);
  bad("notify", { discord: "not a url" }, /not a URL/);
  bad("notify", { ntfy: "has spaces" }, /ntfy topic/);
  bad("notify", { quiet: "10pm-7am" }, /22:00-07:00/);
  bad("notify", { minTurnSeconds: -1 }, /0 to 3600/);
  bad("handover", { models: "Opus; rm -rf /" }, /Opus \+ Sonnet/);
  bad("team-sync", { hubMode: "git", hub: "" }, /git URL/);
  bad("team-sync", { hub: "relative/folder" }, /full path/);
  bad("starter-kits", { stack: "cobol" }, /stack must be one of/);
  assert.deepEqual(v("team-sync", { hub: "C:\\Users\\me\\OneDrive\\Hub" }), { hub: "C:\\Users\\me\\OneDrive\\Hub", name: "" });
  assert.equal(v("cost-guard", { daily: " $15 " }).daily, "15usd");
});
