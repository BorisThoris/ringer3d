#!/usr/bin/env bash
# Push smoke-test screenshots and logs to the ci-screens branch (one folder per platform).
set -uo pipefail
PLATFORM=$1
[ -d smoke ] || exit 0
git config --global user.name "github-actions"
git config --global user.email "github-actions@users.noreply.github.com"
TMP=$(mktemp -d)
cp -r smoke "$TMP/$PLATFORM"
for attempt in 1 2 3; do
  rm -rf pub && mkdir pub && cd pub
  git init -q
  git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  if git fetch -q --depth 1 origin ci-screens 2>/dev/null; then git checkout -q -b ci-screens FETCH_HEAD; else git checkout -q --orphan ci-screens; fi
  rm -rf "$PLATFORM" && cp -r "$TMP/$PLATFORM" "$PLATFORM"
  echo "${GITHUB_SHA}" > "$PLATFORM/commit.txt"
  git add -A && git commit -qm "Smoke screenshots: $PLATFORM @ ${GITHUB_SHA:0:7}" || true
  if git push -q origin ci-screens; then exit 0; fi
  cd .. && sleep 5
done
