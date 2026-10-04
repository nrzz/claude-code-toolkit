// claude-code-toolkit: the whole toolkit in one command. With no arguments it opens the setup
// page (or a terminal checklist when no browser can open); install, uninstall and status do the
// same without questions, for scripts and for people who prefer the terminal.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { TOOLS, INSTALLABLE, byId } from "./catalog.mjs";
import { readState, defaultChoices } from "./state.mjs";
import { plan, removal, ORDER } from "./plan.mjs";
import { getSources } from "./fetch.mjs";
import { runSteps } from "./run.mjs";
import { startServer, glowThemes } from "./server.mjs";
import { canOpenBrowser, openUrl } from "./open.mjs";
import { terminalSetup } from "./tui.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
export const RECOMMENDED = TOOLS.filter((t) => t.recommended).map((t) => t.id);

export const USAGE = `claude-code-toolkit ${VERSION}: set up the Claude Code toolkit in one go.

  npx -y github:nrzz/claude-code-toolkit     opens the setup page in your browser: the recommended
                                              tools are switched on, one click installs them

Commands
  setup [--terminal] [--no-open]   the setup page; --terminal asks in the terminal instead
  install <tools> [options]        install or change tools without questions
                                   <tools>: recommended, all, or names such as guardrails,notify
  uninstall <tools|all>            remove what install added (your settings are backed up first)
  status                           what is installed, and how it is set
  list                             the tools and what each one does

Options for install
  --project <dir>          the project for handover, team-sync and starter-kits (default: this folder)
  --preset <p>             guardrails: balanced (default), strict or relaxed
  --theme <slug>           glow: classic (default), dracula, nord, tokyo-night ... (glow theme list)
  --icons <i>              glow: unicode (default), nerd or ascii        --no-ui-theme  only the status line
  --desktop on|off         notify: desktop notifications (default on)
  --ntfy <topic|auto>      notify: pushes to the ntfy phone app          --quiet 22:00-07:00
  --slack, --discord, --teams <url>   notify: incoming webhook URLs
  --daily, --weekly <amt>  cost-guard: 20usd, $20, 3M or 500k            --mode soft|hard
  --models <list>          handover: "Opus + Sonnet" (default), "Opus only", ...
  --streams <list>         handover: "main" (default), or "backend, frontend"
  --hub <hub>              team-sync: branch (default), a git URL, or a shared folder
  --name <you>             team-sync: your name as teammates see it
  --stack <s>              starter-kits: auto (default), dotnet, node, python, go, flutter, java
  --merge                  starter-kits: add to an existing CLAUDE.md instead of beside it

  --source <dir>           use local checkouts of the tools in <dir> instead of downloading them
  --ref <branch|tag>       which version to download (default: main)

Tools: ${INSTALLABLE.join(", ")}. Recommended: ${RECOMMENDED.join(", ")}.
Only your Claude Code config folder ($CLAUDE_CONFIG_DIR or ~/.claude) and, for the project tools,
the project folder are changed, and every tool backs up settings.json before writing it. Nothing
here runs Claude or costs tokens.
https://github.com/nrzz/claude-code-toolkit`;

const BOOLEAN = new Set(["help", "version", "terminal", "web", "no-open", "no-ui-theme", "merge", "yes"]);

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { out.flags.help = true; continue; }
    if (a === "-v") { out.flags.version = true; continue; }
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (eq > 0) out.flags[key] = a.slice(eq + 1);
    else if (BOOLEAN.has(key)) out.flags[key] = true;
    else if (i + 1 < argv.length) out.flags[key] = argv[++i];
    else throw new Error(`--${key} needs a value`);
  }
  return out;
}

/** The tools named on the command line: recommended, all, or names separated by spaces or commas. */
export function pickTools(words, { allowed = INSTALLABLE } = {}) {
  const names = words.flatMap((w) => w.split(",")).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!names.length) throw new Error("name the tools: recommended, all, or for example guardrails,notify");
  const ids = new Set();
  for (const n of names) {
    if (n === "all") allowed.forEach((id) => ids.add(id));
    else if (n === "recommended") RECOMMENDED.forEach((id) => ids.add(id));
    else if (allowed.includes(n)) ids.add(n);
    else if (n === "starter" || n === "starter-kit") ids.add("starter-kits");
    else if (n === "cost" || n === "costguard") ids.add("cost-guard");
    else if (n === "team" || n === "teamsync") ids.add("team-sync");
    else throw new Error(`there is no tool "${n}". Tools: ${allowed.join(", ")}`);
  }
  return ORDER.filter((id) => ids.has(id));
}

