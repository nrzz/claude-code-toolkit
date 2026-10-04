// The setup in a terminal, for when no browser can open (over SSH, in a container): the same
// choices as the page, asked as a short checklist, each question with a default Enter accepts.
import { TOOLS, byId, OptionError } from "./catalog.mjs";
import { defaultChoices } from "./state.mjs";
import { plan } from "./plan.mjs";

const SHORT = {
  guardrails: "stops rm -rf /, force pushes, secrets in commits",
  notify: "a ping when Claude needs you or finishes",
  glow: "themes, and a status line with a context meter",
  "cost-guard": "daily and weekly token budgets",
  handover: "short sessions with a handover file",
  "team-sync": "share sessions with coworkers",
  "starter-kits": "a lean, safe .claude/ for your stack",
};

function statusText(t, st) {
  if (st.plugin) return "installed as a plugin";
  if (t.scope === "project") return st.installed ? "set up in this project" : "";
  return st.installed ? "installed" : "";
}

/** Asks until `parse` accepts the answer; an empty answer takes the default. */
async function ask(rl, out, question, def, parse = (s) => s) {
  for (;;) {
    const answer = (await rl.question(`${question}${def !== "" ? ` [${def}]` : ""}: `)).trim();
    try {
      return parse(answer === "" ? def : answer);
    } catch (err) {
      out.write(`  ${err instanceof OptionError ? err.message.replace(/^[^:]+: /, "") : err.message}\n`);
    }
  }
}
const yes = (s) => /^(y|yes|on|true)$/i.test(s);

/** Settings questions for a tool that is about to be installed, validated by the tool itself. */
async function settingsFor(rl, out, t, options, ctx) {
  const o = { ...options };
  const check = (patch) => { t.validate({ ...o, ...patch }, ctx); return patch; };
  if (t.id === "guardrails") Object.assign(o, await ask(rl, out, "  Guardrails preset: balanced, strict or relaxed", o.preset, (v) => check({ preset: v })));
  if (t.id === "notify") {
    o.desktop = await ask(rl, out, "  Desktop notifications? (y/n)", o.desktop ? "y" : "n", (v) => yes(v));
    Object.assign(o, await ask(rl, out, "  Phone pushes through the ntfy app? n = no, a = make a private topic, or type your topic", "n",
      (v) => check({ ntfy: /^n(o)?$/i.test(v) ? "" : /^a(uto)?$/i.test(v) ? "auto" : v })));
  }
  if (t.id === "glow") {
    const slugs = (ctx.glowThemes || []).map((x) => x.slug);
    if (slugs.length) out.write(`  Themes: ${slugs.join(", ")}\n`);
    Object.assign(o, await ask(rl, out, "  Glow theme", o.theme, (v) => check({ theme: v })));
  }
  if (t.id === "cost-guard") {
    Object.assign(o, await ask(rl, out, "  Daily budget, such as 20usd or 3M (empty: none)", o.daily, (v) => check({ daily: v })));
    Object.assign(o, await ask(rl, out, "  Weekly budget (empty: none)", o.weekly, (v) => check({ weekly: v })));
    if (o.daily || o.weekly) o.mode = (await ask(rl, out, "  Stop new prompts when a budget runs out? (y/n)", "n", yes)) ? "hard" : "soft";
  }
  if (t.id === "handover") {
    Object.assign(o, await ask(rl, out, "  Models in your model picker", o.models, (v) => check({ models: v })));
    Object.assign(o, await ask(rl, out, "  Work streams, separated by commas", o.streams, (v) => check({ streams: v })));
  }
  if (t.id === "team-sync") Object.assign(o, await ask(rl, out, "  Hub: branch, a git URL, or the full path of a shared folder", o.hub, (v) => check({ hub: v })));
  if (t.id === "starter-kits") Object.assign(o, await ask(rl, out, "  Stack: auto, dotnet, node, python, go, flutter or java", o.stack, (v) => check({ stack: v })));
  return o;
}

/**
 * @returns the choices to apply, or null when the person stopped
 */
export async function terminalChoices({ rl, out, state, ctx }) {
  const choices = defaultChoices(state);
  const list = TOOLS.filter((t) => t.scope !== "action");
  const locked = (t) => state.tools[t.id].plugin || (t.scope === "project" && state.tools[t.id].installed);
  for (;;) {
    out.write(`\nFor you, in every project (${state.configDir}):\n`);
    list.forEach((t, i) => {
      if (i === list.findIndex((x) => x.scope === "project")) out.write(`For this project (${state.project.dir}):\n`);
      const st = state.tools[t.id];
      const on = choices[t.id].enabled ? "x" : " ";
      const note = statusText(t, st);
      out.write(`  [${on}] ${i + 1}  ${t.name.padEnd(12)} ${SHORT[t.id]}${note ? `  (${note})` : ""}\n`);
    });
    const answer = (await rl.question("\nPress Enter to go on, type numbers to switch tools on or off (for example: 4 5), or q to stop: ")).trim();
    if (/^q(uit)?$/i.test(answer)) return null;
    if (answer === "") break;
    for (const n of answer.split(/[\s,]+/).map(Number)) {
      const t = list[n - 1];
      if (!t) { out.write(`  There is no tool ${n}.\n`); continue; }
      if (locked(t)) { out.write(`  ${t.name} is ${statusText(t, state.tools[t.id])}; it stays as it is.\n`); continue; }
      choices[t.id].enabled = !choices[t.id].enabled;
    }
  }
  for (const t of list) {
    const st = state.tools[t.id];
    if (!choices[t.id].enabled || st.installed || st.plugin) continue;
    out.write(`\n${t.name}\n`);
    choices[t.id].options = await settingsFor(rl, out, byId(t.id), choices[t.id].options, ctx);
  }
  return choices;
}

/** The checklist, then the plan, then a yes before anything changes. */
export async function terminalSetup({ rl, out, state, ctx, run }) {
  const choices = await terminalChoices({ rl, out, state, ctx });
  if (!choices) { out.write("Nothing changed.\n"); return 0; }
  const { steps, errors, notes } = plan(state, choices, ctx);
  for (const n of notes) out.write(`${n}\n`);
  if (errors.length) { out.write(`\nPlease fix these first:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`); return 1; }
  if (!steps.length) { out.write("\nNothing to change.\n"); return 0; }
  out.write(`\nThis will:\n${steps.map((s) => `  - ${s.label}`).join("\n")}\n`);
  const go = (await rl.question("Go ahead? [Y/n]: ")).trim();
  if (go && !yes(go)) { out.write("Nothing changed.\n"); return 0; }
  return run(steps, notes);
}
