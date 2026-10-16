# Changelog

All notable changes to Claude Code toolkit are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.7.0] - 2026-10-16

- A sixteenth and a seventeenth tool. [claude-automode-doctor](https://github.com/nrzz/claude-automode-doctor) reads what Claude Code's auto mode and its classifier decided from your transcripts: who made each tool decision, the commands the classifier refused, and the refusals that were no verdict at all; its lint finds an `autoMode` list that drops the built-in rules because `"$defaults"` is missing. [claude-mcp-check](https://github.com/nrzz/claude-mcp-check) lists every MCP server Claude Code would load with the file it came from, starts each one the way Claude Code would and sizes its tools, and lints the configuration. Both are on-demand tools on the setup page (auto mode doctor with report, show and lint; MCP check with show and lint; none of the buttons writes a file or starts a server) and plugins in this marketplace with one user-only skill each.
- Always-on tokens: the fourteen plugins come to about 212 by Claude Code's own estimate, over the old limit of 200, only because the estimate counts the descriptions of user-only skills, which the model is never sent (each new tool's README shows its request is the same size with and without the plugin). The gate is the check that already ran beside it: no request the fake API receives may mention a user-only skill. The estimate stays as a tripwire, under 250.
- Website and README: seventeen tools, fourteen plugins, the two cards and rows, over 6,900 tests, and the preview images say seventeen.

## [1.6.0] - 2026-10-16

- A fourteenth and a fifteenth tool. [claude-relocate](https://github.com/nrzz/claude-relocate) moves Claude Code's config folder (settings, sessions, the plugin cache, `.claude.json`) to another drive or into the XDG folders, writes `CLAUDE_CONFIG_DIR` into the shell profiles and the Windows user environment, leaves a link at the old place on request, refuses while Claude Code runs, and puts everything back with `undo`. [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor) keeps a commented `settings.jsonc` that builds `settings.json`, shows the settings Claude Code merges with the file each key came from and which file wins, and lints the files for what Claude Code ignores in silence (a comment or trailing comma, which costs the whole file; unknown keys; wrong types; deprecated keys; hook entries of the wrong shape). Both run on demand like md-doctor, session replay, chat ferry, permission doctor and hook bench, so there is nothing to install or switch on: the setup page lists relocate with three buttons that only look (plan, status, verify; the move itself is a command with `--yes`) and settings doctor with two (show the merged settings, check the files), and `status` says they run on demand. The marketplace carries the `settings-doctor` plugin (relocate has none: nothing about it belongs in a session). The end-to-end test gives each a home of its own: relocate moves a config folder with a session, a plugin file and a `.claude.json` to a sibling folder and back, every file byte for byte, after a dry run and a run without `--yes` that change nothing; settings doctor finds the unknown key in a user file, the trailing comma that makes Claude Code ignore a local file and, in a file checked on its own, a value of the wrong type, merges a project file over the user file with the shadowed value named, explains a key from the schema, changes nothing in those runs, then writes a `settings.jsonc` with `init`, builds `settings.json` from an edit to it with a backup first, and `check` exits 1 after a hand edit. With a Claude Code CLI at hand it also installs the plugin and runs its skill's command from the installed copy.
- Always-on tokens: all twelve plugins together add about 191 by Claude Code's own estimate (settings doctor's skill description, "Check settings files.", adds 11 by the estimate, while the request the model receives is the same size with and without the plugin, by its README's capture), under the 200 the end-to-end test allows, and the request Claude Code sends the model still mentions none of the user-only skills (now thirteen).
- Website and README: fifteen tools, twelve plugins, the two cards and rows, over 6,500 tests, and the preview images say fifteen.

## [1.5.0] - 2026-10-16

- A thirteenth tool: [claude-hook-bench](https://github.com/nrzz/claude-hook-bench) runs every hook of a Claude Code setup with the exact JSON Claude Code sends for its event and reports what each one does: exit code, time, output, whether the output is valid for the event, and whether Claude Code would block, allow, ask, add context or stay silent; before running anything it finds the mistakes Claude Code swallows in silence (a misspelled event, a lowercase matcher, a missing script, a wrong-typed field). Like md-doctor, session replay, chat ferry and permission doctor it only runs on demand, so there is nothing to install or switch on: the setup page lists it with two buttons (list the hooks and check them, run every hook), and `status` says it runs on demand. The marketplace carries its `hook-bench` plugin. The end-to-end test gives it a config of its own with four hooks (a deny on `rm -rf`, an invalid `systemMessage`, a misspelled event name and a SessionStart hook that prints context): `list --json` flags the misspelling, `run --json` calls the deny a deny for `rm -rf` and silent for `npm test`, the invalid output a non-blocking error with the field named, and the context hook `adds context`, and no file under the config folder changes. With a Claude Code CLI at hand it also installs the plugin and runs its skill's command from the installed copy.
- Always-on tokens: all eleven plugins together add about 180 by Claude Code's own estimate (hook bench's skill description adds 15), still under the 200 the end-to-end test allows, and the request Claude Code sends the model still mentions none of the user-only skills (now twelve).
- Website and README: thirteen tools, eleven plugins, the new tool's card and rows, over 5,800 tests, and the preview images say thirteen.

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

[1.7.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/nrzz/claude-code-toolkit/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/nrzz/claude-code-toolkit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nrzz/claude-code-toolkit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-toolkit/releases/tag/v1.0.0