/** Command-line flags as each tool's options. */
export function optionsFromFlags(id, f) {
  const pick = (map) => Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  switch (id) {
    case "guardrails": return pick({ preset: f.preset });
    case "notify": return pick({ desktop: f.desktop, ntfy: f.ntfy, slack: f.slack, discord: f.discord, teams: f.teams, quiet: f.quiet, minTurnSeconds: f["min-turn-seconds"] === undefined ? undefined : Number(f["min-turn-seconds"]) });
    case "glow": return pick({ theme: f.theme, icons: f.icons, uiTheme: f["no-ui-theme"] ? false : undefined });
    case "cost-guard": return pick({ daily: f.daily, weekly: f.weekly, mode: f.mode });
    case "handover": return pick({ models: f.models, streams: f.streams });
    case "team-sync": return pick({ hub: f.hub, name: f.name });
    case "starter-kits": return pick({ stack: f.stack, merge: f.merge ? true : undefined });
    default: return {};
  }
}

function printSteps(out) {
  return (e, steps) => {
    const s = steps[e.index];
    if (e.status === "running") out.write(`- ${s.label} ... `);
    else if (e.status === "skipped") out.write(`- ${s.label}: skipped, an earlier step of ${byId(s.tool).name} failed\n`);
    else {
      out.write(e.status === "ok" ? "done\n" : "failed\n");
      if (e.status !== "ok" && e.output) out.write(`${e.output.split("\n").map((l) => `    ${l}`).join("\n")}\n`);
    }
  };
}

async function execute({ steps, notes, sources, env, out }) {
  const show = printSteps(out);
  const results = await runSteps({ steps, sources, env, onEvent: (e) => show(e, steps) });
  const ok = results.every((r) => r.status === "ok");
  for (const n of notes || []) out.write(`${n}\n`);
  out.write(ok ? "\nDone. Start a new Claude Code session to pick up the changes.\n" : "\nSome steps failed; the rest was applied.\n");
  return ok ? 0 : 1;
}

function describe(state) {
  const lines = [`Claude Code config: ${state.configDir}`, `Project: ${state.project.dir}`, ""];
  for (const t of TOOLS) {
    const st = state.tools[t.id];
    let what;
    if (t.scope === "action") what = "runs on demand";
    else if (st.plugin) what = "installed as a plugin";
    else if (t.scope === "project") what = st.installed ? "set up in this project" : `not set up in this project${st.userLevel ? " (its hooks are installed for you)" : ""}`;
    else what = st.installed ? "installed" : "not installed";
    let how = "";
    if (st.installed && t.id === "guardrails") how = `preset ${st.current.preset}`;
    if (st.installed && t.id === "glow") how = `theme ${st.current.theme}, icons ${st.current.icons}${st.current.uiTheme ? "" : ", status line only"}`;
    if (st.installed && t.id === "notify") how = [st.current.desktop ? "desktop" : "", st.current.ntfy ? "ntfy" : "", st.current.slack ? "Slack" : "", st.current.discord ? "Discord" : "", st.current.teams ? "Teams" : ""].filter(Boolean).join(", ") || "terminal only";
    if (st.installed && t.id === "cost-guard") how = st.current.daily || st.current.weekly ? `${[st.current.daily && `daily ${st.current.daily}`, st.current.weekly && `weekly ${st.current.weekly}`].filter(Boolean).join(", ")}, ${st.current.mode}` : "no budget set";
    lines.push(`  ${t.name.padEnd(17)} ${what}${how ? ` (${how})` : ""}`);
  }
  return lines.join("\n");
}

/**
 * @param argv the arguments after the program name
 * @param io { out, err, env, cwd, stdin, open } (tests pass their own)
 * @returns the exit code
 */
