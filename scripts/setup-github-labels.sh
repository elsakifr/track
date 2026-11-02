#!/usr/bin/env bash
# Creates (or updates) the labels defined in .github/labels.yml on the GitHub repo.
# Requires the GitHub CLI (`gh auth login`). Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

grep -E "^- \{" .github/labels.yml | while IFS= read -r line; do
  name=$(sed -E "s/.*name: '([^']+)'.*/\1/" <<<"$line")
  color=$(sed -E "s/.*color: '([^']+)'.*/\1/" <<<"$line")
  description=$(sed -E "s/.*description: '([^']+)'.*/\1/" <<<"$line")
  gh label create "$name" --color "$color" --description "$description" --force
done
