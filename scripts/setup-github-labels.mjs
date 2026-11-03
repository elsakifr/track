#!/usr/bin/env node
// Creates (or updates) the labels defined in .github/labels.yml on the GitHub repo.
// Requires the GitHub CLI (`gh auth login`). Safe to re-run.
//
// Usage: node scripts/setup-github-labels.mjs [--dry-run] [labels-file]
//   --dry-run  Validate and print the labels without calling GitHub.
//
// All entries are validated before anything is sent to GitHub.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args[0] === '--dry-run';
if (dryRun) args.shift();
const file = resolve(args[0] ?? `${repoRoot}/.github/labels.yml`);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

let labels;
try {
  labels = yaml.load(readFileSync(file, 'utf8'));
} catch (err) {
  fail(`cannot read ${file}: ${err.message}`);
}
if (!Array.isArray(labels) || labels.length === 0) fail(`no labels found in ${file}`);

const errors = [];
const seen = new Set();
labels.forEach((label, i) => {
  const entry = `entry ${i + 1}`;
  if (typeof label !== 'object' || label === null || Array.isArray(label)) {
    errors.push(`${entry}: must be a mapping with name, color and description`);
    return;
  }
  const { name, color, description = '' } = label;
  if (typeof name !== 'string' || name === '') errors.push(`${entry}: missing name`);
  else if (seen.has(name)) errors.push(`${entry}: duplicate label '${name}'`);
  else seen.add(name);
  // Colors must be quoted strings: YAML reads an unquoted 000000 as the number 0.
  if (typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color)) {
    errors.push(`${entry} (${name}): color must be a quoted 6-digit hex string, got '${color}'`);
  }
  if (typeof description !== 'string') errors.push(`${entry} (${name}): description must be text`);
});
if (errors.length > 0) {
  errors.forEach((e) => console.error(`error: ${e}`));
  fail(
    `${errors.length} invalid ${errors.length === 1 ? 'entry' : 'entries'}; nothing was changed`,
  );
}

for (const { name, color, description = '' } of labels) {
  if (dryRun) {
    console.log([name, color, description].join('\t'));
  } else {
    // Run from the repository root so `gh` always targets this repository.
    const ghArgs = ['label', 'create', name, '--color', color, '--description', description];
    execFileSync('gh', [...ghArgs, '--force'], { cwd: repoRoot, stdio: 'inherit' });
  }
}
if (dryRun) console.error(`dry run: ${labels.length} labels validated; GitHub was not changed`);
