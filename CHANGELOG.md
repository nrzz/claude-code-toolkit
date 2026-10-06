# Changelog

All notable changes to Claude Code toolkit are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-06

- A tenth tool: [claude-chat-ferry](https://github.com/nrzz/claude-chat-ferry) moves a chat between Claude Code, Cursor and Antigravity (and reads Codex CLI, claude.ai and ChatGPT exports). The setup page lists it, the marketplace carries its `chat-ferry` plugin, and the end-to-end test imports an Antigravity conversation as a Claude Code session, exports a session for Cursor, and, with a Claude Code CLI at hand, resumes the imported session through Claude Code against a fake API.
- Website and README: ten tools, eight plugins, the new tool's card and rows.

## [1.1.2] - 2026-10-04

- The marketplace lists the renamed plugins: `glowline` (was glow), `glowbar` (glow-hud), `nudge` (notify), `spendcap` (cost-guard) and `replayer` (replay), so that each has a name of its own in Anthropic's plugin directory. The setup page recognises a tool's plugin under its new name from any marketplace, and under its old name only from our marketplaces.
- Website: a link preview image, a screenshot of the setup page, and a What's new section for the 4 October releases. README: the same screenshot, over 3,200 tests, and the new plugin names, whose extra letters raise Claude Code's estimate for all seven plugins from about 91 to about 95 always-on tokens.

## [1.1.1] - 2026-10-04

- The end-to-end test run with `--local` and no `--only` checked nothing and reported success; it now runs every section, and a run in which no check ran fails.
- Docs corrected after an audit of every claim: which hooks put text in front of the model, what uninstall takes out, handover's cost per session, the theme count (14 recolor the interface), the test count, and Node 18 in CI.

## [1.1.0] - 2026-10-04

- One-click setup: `npx -y github:nrzz/claude-code-toolkit` opens a local setup page with the recommended tools switched on and every tool's settings in one place (glow's themes with their colors, the guardrails preset, notify's channels, cost guard's budgets, handover, team sync's hub, a starter kit you can preview), and runs each tool's own installer. Run it again to change a setting or remove a tool.
- Where no browser can open, the same choices are asked in the terminal; `install`, `uninstall`, `status` and `list` do it without questions.
- The end-to-end test drives the setup command and its page, and checks that uninstalling everything restores the user's settings.

## [1.0.0] - 2026-10-04

- First release: one plugin marketplace for glow, glow-hud, guardrails, notify, cost-guard, md-doctor and replay; the website; an end-to-end test that installs all nine tools from GitHub, runs their hooks, installs the plugins with Claude Code's own commands and checks that uninstalling restores the user's settings.

[1.2.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-toolkit/releases/tag/v1.0.0
