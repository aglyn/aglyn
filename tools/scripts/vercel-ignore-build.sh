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
# NOTE: `aglyn-plugins` does NOT use this script — it has its own
# `ignoreCommand` in `tools/plugin-loader/origin/vercel.json`, because Vercel
# reads vercel.json from a project's ROOT DIRECTORY and that project's root is
# `tools/plugin-loader/origin`, not the repo root.
#
# That project also taught the distinction this whole file turns on
# (2026-08-04): an **ignoreCommand cancels a build, it does not prevent a
# DEPLOYMENT**. Vercel creates the deployment record first, then runs the
# ignore step, then cancels — and the record still counts against the daily
# limit. `aglyn-plugins` was set to `deploymentEnabled: {main: true}` while
# every other project is `production` only, so it burned one canceled record
# per push to `main` — 20 in a single day, none of which built anything.
#
# Measured 2026-08-04: 99 of the last 100 aglyn-plugins deployments were
# CANCELED and exactly ONE built (a real loader change on 08-02). So the ignore
# step was always doing its job — the cost was purely the created-then-canceled
# RECORDS, roughly 50/day against a 100/day account limit.
#
# So the two levers are not interchangeable:
#   git.deploymentEnabled  -> no deployment is CREATED (saves the quota)
#   ignoreCommand          -> deployment created, build skipped (saves build
#                             minutes, NOT quota)
# Use the first to pick which branches deploy at all; the second to skip work
# within a branch that does.
#
# OUT-OF-REPO DEPENDENCY, and the reason this paragraph exists: the plugins
# project's `deploymentEnabled: {production: true, main: false}` is only correct
# because its Vercel **Production Branch** is `production`. That setting is
# dashboard state, not repo state, and it was `main` until 2026-08-04 — while it
# was, `main: false` would have meant the project serving `plugins.aglyn.com`
# received NO production deployments at all, silently, since a push to
# `production` would have been a preview.
#
# So the two must move together. If anyone sets the branch back, set
# `main: true` in the same change or the origin quietly stops updating.
#
# The setting is NOT on the Git settings page any more (that cost a search):
#   Project -> Settings -> Environments -> Production -> Branch Tracking
# Verify it from outside the UI, which is what actually caught a missed click:
#   curl -H "Authorization: Bearer $VERCEL_TOKEN" \
#     "https://api.vercel.com/v9/projects/<id>?teamId=<team>" | jq .link.productionBranch
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
# The FULL push range, not just the last commit (2026-08-04).
#
# `HEAD^` only ever inspects ONE commit. A push carrying several — the normal
# shape of a promotion, and of any batched work — would be judged on its tip
# alone, so a change in an earlier commit of the same push is invisible and the
# build is skipped. That is the silent-stale failure this script exists to
# prevent, reintroduced by the default.
#
# `VERCEL_GIT_PREVIOUS_SHA` is what Vercel sets to the sha of the last
# SUCCESSFUL deployment for this project and branch, so it also spans any
# pushes that were themselves skipped or canceled in between — which `HEAD^`
# cannot see at all. `HEAD^` remains the fallback for a local run.
BASE="${2:-${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}}"
HEAD_REF="${3:-${VERCEL_GIT_COMMIT_SHA:-HEAD}}"

# Previews are disabled for these projects in vercel.json; this is belt and
# braces, and preserves what the previous inline command did.
if [ "${VERCEL_ENV:-production}" != "production" ]; then
  echo "ignore-build: VERCEL_ENV=${VERCEL_ENV:-} is not production -> IGNORE"
  exit 0
fi

case "$APP" in
  console|tenant|plugins) ;;
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
  # `plugins` inverts the rule, and it is the one app where that is safe.
  # `tools/plugin-loader/origin` is 9 files with a single LOCAL import and no
  # dependency on libs/ or any app — verified, not assumed — so nothing outside
  # that directory can change what it serves. Everything else is ignorable.
  if [ "$APP" = "plugins" ]; then
    case "$1" in tools/plugin-loader/origin/*) return 1 ;; esac
    return 0
  fi
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
