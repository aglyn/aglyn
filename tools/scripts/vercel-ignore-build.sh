#!/usr/bin/env bash
#
# @license
# Copyright 2026 Aglyn LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Vercel "Ignored Build Step" for the apps that share this repo (AGL-1187).
#
# Usage:  tools/scripts/vercel-ignore-build.sh <app> [base] [head]
#
# EXIT CODES ARE VERCEL'S, AND THEY READ BACKWARDS:
#
#     exit 0  ->  IGNORE (Vercel cancels the build)
#     exit 1  ->  BUILD
#
# Every push to `production` fans out to all four Vercel projects, so one
# promotion used to cost four deployments against a 100/day account limit —
# and on 2026-08-02 that limit was hit, leaving a merged production PR
# serving nothing. Most of those builds rebuild an app that nothing in the
# commit could possibly have changed.
#
# WHY THIS IS A PATH TEST AND NOT `nx affected`
#
# `nx show projects --affected` is the precise answer and is what you would
# reach for first. It needs the project graph, which needs node_modules,
# which the ignore step does not reliably have — it runs before install.
# A path test needs nothing but git, which is always there.
#
# THE RULE IS DENY-BY-DEFAULT, AND THAT IS THE WHOLE DESIGN
#
# We ignore a build only when EVERY changed file is one we can positively
# name as irrelevant to this app. Anything unrecognised — a new top-level
# directory, anything under libs/, a root config file — builds.
#
# This matters because the two failure directions are not symmetric:
#
#   * wrongly BUILD  -> one wasted deployment slot. Annoying.
#   * wrongly IGNORE -> the app silently keeps serving the old code while
#                       every signal (merged PR, green branch) says shipped.
#                       That is the exact failure AGL-1187 was filed for.
#
# So when in doubt, build. Every error path below exits 1 deliberately:
# a missing base commit (Vercel's clone can be shallow), an unknown app
# name, or a git failure all end in a build rather than a silent skip.
#
# `libs/**` ALWAYS BUILDS. Console and tenant both consume the shared
# libraries and a leaf change in one can reach either, so libs is never
# treated as ignorable. Measured against the 15 promotions before this
# landed, that costs nothing: this rule reproduced `nx affected` on 8 of
# the 9 tenant skips and 3 of the 4 console skips, and never once skipped
# a build nx said was needed.

set -uo pipefail

APP="${1:-}"
BASE="${2:-HEAD^}"
HEAD_REF="${3:-HEAD}"

# Previews are disabled for these projects in vercel.json; this is belt and
# braces, and preserves what the previous inline command did.
if [ "${VERCEL_ENV:-production}" != "production" ]; then
  echo "ignore-build: VERCEL_ENV=${VERCEL_ENV:-} is not production -> IGNORE"
  exit 0
fi

case "$APP" in
  console|tenant) ;;
  *)
    echo "ignore-build: unknown app '$APP' -> BUILD (fail safe)" >&2
    exit 1
    ;;
esac

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "ignore-build: not a git checkout -> BUILD (fail safe)" >&2
  exit 1
}
cd "$ROOT" || exit 1

# A shallow clone may not have the base commit. Deepen once, then give up
# and build — never skip on an unknown diff.
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  git fetch --deepen=50 >/dev/null 2>&1 || true
fi
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "ignore-build: '$BASE' unavailable (shallow clone) -> BUILD (fail safe)" >&2
  exit 1
fi

CHANGED=$(git diff --name-only "$BASE" "$HEAD_REF" 2>/dev/null) || {
  echo "ignore-build: git diff failed -> BUILD (fail safe)" >&2
  exit 1
}

if [ -z "$CHANGED" ]; then
  echo "ignore-build: no files changed -> BUILD (fail safe)"
  exit 1
fi

# Paths that cannot affect a Next.js app build here.
#
#   apps/<other>/   the other deployable apps; none imports another
#   apps/docs/      Docusaurus, standalone (own package.json + node_modules)
#   apps/www/       deprecated marketing site, no longer even deployed
#   cloud/          Firebase rules, indexes and functions — a separate
#                   deploy surface, imported by no app source
#   .github/        CI workflows
#   .claude/        agent config
#   docs/           repo-root markdown (NOT apps/docs, which is the site)
#
# Deliberately NOT ignorable, though it may look like it should be:
#   tools/          `with-aglyn.nextjs.config.js` and the next.config files
#                   reach into tools/, so a change there can reach a build.
#   libs/           see the header.
is_ignorable() {
  case "$1" in
    apps/docs/*|apps/www/*) return 0 ;;
    cloud/*|.github/*|.claude/*|docs/*) return 0 ;;
    *.md|.gitignore) return 0 ;;
  esac
  # The sibling app: console ignores tenant's changes and vice versa.
  if [ "$APP" = "console" ]; then
    case "$1" in apps/tenant/*) return 0 ;; esac
  else
    case "$1" in apps/console/*) return 0 ;; esac
  fi
  return 1
}

while IFS= read -r file; do
  [ -z "$file" ] && continue
  if ! is_ignorable "$file"; then
    echo "ignore-build[$APP]: '$file' may affect this app -> BUILD"
    exit 1
  fi
done <<EOF
$CHANGED
EOF

echo "ignore-build[$APP]: every changed file is irrelevant to this app -> IGNORE"
exit 0
