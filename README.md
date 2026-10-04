# Claude Code toolkit

[![e2e](https://github.com/nrzz/claude-code-toolkit/actions/workflows/e2e.yml/badge.svg)](https://github.com/nrzz/claude-code-toolkit/actions/workflows/e2e.yml) [![test](https://github.com/nrzz/claude-code-toolkit/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/claude-code-toolkit/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg)

Nine small, open-source tools that make Claude Code cheaper, safer and easier to share. Each one is a dependency-free Node command or plugin that adds few or no tokens to your sessions, and all nine are tested together, installed from GitHub, on Windows, macOS and Linux.

Website: [nrzz.github.io/claude-code-toolkit](https://nrzz.github.io/claude-code-toolkit/)

## Set up in one click

```bash
npx -y github:nrzz/claude-code-toolkit
```

That opens a setup page in your browser. The first time, the recommended tools (guardrails, notify and glow) are already switched on, so pressing **Install** is the whole setup. Each tool's **Settings** hold the few choices that need you: the glow theme (shown with its colors), the guardrails preset, where notify reaches you (desktop, phone, Slack, Discord or Teams), cost guard's budgets and, for the project you ran it in, the handover files, team sync's hub and a starter kit you can preview before it writes anything. Run it again any time to change a setting or switch a tool off; it shows what is installed and how it is set.

The page is served by the command itself on 127.0.0.1, with a one-time key in its link, and only runs each tool's own installer, which backs up `settings.json` first. It stops when you press **Done**. Where no browser can open (over SSH, in a container) it asks the same questions in the terminal, and for scripts there is no question at all:

```bash
npx -y github:nrzz/claude-code-toolkit install recommended --theme nord --daily 20usd
```

`status` shows what is installed, `uninstall all` takes everything out again, and `--help` lists every option. Nothing here runs Claude, so setting up costs no tokens.

## Pick what you need

| You want to | Use | What it adds to a session |
| --- | --- | --- |
| Stop paying to reload one giant chat | [claude-code-handover](https://github.com/nrzz/claude-code-handover) | A short handover file, and a few recalled lines when your question matches an earlier session |
| Share sessions, notes and context with coworkers | [claude-code-team-sync](https://github.com/nrzz/claude-code-team-sync) | 0 when nothing is new, at most about 375 tokens when a teammate shared something |
| Theme the whole interface and watch your context, limits and cost | [claude-code-glow](https://github.com/nrzz/claude-code-glow) | 0 |
| Stop `rm -rf /`, force pushes, secrets in commits and `.env` edits | [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails) | 0 for every allowed call, about 45 tokens for a denied one |
| Look away while Claude works, and get a ping when it needs you | [claude-code-notify](https://github.com/nrzz/claude-code-notify) | 0 |
| Keep spending inside a daily or weekly budget | [claude-cost-guard](https://github.com/nrzz/claude-cost-guard) | 0 |
| See what your CLAUDE.md costs in every session, and slim it | [claude-md-doctor](https://github.com/nrzz/claude-md-doctor) | 0: it runs outside Claude |
| Start a project with a lean, safe `.claude/` for your stack | [claude-code-starter-kits](https://github.com/nrzz/claude-code-starter-kits) | The CLAUDE.md it writes: 230 to 260 tokens |
| Find a past discussion, or share a session as a web page | [claude-session-replay](https://github.com/nrzz/claude-session-replay) | 0: it runs outside Claude |

Every tool's README has a "What it costs in tokens" table with the details, and a "What was verified, and how" section that says what was checked and what was not.

## Other ways to install

### The plugins, from one marketplace

If you prefer Claude Code's own plugin system, in Claude Code:

```text
/plugin marketplace add nrzz/claude-code-toolkit
/plugin install guardrails@claude-code-toolkit
```

Then install any of the others the same way, or browse them with `/plugin`:

| Plugin | Install |
| --- | --- |
| Glow: themes and status line | `/plugin install glow@claude-code-toolkit` |
| Glow HUD (early access) | `/plugin install glow-hud@claude-code-toolkit` |
| Guardrails | `/plugin install guardrails@claude-code-toolkit` |
| Notify | `/plugin install notify@claude-code-toolkit` |
| Cost guard | `/plugin install cost-guard@claude-code-toolkit` |
| CLAUDE.md doctor | `/plugin install md-doctor@claude-code-toolkit` |
| Session replay | `/plugin install replay@claude-code-toolkit` |

By Claude Code's own estimate (`claude plugin details`), all seven together add about 91 always-on tokens, and only because the estimate counts the descriptions of user-only skills, which Claude Code leaves out of the list it gives the model.

### One tool at a time

Each tool also runs straight from GitHub with `npx`, nothing to install first:

```bash
npx -y github:nrzz/claude-code-handover init
```

```bash
npx -y github:nrzz/claude-code-team-sync init
```

```bash
npx -y github:nrzz/claude-code-starter-kits
```

```bash
npx -y github:nrzz/claude-md-doctor
```

```bash
npx -y github:nrzz/claude-session-replay list
```

```bash
npx -y github:nrzz/claude-code-glow install
```

Guardrails, notify and cost guard have the same `init`; handover's and team sync's run in the project folder. Every tool that changes your settings has an `uninstall` that takes out what it added.

## Built the same way

- **No dependencies.** Node 18 or newer and nothing from npm, so there is nothing to audit but the code itself.
- **Token cost is a feature.** Hooks talk to you, not to the model. Skills that Claude does not need to see are user-only. Every README says what each part costs.
- **Your settings stay yours.** Each tool backs up before writing, changes only its own keys, leaves a file that is not valid JSON alone, and uninstalls cleanly.
- **Tested.** Over 2,900 automated tests across the nine repositories, each run on Windows, macOS and Linux with Node 20, 22 and 24, and the end-to-end run below.

## Tested together

[`e2e/run.mjs`](e2e/run.mjs) does what a new user would, on a clean machine:

1. It makes a throwaway home folder and Claude Code config folder that already hold settings of their own (a theme, an env variable, a permission, a Stop hook).
2. It installs every tool from GitHub with `npx` and runs every hook exactly as `settings.json` lists it, with the JSON Claude Code sends: guardrails denies `rm -rf /` and passes `npm test` in silence, notify stays quiet after a 5-second turn and pings after a 60-second one, cost guard holds a prompt over a hard budget but lets `/compact` through, the starter kit's CLAUDE.md passes the doctor in CI mode, two teammates share a session through one git remote, a replay export escapes hostile text, and handover's self-test passes and its `init` sets up a project, changes nothing on a second run and uninstalls cleanly.
3. In a second home folder it runs the one-command setup as a user would: `install recommended,cost-guard` with options, a guardrails hook it installed denying `rm -rf /`, `status` reading the choices back, then the setup page started for real and driven through its own API (the one-time key refused when missing, Apply changing a theme and removing a tool, Done stopping it), and `uninstall all`.
4. With a Claude Code CLI available, it validates this marketplace, installs all seven plugins from GitHub with `claude plugin install`, runs the guardrails, notify and cost guard plugins' own hooks from the installed copies, checks the token estimate, and runs the HUD's engine tests inside that Claude Code.
5. It uninstalls everything and checks that `settings.json` is exactly what the user had, in both home folders.

```bash
node e2e/run.mjs
```

`--local` uses sibling checkouts instead of GitHub, `--only setup,glow` runs a few, and `E2E_CLAUDE=<path to claude>` points at the CLI for step 4. CI runs it on every push and every week on Windows, macOS and Linux, so a change in Claude Code that breaks a tool shows up here.

## Contributing

Every tool welcomes issues and pull requests: each repository has a CONTRIBUTING.md, issue templates and issues labelled [good first issue](https://github.com/search?q=user%3Anrzz+label%3A%22good+first+issue%22+state%3Aopen&type=issues). For the marketplace, the website or the end-to-end test, see [CONTRIBUTING.md](CONTRIBUTING.md). Questions and ideas for new tools go to [Discussions](https://github.com/nrzz/claude-code-toolkit/discussions).

## License

MIT
