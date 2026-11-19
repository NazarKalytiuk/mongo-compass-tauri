#!/usr/bin/env node
// Writes the updater feed (latest.json) for a GitHub release.
//
// Archive URLs use the public release download path. It is stable once the release
// is published and, unlike api.github.com asset URLs (which tauri-action would use),
// it is not subject to the anonymous API rate limit (60 requests/hour per IP).
//
//   node scripts/update-feed.mjs --repo owner/name --tag v1.2.3 --notes notes.md \
//     --signatures <dir with <asset>.sig files> \
//     --platform darwin-aarch64=<asset> --platform linux-x86_64=<asset> ... > latest.json

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

/** Updater artifact each platform key must point at. */
const ARTIFACT = {
  "darwin-aarch64": /\.app\.tar\.gz$/,
  "darwin-x86_64": /\.app\.tar\.gz$/,
  "linux-x86_64": /\.AppImage$/,
  "windows-x86_64": /-setup\.exe$/,
};

export function buildFeed({ repo, tag, notes, pubDate, platforms }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`invalid repository "${repo}"`);
  if (!/^v\d+\.\d+\.\d+/.test(tag)) throw new Error(`invalid tag "${tag}"`);
  if (platforms.length === 0) throw new Error("no platforms");
  const entries = platforms.map(({ key, asset, signature }) => {
    const expected = ARTIFACT[key];
    if (!expected) throw new Error(`unknown platform "${key}"`);
    if (!expected.test(asset)) throw new Error(`"${asset}" is not an updater artifact for ${key}`);
    const sig = signature.trim();
    if (!sig) throw new Error(`empty signature for ${asset}`);
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
    return [key, { signature: sig, url }];
  });
  return {
    version: tag.slice(1),
    notes: notes.trim(),
    pub_date: pubDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: Object.fromEntries(entries),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      tag: { type: "string" },
      notes: { type: "string" },
      signatures: { type: "string" },
      platform: { type: "string", multiple: true },
    },
  });
  for (const k of ["repo", "tag", "notes", "signatures", "platform"]) {
    if (!values[k]) {
      console.error(`update-feed: --${k} is required`);
      process.exit(2);
    }
  }
  const platforms = values.platform.map((spec) => {
    const [key, asset] = spec.split("=", 2);
    if (!key || !asset) throw new Error(`--platform expects <key>=<asset>, got "${spec}"`);
    return { key, asset, signature: readFileSync(join(values.signatures, `${asset}.sig`), "utf8") };
  });
  const feed = buildFeed({
    repo: values.repo,
    tag: values.tag,
    notes: readFileSync(values.notes, "utf8"),
    pubDate: new Date(),
    platforms,
  });
  process.stdout.write(`${JSON.stringify(feed, null, 2)}\n`);
}
