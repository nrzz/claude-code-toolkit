// Runs tool commands: each one is `node <tool>/<bin> <args...>` with the user's environment, so a
// tool writes exactly where it would if the person had typed the command.
import path from "node:path";
import { spawn } from "node:child_process";
import { byId } from "./catalog.mjs";

const MAX_OUTPUT = 200_000;

export function runTool({ sources, tool, args, cwd, env = process.env, timeoutMs = 180_000 }) {
  const t = typeof tool === "string" ? byId(tool) : tool;
  const dir = sources.dirOf(t.repo);
  if (!dir) {
    const why = sources.errorOf?.(t.repo)?.message || "not downloaded";
    return Promise.resolve({ ok: false, code: null, output: `Could not get ${t.repo}: ${why}` });
  }
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [path.join(dir, t.bin), ...args], {
      cwd: cwd || process.cwd(), env: { ...env, NO_COLOR: "1", FORCE_COLOR: "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const add = (chunk) => { if (output.length < MAX_OUTPUT) output += chunk.toString("utf8"); };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => { output += `\n(stopped after ${Math.round(timeoutMs / 1000)} seconds)`; child.kill(); }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, code: null, output: `${output}${err.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, output: output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd() }); });
  });
}

/**
 * Runs the steps in order. When a step fails, the rest of that tool's steps are skipped and the
 * other tools still run. `onEvent` hears { index, status: "running" | "ok" | "failed" | "skipped", output }.
 */
export async function runSteps({ steps, sources, env, onEvent = () => {} }) {
  const failedTools = new Set();
  const results = [];
  for (const [index, step] of steps.entries()) {
    if (failedTools.has(step.tool)) {
      results.push({ ...step, status: "skipped" });
      onEvent({ index, status: "skipped", output: "" });
      continue;
    }
    onEvent({ index, status: "running" });
    const r = await runTool({ sources, tool: step.tool, args: step.args, cwd: step.cwd, env });
    if (!r.ok) failedTools.add(step.tool);
    results.push({ ...step, status: r.ok ? "ok" : "failed", output: r.output });
    onEvent({ index, status: r.ok ? "ok" : "failed", output: r.output });
  }
  return results;
}
