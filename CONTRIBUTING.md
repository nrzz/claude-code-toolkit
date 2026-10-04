# Contributing to Claude Code toolkit

Thanks for helping. Claude Code toolkit is the home of nine small Claude Code tools: the one-click setup, one plugin marketplace for all of them, the website, and an end-to-end test of all nine together. The bar for a change is the bar the code already meets: it works on Windows, macOS and Linux, it is tested, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-code-toolkit/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-code-toolkit/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-code-toolkit/issues/new/choose) with the Claude Code version (`claude --version`), your OS, `node --version`, and the exact command and output.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-code-toolkit
cd claude-code-toolkit
npm test
```

- `npm test` runs the setup's tests (with fake tools, no network) and checks that the marketplace, the README and the website agree.
- Try the setup page safely: point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at a throwaway folder, then run `node bin/claude-toolkit.mjs` (add `--source ..` to use the tools checked out next to this repository instead of downloading them, and `--terminal` for the checklist).
- `node e2e/run.mjs` installs every tool from GitHub into a throwaway Claude Code config and checks it end to end. `--local` uses sibling checkouts, `--only setup,glow` runs a few, and `E2E_CLAUDE=<path to claude>` adds the plugin-marketplace checks.
- Open `docs/index.html` in a browser to see the website.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/claude-toolkit.mjs`, `src/cli.mjs` | the one command: setup page, terminal checklist, install, uninstall, status |
| `src/catalog.mjs` | every tool: its repository, its questions, and the exact command lines that install, change and remove it |
| `src/state.mjs`, `src/plan.mjs`, `src/run.mjs` | what is installed now, the steps from there to what was chosen, and running them |
| `src/server.mjs`, `src/ui/setup.html` | the setup page and its local server (127.0.0.1, one-time key, Host and Origin checks) |
| `src/fetch.mjs`, `src/tar.mjs` | getting the tools from GitHub without npm or git |
| `.claude-plugin/marketplace.json` | the plugin marketplace; every source is an https clone of a tool's repository |
| `e2e/run.mjs` | the end-to-end test of all nine tools and of the setup |
| `docs/index.html` | the website (GitHub Pages), one self-contained file |
| `test/` | the setup's tests, and checks that the marketplace, README and website agree |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24; a change that only works on one of them is not done.
3. **Token cost is a feature.** A tool joins the toolkit only with a "What it costs in tokens" table in its README, and the end-to-end test keeps all plugins together under 150 always-on tokens by Claude Code's own estimate. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
4. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it. Tests never read `~/.claude/projects`; build synthetic transcripts instead. Build any fake secret from pieces (`"gh" + "p_" + ...`) so secret scanners do not flag the source.
5. **Settings files are the user's.** Back them up before writing, change only your own keys or hook entries, and leave a file that is not valid JSON alone.
6. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Add a rule for gem push").
- Fill in the pull request template; CI must be green on all nine jobs.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `package.json`, add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
