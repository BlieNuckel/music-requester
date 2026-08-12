#!/usr/bin/env bash
# Turns a fixed-output-derivation hash mismatch in a Nix build log into a
# ready-to-paste fix in the job summary. Contributors don't necessarily have Nix
# installed, so the hash CI computed is the only practical source for the fix.
set -euo pipefail

log="${1:?usage: report-stale-pnpm-hash.sh <nix-build-log>}"

hash=$(awk '
  /hash mismatch in fixed-output derivation/ { seen = 1 }
  seen && $1 == "got:" { print $2; exit }
' "$log")

if [ -z "$hash" ]; then
  echo "The Nix build failed for a reason other than a stale pnpmDeps hash; see the build log."
  exit 0
fi

{
  echo "### Stale \`pnpmDeps\` hash"
  echo
  echo "\`pnpm-lock.yaml\` changed, so the offline pnpm store changed with it. Replace the \`hash\` line in the \`pnpmDeps\` block of \`nix/package.nix\` with:"
  echo
  echo '```nix'
  echo "    hash = \"$hash\";"
  echo '```'
  echo
  echo "Do this last: re-resolving the lockfile (for example to satisfy pnpm's \`minimumReleaseAge\` policy) changes the hash again."
} >>"$GITHUB_STEP_SUMMARY"

echo "::error file=nix/package.nix,title=Stale pnpmDeps hash::Replace the pnpmDeps hash with $hash"
