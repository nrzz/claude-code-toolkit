// Gets each tool's code: from local checkouts (--source), or the latest version on GitHub as a
// tarball, falling back to a shallow git clone (which follows git's own proxy settings).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractTarGz } from "./tar.mjs";
import { ORG } from "./catalog.mjs";

async function download(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "claude-code-toolkit" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function gitClone(repo, ref, dest) {
  const r = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, `https://github.com/${ORG}/${repo}.git`, dest], {
    encoding: "utf8", windowsHide: true, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || "git clone failed").trim().split("\n").pop());
}

/**
 * The folder of every repo, ready to run. `dirOf(repo)` answers once `ready` has settled.
 * @param {{ repos: string[], source?: string, ref?: string, timeoutMs?: number, onRepo?: (repo: string, err?: Error) => void }} o
 */
export function getSources({ repos, source, ref = "main", timeoutMs = 60000, onRepo = () => {} }) {
  const dirs = new Map();
  const errors = new Map();
  if (source) {
    for (const repo of repos) {
      const dir = path.resolve(source, repo);
      if (fs.existsSync(dir)) dirs.set(repo, dir);
      else errors.set(repo, new Error(`no checkout at ${dir}`));
      onRepo(repo, errors.get(repo));
    }
    return { ready: Promise.resolve(), dirOf: (r) => dirs.get(r), errorOf: (r) => errors.get(r), cleanup() {} };
  }
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-toolkit-")));
  const one = async (repo) => {
    const dest = path.join(tmp, repo);
    try {
      try {
        extractTarGz(await download(`https://codeload.github.com/${ORG}/${repo}/tar.gz/${encodeURIComponent(ref)}`, timeoutMs), dest);
      } catch (first) {
        fs.rmSync(dest, { recursive: true, force: true });
        try { gitClone(repo, ref, dest); } catch (second) { throw new Error(`download failed (${first.message}), and git clone failed (${second.message})`); }
      }
      dirs.set(repo, dest);
      onRepo(repo);
    } catch (err) {
      errors.set(repo, err);
      onRepo(repo, err);
    }
  };
  const ready = Promise.all(repos.map(one));
  return {
    ready,
    dirOf: (r) => dirs.get(r),
    errorOf: (r) => errors.get(r),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