export async function main(argv, io = {}) {
  const out = io.out || process.stdout;
  const err = io.err || process.stderr;
  const env = io.env || process.env;
  const cwd = io.cwd || process.cwd();
  let args;
  try { args = parseArgs(argv); } catch (e) { err.write(`claude-code-toolkit: ${e.message}\n`); return 2; }
  const f = args.flags;
  if (f.help) { out.write(`${USAGE}\n`); return 0; }
  if (f.version) { out.write(`${VERSION}\n`); return 0; }
  const command = args._[0] || "setup";
  const project = path.resolve(cwd, f.project || ".");
  const sourceOpts = { source: f.source ? path.resolve(cwd, f.source) : undefined, ref: f.ref || "main" };
  const allRepos = [...new Set(TOOLS.map((t) => t.repo))];

  try {
    if (command === "list") {
      for (const t of TOOLS) out.write(`${t.id.padEnd(14)} ${t.summary}\n${"".padEnd(14)} Adds to a session: ${t.tokens}. https://github.com/nrzz/${t.repo}\n`);
      return 0;
    }
    if (command === "status") {
      out.write(`${describe(readState({ env, project }))}\n`);
      return 0;
    }

    if (command === "install" || command === "uninstall") {
      const state = readState({ env, project });
      if (state.settings.invalid) { err.write(`${state.settings.file} is not valid JSON. Fix it first; nothing was changed.\n`); return 1; }
      let choices;
      const ids = pickTools(args._.slice(1));
      if (command === "install") {
        const base = defaultChoices(state);
        choices = {};
        for (const id of ids) {
          const st = state.tools[id];
          if (id === "glow" && !st.installed && st.otherStatusLine && !args._.slice(1).join(",").split(",").includes("glow")) {
            out.write("Glow is left out: you already have a status line. Name it (install glow) to replace yours; uninstall puts it back.\n");
            continue;
          }
          choices[id] = { enabled: true, options: { ...base[id].options, ...optionsFromFlags(id, f) } };
        }
      } else {
        choices = removal(state, ids);
        if (!Object.keys(choices).length) { out.write("Nothing to remove: none of those is installed here.\n"); return 0; }
      }
      const needed = [...new Set(Object.keys(choices).map((id) => byId(id).repo))];
      if (!needed.length) { out.write("Nothing to do.\n"); return 0; }
      const sources = getSources({ repos: needed, ...sourceOpts });
      if (!sourceOpts.source) out.write("Getting the latest versions from GitHub...\n");
      await sources.ready;
      try {
        const { steps, errors, notes } = plan(state, choices, { project, glowThemes: glowThemes(sources) });
        if (errors.length) { err.write(`Please fix these first:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`); return 1; }
        if (!steps.length) { for (const n of notes) out.write(`${n}\n`); out.write("Nothing to change: it is already set up that way.\n"); return 0; }
        return await execute({ steps, notes, sources, env, out });
      } finally {
        sources.cleanup();
      }
    }

    if (command === "setup") {
      const state = readState({ env, project });
      if (state.settings.invalid) { err.write(`${state.settings.file} is not valid JSON. Fix it first; nothing was changed.\n`); return 1; }
      const sources = getSources({ repos: allRepos, ...sourceOpts });
      const stop = () => { try { sources.cleanup(); } catch { /* already gone */ } };
      const terminal = f.terminal || (!f.web && !canOpenBrowser(env));
      try {
        if (terminal) {
          const stdin = io.stdin || process.stdin;
          if (!stdin.isTTY && !io.stdin) { err.write("No browser can open here and this is not an interactive terminal. Use: claude-code-toolkit install recommended\n"); return 1; }
          out.write(`Claude Code toolkit setup\n${sourceOpts.source ? "" : "Getting the latest versions from GitHub...\n"}`);
          await sources.ready;
          const rl = readline.createInterface({ input: stdin, output: out, terminal: false });
          try {
            return await terminalSetup({ rl, out, state, ctx: { project, glowThemes: glowThemes(sources) }, run: (steps, notes) => execute({ steps, notes, sources, env, out }) });
          } finally {
            rl.close();
          }
        }
        const server = startServer({ sources, env, project, port: Number(f.port) || 0 });
        const url = await server.listening;
        out.write(`The setup page is at:\n  ${url}\n`);
        if (!f["no-open"]) out.write(openUrl(url) ? "It should open in your browser now. If not, copy the link above.\n" : "Copy the link above into your browser.\n");
        out.write("It stops when you press Done, a little after you close the tab, or with Ctrl+C here.\n");
        const sigint = () => { server.close(); };
        process.once("SIGINT", sigint);
        await server.closed;
        process.removeListener("SIGINT", sigint);
        out.write("Setup page closed.\n");
        return 0;
      } finally {
        stop();
      }
    }

    err.write(`claude-code-toolkit: unknown command "${command}". Run with --help to see the commands.\n`);
    return 2;
  } catch (e) {
    err.write(`claude-code-toolkit: ${e.message}\n`);
    return 1;
  }
}
