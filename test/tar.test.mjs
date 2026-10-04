// The tarball reader: GitHub's layout (a pax global header, one top folder, pax long paths), and
// archives that try to write outside the destination.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { extractTarGz } from "../src/tar.mjs";
import { tmp } from "./helpers.mjs";

function header(name, size, type) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}
function entry(name, content = "", type = "0") {
  const body = Buffer.from(content);
  return Buffer.concat([header(name, body.length, type), body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
function paxRecord(key, value) {
  const rest = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(rest) + 1;
  while (String(len).length + Buffer.byteLength(rest) !== len) len = String(len).length + Buffer.byteLength(rest);
  return `${len}${rest}`;
}
const archive = (...entries) => zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

test("extracts a GitHub-style archive: global header skipped, top folder stripped, long paths kept", () => {
  const long = `repo-abc123/${"deep/".repeat(30)}file.txt`;
  const dest = tmp();
  const files = extractTarGz(archive(
    entry("pax_global_header", paxRecord("comment", "abc123"), "g"),
    entry("repo-abc123/", "", "5"),
    entry("repo-abc123/bin/tool.mjs", "console.log('hi')\n"),
    entry("PaxHeader", paxRecord("path", long), "x"),
    entry("repo-abc123/ignored-short-name", "deep content"),
    entry("repo-abc123/link", "", "2"),
  ), dest);
  assert.deepEqual(files, ["bin/tool.mjs", `${"deep/".repeat(30)}file.txt`]);
  assert.equal(fs.readFileSync(path.join(dest, "bin", "tool.mjs"), "utf8"), "console.log('hi')\n");
  assert.equal(fs.readFileSync(path.join(dest, ...long.split("/").slice(1)), "utf8"), "deep content");
  assert.equal(fs.existsSync(path.join(dest, "link")), false, "links are skipped");
});

test("an entry that climbs out of the destination stops the extraction", () => {
  const parent = tmp();
  const dest = path.join(parent, "out");
  assert.throws(() => extractTarGz(archive(entry("repo/../../evil.txt", "x")), dest), /unsafe path/);
  assert.throws(() => extractTarGz(archive(entry("PaxHeader", paxRecord("path", "repo/../../evil2.txt"), "x"), entry("repo/x", "x")), dest), /unsafe path/);
  assert.throws(() => extractTarGz(archive(entry("repo/C:/Windows/evil.txt", "x")), dest), /unsafe path/);
  assert.equal(fs.existsSync(path.join(parent, "evil.txt")), false);
  assert.equal(fs.existsSync(path.join(parent, "evil2.txt")), false);
});

test("a pax path with characters beyond ASCII keeps its record lengths in bytes", () => {
  const dest = tmp();
  const files = extractTarGz(archive(entry("PaxHeader", paxRecord("path", "repo/docs/caf\u00e9-\u00fcber.md"), "x"), entry("repo/x", "accents")), dest);
  assert.deepEqual(files, ["docs/caf\u00e9-\u00fcber.md"]);
});
