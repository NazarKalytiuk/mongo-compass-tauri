#!/usr/bin/env node
// Release helper. The version lives in src-tauri/Cargo.toml only (tauri.conf.json
// inherits it); release notes live in CHANGELOG.md.
//
//   npm run release -- <version>      bump, move "Unreleased" notes under the version,
//                                     commit and create an annotated tag (does not push)
//   npm run release -- notes <tag>    CI: check the tag matches Cargo.toml and print
//                                     that version's notes

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARGO = join(root, "src-tauri/Cargo.toml");
const CHANGELOG = join(root, "CHANGELOG.md");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function parse(version) {
  const m = SEMVER.exec(version);
  if (!m) fail(`"${version}" is not a semantic version (e.g. 1.2.3 or 1.2.3-beta.1)`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence (build metadata is not used). */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const PACKAGE_VERSION = /^(\[package\][^[]*?^version\s*=\s*")([^"]+)(")/m;

function cargoVersion() {
  const m = PACKAGE_VERSION.exec(readFileSync(CARGO, "utf8"));
  if (!m) fail("cannot find [package] version in src-tauri/Cargo.toml");
  return m[2];
}

/** Splits CHANGELOG.md into the text before the first release section and the sections. */
function readChangelog() {
  const text = readFileSync(CHANGELOG, "utf8");
  const parts = text.split(/^(?=## )/m);
  return { head: parts[0], sections: parts.slice(1) };
}

const sectionTitle = (section) => section.slice(3, section.indexOf("\n")).trim();
const sectionBody = (section) => section.slice(section.indexOf("\n") + 1).trim();

export function notesFor(sections, version) {
  const section = sections.find((s) => sectionTitle(s).split(/\s+/)[0] === version);
  return section ? sectionBody(section) : null;
}

function notes(tag) {
  if (!tag?.startsWith("v")) fail(`expected a tag like v1.2.3, got "${tag ?? ""}"`);
  const version = tag.slice(1);
  parse(version);
  const cargo = cargoVersion();
  if (cargo !== version) fail(`tag ${tag} does not match src-tauri/Cargo.toml version ${cargo}`);
  const body = notesFor(readChangelog().sections, version);
  if (!body) fail(`CHANGELOG.md has no notes for ${version}`);
  process.stdout.write(`${body}\n`);
}

function prepare(version) {
  parse(version);
  const tag = `v${version}`;

  if (git("status", "--porcelain")) fail("the working tree has uncommitted changes");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`releases are cut from main, not ${branch}`);
  if (git("remote").split("\n").includes("origin")) {
    git("fetch", "--quiet", "--tags", "origin", "main");
    if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fail("main is not in sync with origin/main");
  }
  if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`);

  const released = git("tag", "--list", "v*")
    .split("\n")
    .filter((t) => SEMVER.test(t.slice(1)))
    .map((t) => t.slice(1))
    .sort(compareVersions);
  const latest = released.at(-1);
  if (latest && compareVersions(version, latest) <= 0) fail(`${version} must be greater than the latest release ${latest}`);
  const current = cargoVersion();
  if (compareVersions(version, current) < 0) fail(`${version} is lower than the current version ${current}`);

  const { head, sections } = readChangelog();
  const unreleased = sections.findIndex((s) => sectionTitle(s) === "Unreleased");
  if (unreleased < 0) fail('CHANGELOG.md needs an "## Unreleased" section');
  const body = sectionBody(sections[unreleased]);
  if (!body) fail('"## Unreleased" in CHANGELOG.md is empty: describe the changes first');
  const date = new Date().toISOString().slice(0, 10);
  sections.splice(unreleased, 1, "## Unreleased\n\n", `## ${version} — ${date}\n\n${body}\n\n`);
  writeFileSync(CHANGELOG, `${head}${sections.join("")}`.trimEnd() + "\n");

  if (current !== version) {
    writeFileSync(CARGO, readFileSync(CARGO, "utf8").replace(PACKAGE_VERSION, `$1${version}$3`));
    // Refresh only the workspace package's entry in Cargo.lock.
    execFileSync("cargo", ["update", "--manifest-path", CARGO, "--workspace", "--offline"], { cwd: root, stdio: "inherit" });
  }

  git("add", "CHANGELOG.md", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock");
  git("commit", "--quiet", "-m", `Release ${tag}`);
  git("tag", "--annotate", tag, "-m", `Compass+ ${tag}\n\n${body}`);
  console.log(`Created commit and tag ${tag}. Publish it with:\n\n  git push --atomic origin main ${tag}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  if (command === "notes") notes(arg);
  else if (command && SEMVER.test(command)) prepare(command);
  else fail("usage: npm run release -- <version> | npm run release -- notes <tag>");
}
