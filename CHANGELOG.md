# Changelog

All notable changes to Claude Code toolkit are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] - 2026-10-15

- A twelfth tool: [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor) tells you why Claude Code asked for a permission, finds the rules that do nothing (dead, repeated, hidden behind a deny or ask rule, or skipped by Claude Code) and proposes rules from the commands that ran without one. Like md-doctor, session replay and chat ferry it only runs on demand, so there is nothing to install or switch on: the setup page lists it with three buttons (show this project's rules, check them, suggest rules from history), none of which changes a file, and `status` says it runs on demand. The marketplace carries its `permission-doctor` plugin. The end-to-end test gives it a config of its own with a prefix rule, a `:*` rule, a literal rule and a deny, and a synthetic transcript in which one command ran four times without a rule: `show --json` lists the four rules with their file, `why "git status && npm test" --json` allows the first part by the `:*` rule and finds no rule for the second, `why "rm -rf build" --json` is denied by the deny rule, `lint --json` calls the literal rule nobody used dead (and no prefix rule), `suggest --json` proposes `Bash(docker compose up *)`, and none of the five runs changes a file. With a Claude Code CLI at hand it also installs the plugin and runs its skill's two commands from the installed copy.
- Always-on tokens: all ten plugins together add about 165 by Claude Code's own estimate (the nine before added 148; permission doctor's skill description adds 17), so the limit in the end-to-end test is now 200, not 150. The estimate counts the description of every user-only skill, and Claude Code never sends those to the model: session tidy and permission doctor each captured the request the model receives, with a fake API, and found no trace of their skill. A new tool's skill adds 15 to 17 to the estimate, so a limit of 150 would have meant shortening descriptions until they stop being readable. The test keeps the estimate as a check and adds what it stands for: with all ten plugins installed it resumes a session through Claude Code against a fake API and fails if any request mentions any of the 11 user-only skills (found by their `disable-model-invocation` flag and named in the check), after first checking that a skill the model may invoke, planted in the project, is listed in the first request, so that an absence means something. Claude Code lists skills in the request's messages, not in its system prompt or tool list, so the whole request is searched.
- Website and README: twelve tools, ten plugins, the new tool's card and rows, over 5,700 tests, and the preview images say twelve. Two more tests: the version in `package.json` must be the newest one in this changelog and in the website's What's new, and the limit the README and CONTRIBUTING.md state must be the one the end-to-end test enforces.

## [1.3.0] - 2026-10-15

- An eleventh tool: [claude-session-tidy](https://github.com/nrzz/claude-session-tidy) lists, deletes, keeps and restores your Claude Code sessions before the 30-day cleanup removes them. The setup page lists it (switching it on runs its `init`, which adds one silent `SessionStart` hook; it is not in the recommended set), and the marketplace carries its `session-tidy` plugin. The end-to-end test makes two old sessions, keeps one, deletes the other and restores it byte for byte, adds the hook, runs it as `settings.json` lists it and takes it out again with `settings.json` back byte for byte, and, with a Claude Code CLI at hand, runs the plugin's own hook from the installed copy.
- Always-on tokens: all nine plugins together add about 148 by Claude Code's own estimate (the eight before added 133), under the 150 the end-to-end test allows. The tool's skill description would have made it exactly 150, so it was shortened in claude-session-tidy 1.0.1 rather than raising the limit.
- Website and README: eleven tools, nine plugins, the new tool's card and rows, over 3,700 tests, and the preview images say eleven. A test now checks that the setup's catalog and the list of repositories agree, and that each plugin the catalog names is in the marketplace from its repository.
- README and website: Spendcap is in Anthropic's plugin directory (published 14 October 2026). The install line from there, `/plugin install spendcap@anthropic-plugin-directory`, was verified with Claude Code 2.1.295 in a throwaway config: version 1.0.1, one hook, no always-on tokens.

## [1.2.1] - 2026-10-15

- Setup page: its server no longer times out a kept-alive connection. Fetching the tools and running their installers block the process for seconds, and Node closed an idle connection the moment it was free again, before reading the request the page had sent meanwhile; on a slow machine the page's next request was reset (seen once in the Windows end-to-end run on Claude Code 2.1.300). Connections now stay open until Done, with a test.
- README: a "Stay in the loop" section. Website: the author in the footer with a Star link, an author tag, `robots.txt` and `sitemap.xml`.
- Website: the numbers under the hero said 9 tools and 3,200+ tests after chat ferry joined; they now say 10 and 3,500+, like the README, and a test keeps them in step. The link preview image lists chat-ferry among the tools and says 3,500+ tests; its source is now kept in `media/preview.html`, with a test that it names every tool, says how many, and gives the README's test count.

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

[1.4.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/nrzz/claude-code-toolkit/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-toolkit/releases/tag/v1.0.0
