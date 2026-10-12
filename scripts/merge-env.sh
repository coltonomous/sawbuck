#!/bin/bash
# Merge KEY=value lines from an updates file into an env file. A key present in
# the updates replaces that key's line (in place); keys not yet in the env file
# are appended; every other line is kept as is. Used by deploy.yml so rotating
# a GitHub secret actually reaches the server's .env.
#
# Usage: merge-env.sh <env-file> <updates-file>
set -euo pipefail

env_file=$1
updates=$2

touch "$env_file"
tmp=$(mktemp "$env_file.XXXXXX")

awk '
  FILENAME == ARGV[1] {
    i = index($0, "=")
    if (i > 1) { k = substr($0, 1, i - 1); if (!(k in val)) order[++n] = k; val[k] = $0 }
    next
  }
  {
    i = index($0, "=")
    k = i > 1 ? substr($0, 1, i - 1) : ""
    if (k in val) {
      if (!(k in done)) { print val[k]; done[k] = 1 }
      next
    }
    print
  }
  END { for (j = 1; j <= n; j++) if (!(order[j] in done)) print val[order[j]] }
' "$updates" "$env_file" > "$tmp"

# Write through the existing file so its owner and permissions are kept
cat "$tmp" > "$env_file"
rm -f "$tmp"
