// The marketplace, the README and the website say the same things, every plugin source installs
// over HTTPS, and the end-to-end harness covers every tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const market = JSON.parse(read(".claude-plugin/marketplace.json"));
const README = read("README.md");
const SITE = read("docs/index.html");
const TOOLS = [
  "claude-code-handover", "claude-code-team-sync", "claude-code-glow", "claude-code-guardrails", "claude-code-notify",
  "claude-cost-guard", "claude-md-doctor", "claude-code-starter-kits", "claude-session-replay", "claude-chat-ferry",
];

test("marketplace: named claude-code-toolkit, unique plugin names, every field filled", () => {
  assert.equal(market.name, "claude-code-toolkit");
  const names = market.plugins.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  for (const p of market.plugins) {
    for (const key of ["name", "description", "author", "category", "source", "homepage"]) assert.ok(p[key], `${p.name}: ${key}`);
  }
});

test("marketplace: every source is an https clone of a toolkit repository", () => {
  // A "github" source clones over SSH and fails for anyone without SSH keys for GitHub.
  for (const p of market.plugins) {
    assert.ok(["url", "git-subdir"].includes(p.source.source), `${p.name}: ${p.source.source}`);
    const m = /^https:\/\/github\.com\/nrzz\/([\w.-]+)\.git$/.exec(p.source.url);
    assert.ok(m && TOOLS.includes(m[1]), `${p.name}: ${p.source.url}`);
    assert.ok(p.homepage.startsWith(`https://github.com/nrzz/${m[1]}`), `${p.name}: ${p.homepage}`);
  }
});

test("README: every tool, and an install line for every plugin", () => {
  for (const tool of TOOLS) assert.ok(README.includes(`(https://github.com/nrzz/${tool})`), tool);
  for (const p of market.plugins) assert.ok(README.includes(`/plugin install ${p.name}@claude-code-toolkit`), p.name);
  assert.ok(README.includes("/plugin marketplace add nrzz/claude-code-toolkit"));
  assert.ok(!/\p{Extended_Pictographic}/u.test(README), "no emoji");
});

test("website: every tool, search metadata, nothing loaded from elsewhere", () => {
  for (const tool of TOOLS) assert.ok(SITE.includes(`href="https://github.com/nrzz/${tool}"`), tool);
  for (const tag of ['name="viewport"', 'name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:description"']) assert.ok(SITE.includes(tag), tag);
  assert.doesNotMatch(SITE, /<script[^>]+src=|<link[^>]+stylesheet|@import|<img[^>]+src="http/i, "the page is self-contained");
});

test("website: every command it offers to copy is one the README gives too", () => {
  const commands = [...SITE.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(commands.length >= 9, String(commands.length));
  for (const command of commands) assert.ok(README.includes(command), command);
});

test("one command sets everything up: the package runs the setup, and the README and website lead with it", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.bin["claude-code-toolkit"], "bin/claude-toolkit.mjs");
  assert.ok(read("bin/claude-toolkit.mjs").startsWith("#!/usr/bin/env node\n"));
  assert.deepEqual(pkg.dependencies, undefined, "no dependencies");
  const cmd = "npx -y github:nrzz/claude-code-toolkit";
  assert.ok(README.includes(cmd) && README.indexOf(cmd) < README.indexOf("/plugin marketplace add"), "README: the one command comes first");
  assert.ok(SITE.indexOf(`data-copy="${cmd}"`) > 0 && SITE.indexOf(`data-copy="${cmd}"`) < SITE.indexOf("/plugin marketplace add"), "website: the one command comes first");
});

test("e2e: the harness parses and covers every tool and the marketplace", () => {
  const file = path.join(ROOT, "e2e", "run.mjs");
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const src = read("e2e/run.mjs");
  for (const tool of TOOLS) assert.ok(src.includes(tool), tool);
  assert.ok(src.includes('want("marketplace")'));
  assert.ok(src.includes('want("setup")'), "and the one-command setup");
});
