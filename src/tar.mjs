// Unpacks a .tar.gz the way GitHub serves a repository (ustar entries, pax headers for long
// paths, one top folder to strip). Regular files and folders only: links and devices are
// skipped, and an entry that would land outside the destination stops the whole extraction.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** pax records ("<length> <key>=<value>\n"), read as bytes so lengths stay right for any text. */
function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const space = buf.indexOf(0x20, i);
    if (space < 0) break;
    const len = Number.parseInt(buf.subarray(i, space).toString("ascii"), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = buf.subarray(space + 1, i + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

const field = (h, from, to) => h.subarray(from, to).toString("utf8").replace(/\0[\s\S]*$/, "");

/**
 * Extracts `archive` (gzipped tar bytes) into `dest`, dropping the first `strip` path parts.
 * @returns the relative paths of the files written
 */
export function extractTarGz(archive, dest, { strip = 1 } = {}) {
  const data = zlib.gunzipSync(archive);
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const written = [];
  let offset = 0;
  let nextPath = null;
  while (offset + 512 <= data.length) {
    const h = data.subarray(offset, offset + 512);
    if (h.every((b) => b === 0)) break;
    const size = Number.parseInt(field(h, 124, 136).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("damaged archive: bad entry size");
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
    const prefix = field(h, 257, 263).startsWith("ustar") ? field(h, 345, 500) : "";
    const name = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") { nextPath = parsePax(body).path ?? nextPath; continue; }
    if (type === "g") continue;
    if (type === "L") { nextPath = body.toString("utf8").replace(/\0[\s\S]*$/, ""); continue; }
    const full = nextPath ?? name;
    nextPath = null;

    const parts = full.split("/").filter((p) => p !== "" && p !== ".").slice(strip);
    if (!parts.length) continue;
    if (parts.includes("..") || /^[A-Za-z]:/.test(parts[0])) throw new Error(`unsafe path in archive: ${full}`);
    const target = path.join(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`unsafe path in archive: ${full}`);
    if (type === "5") { fs.mkdirSync(target, { recursive: true }); continue; }
    if (type !== "0" && type !== "7") continue; // links, devices, FIFOs
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    written.push(parts.join("/"));
  }
  return written;
}
