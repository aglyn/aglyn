#!/usr/bin/env bash
#
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
# ---------------------------------------------------------------------------
# Is a scheduled console cron route in the DEPLOYED tree yet? (AGL-2359)
#
# `.github/workflows/scheduled-crons.yml` lives on `main`; the routes it POSTs
# live in production. Those are different trees, and a workflow change takes
# effect the instant it lands on `main` while the route it calls only exists in
# production after a promotion. AGL-1996/AGL-2010 landed the
# `finish-domain-attachments` route and its `*/20 * * * *` schedule in one
# correct commit, and the cron then 404ed ~72 times a day against a production
# deploy that was 236 commits behind.
#
# ⚠️ THIS MUST NOT BECOME A CHECK THAT CANNOT FAIL. The workflow exists to
# notice broken crons — "silence is the bug", in its own words — so "a 404 is
# fine" is precisely the wrong fix. This script never looks at the cron
# route's response at all. It answers one narrower question, from the repo
# rather than from the wire:
#
#     does the source file that implements this route exist at
#     refs/heads/production?
#
# Only a provable NO lets the workflow skip. Every other outcome — including
# "the API would not answer" and "the mapping below points at a file that is
# not even on this branch" — prints `unknown`, the workflow POSTs anyway, and a
# 404 goes red exactly as before. It fails CLOSED.
#
# Usage:
#   cron-deploy-state.sh <route>          # deployed | not-deployed | unknown
#   cron-deploy-state.sh --impl <route>   # the implementing source path
#
# Environment:
#   GITHUB_REPOSITORY  owner/name                     (required)
#   GITHUB_SHA         the ref the workflow ran from  (required)
#   GITHUB_API_URL     default https://api.github.com
#   GITHUB_TOKEN       optional; the repo is public
#   DEPLOYED_REF       default `production`
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# route -> the source file that implements it.
#
# The default is the Next.js App Router convention, but it is NOT the whole
# truth and a guard built on it alone would be actively harmful.
# `/api/campaigns/process-scheduled` has no `apps/console/app/api/campaigns/…`
# file on ANY ref — the marketing plugin's server router serves it through the
# console's `/api/[...pluginApi]` catch-all — and it returns 200 in production
# today. Resolving it by convention would report a working cron as not yet
# deployed and quietly stop calling it: the same silent-inertness bug that
# AGL-2134 fixed, reintroduced by its own guard.
#
# So every PLUGIN-SERVED cron route needs an arm of its own. A missing arm is
# not a loud failure: convention resolves it to an `apps/console/app/…` path
# that exists on no ref, the script answers `unknown`, and the one question it
# was built to settle silently stops being answerable for that route. Every
# entry here — and the completeness of this list against BOTH runners — is
# asserted by apps/console/specs/scheduled-crons-wiring.spec.ts.
# ---------------------------------------------------------------------------
route_impl() {
  # A route may carry a query string (`?month=current`, AGL-2219); the file on
  # disk does not.
  local bare="${1%%\?*}"
  case "$bare" in
    /api/campaigns/process-scheduled)
      printf '%s' 'libs/plugins/marketing/src/lib/server/campaign-process-scheduled.ts'
      ;;
    /api/lists/materialize)
      printf '%s' 'libs/plugins/marketing/src/lib/server/lists-materialize.ts'
      ;;
    /api/*)
      printf 'apps/console/app%s/route.ts' "$bare"
      ;;
    *)
      return 1
      ;;
  esac
}

if [ "${1:-}" = '--impl' ]; then
  route_impl "${2:?route required}"
  echo
  exit 0
fi

route="${1:?usage: cron-deploy-state.sh [--impl] <route>}"
api="${GITHUB_API_URL:-https://api.github.com}"
repo="${GITHUB_REPOSITORY:-}"
here="${GITHUB_SHA:-}"
deployed_ref="${DEPLOYED_REF:-production}"

# `unknown` is the answer whenever the question cannot be settled, and the
# caller must treat it as "call the route".
give_up() {
  echo "cron-deploy-state: $1 — cannot prove the route is undeployed." >&2
  echo 'unknown'
  exit 0
}

# Seeded with the two headers every call sends rather than declared empty:
# under `set -u`, bash 3.2 (macOS, and anyone running this outside the
# runner) treats `"${empty[@]}"` as an unbound variable and aborts.
curl_args=(-H 'accept: application/vnd.github+json'
           -H 'x-github-api-version: 2022-11-28')
if [ -n "${GITHUB_TOKEN:-}" ]; then
  curl_args+=(-H "authorization: Bearer ${GITHUB_TOKEN}")
fi

# Prints an HTTP status, or 000 when the request never completed.
probe() {
  local code
  code=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
    "${curl_args[@]}" "$1") || code=000
  printf '%s' "${code:-000}"
}

[ -n "$repo" ] || give_up 'GITHUB_REPOSITORY is not set'
[ -n "$here" ] || give_up 'GITHUB_SHA is not set'

impl=$(route_impl "$route") || give_up "no source mapping for route '$route'"
echo "cron-deploy-state: $route is implemented by $impl" >&2

# 1. The deployed ref must resolve. Without this the guard is a check that
#    cannot fail: rename or delete `production` and every `contents` probe
#    below 404s, every route reads as not-yet-deployed, and the workflow
#    skips forever while saying it is being careful.
code=$(probe "${api}/repos/${repo}/branches/${deployed_ref}")
[ "$code" = '200' ] || give_up "branch '${deployed_ref}' probe returned HTTP ${code}"

# 2. The mapping must point at a file that really is on the branch we are
#    running from. A moved or renamed route would otherwise be absent from
#    BOTH refs and read as "not deployed yet" forever — a rotted mapping must
#    disarm this guard, not silence the cron.
code=$(probe "${api}/repos/${repo}/contents/${impl}?ref=${here}")
[ "$code" = '200' ] || give_up "${impl} is not at ${here} (HTTP ${code}); the mapping is stale"

# 3. Only now is a 404 meaningful: the file exists here, the deployed branch
#    exists, and the file is not on it.
code=$(probe "${api}/repos/${repo}/contents/${impl}?ref=${deployed_ref}")
case "$code" in
  200) echo 'deployed' ;;
  404) echo 'not-deployed' ;;
  *) give_up "${impl}@${deployed_ref} probe returned HTTP ${code}" ;;
esac
