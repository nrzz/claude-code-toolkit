// Shared test helpers: a throwaway Claude Code config folder, and fake tools that only write down
// what they were asked to do, so the installer can be tested without the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TOOLS } from "../src/catalog.mjs";

// Every folder made here is removed when the test process exits, so a run leaves nothing in the temp folder.
const made = [];
process.on("exit", () => {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a child may still hold a file; the OS cleans the temp folder later */ }
  }
});

export const tmp = (prefix = "tk-test-") => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};

/** A home folder with a .claude config inside, and the environment that points at it. */
export function sandbox(settings = { theme: "dark" }) {
  const home = tmp();
  const cfg = path.join(home, ".claude");
  fs.mkdirSync(cfg, { recursive: true });
  if (settings) fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify(settings, null, 2));
  const project = path.join(home, "proj");
  fs.mkdirSync(project);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: cfg };
  delete env.FAKE_FAIL;
  return { home, cfg, project, env };
}

/**
 * Every tool, faked: running one appends {repo, args, cwd} to `log`, prints a line, and exits 1
 * when FAKE_FAIL names its repo. Also the glow theme data the picker reads.
 */
export function fakeTools() {
  const dir = tmp("tk-tools-");
  const log = path.join(dir, "calls.jsonl");
  for (const t of TOOLS) {
    const file = path.join(dir, t.repo, t.bin);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      'import fs from "node:fs";',
      `const repo = ${JSON.stringify(t.repo)};`,
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ repo, args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");`,
      'if (process.env.FAKE_FAIL === repo) { console.error("it broke"); process.exit(1); }',
      'console.log(`ran ${repo} ${process.argv.slice(2).join(" ")}`);',
      "",
    ].join("\n"));
  }
  const themes = path.join(dir, "claude-code-glow", "hud", "data", "themes.json");
  fs.mkdirSync(path.dirname(themes), { recursive: true });
  fs.writeFileSync(themes, JSON.stringify([
    { slug: "classic", name: "Classic", base: "dark", glow: { swatches: ["#d77757", "#b1b9f9"] } },
    { slug: "nord", name: "Nord", base: "dark", glow: { swatches: ["#88c0d0", "#81a1c1"] } },
  ]));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const reset = () => fs.rmSync(log, { force: true });
  const sources = { ready: Promise.resolve(), dirOf: (repo) => path.join(dir, repo), errorOf: () => undefined, cleanup() {} };
  return { dir, log, calls, reset, sources };
}

/** settings.json as the real tools leave it once installed (hook paths under the config folder). */
export function installedSettings(cfg) {
  const p = (...x) => path.join(cfg, ...x).replace(/\\/g, "/");
  return {
    theme: "dark",
    statusLine: { type: "command", command: `node "${p("claude-code-glow", "statusline.mjs")}"` },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node", args: [p("claude-code-guardrails", "guard.mjs")] }] }],
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node", args: [p("notify", "app", "notify.mjs"), "UserPromptSubmit"] }] },
        { hooks: [{ type: "command", command: "node", args: [p("cost-guard", "app", "guard.mjs"), "prompt"] }] },
      ],
    },
  };
}

export const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); };
