#!/usr/bin/env node
// npx -y github:nrzz/claude-code-toolkit  : the setup page for the whole toolkit.
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
