// Turns "what I want" (a tick and options per tool) into the exact tool commands that get there
// from what is installed now. Tools left out of the choices are left alone.
import { byId, OptionError } from "./catalog.mjs";

// Settings tools first, then the project tools; one at a time, since each writes settings.json.
export const ORDER = ["guardrails", "notify", "glow", "cost-guard", "handover", "team-sync", "starter-kits"];

const hideUrls = (a) => (/^https?:\/\//.test(a) ? "<URL>" : a);
const label = (tool, kind, args, first) =>
  kind === "install" && first ? `Install ${tool.name}` : kind === "uninstall" ? `Remove ${tool.name}` : `${tool.name}: ${args.map(hideUrls).join(" ")}`;

/**
 * @param state what readState() found
 * @param choices { [id]: { enabled: boolean, options?: object } }
 * @param ctx { project?: string, glowThemes?: {slug}[] }
 * @returns { steps: { tool, kind, args, cwd?, label }[], errors: string[], notes: string[] }
 */
export function plan(state, choices, ctx = {}) {
  const steps = [];
  const errors = [];
  const notes = [];
  const project = ctx.project || state.project.dir;
  for (const id of ORDER) {
    const choice = choices?.[id];
    if (!choice) continue;
    const tool = byId(id);
    const st = state.tools[id];
    const enabled = choice.enabled === true;
    if (st.plugin) {
      if (enabled) notes.push(`${tool.name} is installed as a Claude Code plugin, so it is left to /plugin.`);
      continue;
    }
    if (tool.scope === "project") {
      // Added to a project, never taken out of one by a switch: the files are the project's now.
      // An explicit uninstall (handover) removes only what the tool put in your user settings.
      if (!enabled) {
        if (choice.remove && tool.uninstall && (st.installed || st.userLevel)) for (const args of tool.uninstall()) steps.push({ tool: id, kind: "uninstall", args, label: label(tool, "uninstall", args) });
        continue;
      }
      if (st.installed) continue;
      if (!state.project.exists) { errors.push(`${tool.name}: choose a project folder first.`); continue; }
      if (state.project.home) { errors.push(`${tool.name}: choose a project folder, not your home folder.`); continue; }
    }
    if (!enabled) {
      if (!st.installed) continue;
      if (tool.uninstall) for (const args of tool.uninstall()) steps.push({ tool: id, kind: "uninstall", args, label: label(tool, "uninstall", args) });
      else if (tool.removeHint) notes.push(tool.removeHint);
      continue;
    }
    let o;
    try {
      o = tool.validate(choice.options || {}, ctx);
    } catch (err) {
      if (err instanceof OptionError) { errors.push(err.message); continue; }
      throw err;
    }
    if (id === "team-sync" && o.hub === "branch" && !state.project.hasRemote) {
      errors.push("team-sync: this folder has no git remote, so the hub cannot be a branch of it. Choose another git repository or a shared folder.");
      continue;
    }
    const kind = st.installed ? "change" : "install";
    const current = id === "notify" ? { ...st.current, ...state.secrets.notify } : st.current;
    const list = st.installed ? tool.change(o, current) : tool.install(o, { project });
    list.forEach((args, i) => steps.push({ tool: id, kind, args, cwd: tool.scope === "project" ? project : undefined, label: label(tool, kind, args, i === 0) }));
  }
  return { steps, errors, notes };
}

/** Choices that remove the given tools (or every installed one). */
export function removal(state, ids) {
  const out = {};
  for (const id of ORDER) {
    if (!ids.includes(id) && !ids.includes("all")) continue;
    const st = state.tools[id];
    if (byId(id).uninstall && (st.installed || st.userLevel) && !st.plugin) out[id] = { enabled: false, remove: true };
  }
  return out;
}
