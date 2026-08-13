/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared env-loading, service-account auth, and Firebase Rules REST access
 * for the rules deploy scripts (deploy-*-rules.mjs) and the drift checker
 * (check-rules-drift.mjs).
 *
 * Extracted from deploy-firestore-rules.mjs (AGL-1509) so the checker reuses
 * the deploy path's exact fetch/auth pattern instead of growing a second
 * implementation. If the way we authenticate or address a release ever
 * changes, it changes HERE, for the writer and the reader at once — a checker
 * whose read path can silently diverge from the deploy's write path would
 * eventually verify something other than what deploys.
 */

import { existsSync, readFileSync } from 'node:fs'

/**
 * Load admin creds from the repo's local env files so each script is a single
 * self-contained command (matches the backfill scripts). Already-set
 * process.env still wins, so `source .env` first is optional. Paths are
 * relative to the CWD on purpose: run from the repo root (or a worktree
 * root), you get that checkout's env.
 */
export function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  for (const file of roots.flatMap((r) => names.map((n) => `${r}/${n}`))) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

/**
 * The firebaserules API origin. Overridable via FIREBASE_RULES_API_BASE so
 * the drift checker's tests can point the WHOLE auth+fetch pipeline at a
 * local stub and feed it doctored "live" rules.
 */
export function rulesApiBase() {
  return (
    process.env.FIREBASE_RULES_API_BASE || 'https://firebaserules.googleapis.com'
  ).replace(/\/+$/, '')
}

/**
 * Read the service account from env, or null when any part is missing.
 * FIREBASE_PRIVATE_KEY may carry literal `\n` (the .env convention).
 */
export function readServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) return null
  return { projectId, clientEmail, privateKey }
}

let appCounter = 0

/**
 * Mint an OAuth access token from the service account via firebase-admin —
 * the same credential path the deploys use; the key never touches disk.
 * firebase-admin is imported lazily so callers that never mint a token
 * (e.g. the checker under RULES_CHECK_ACCESS_TOKEN in tests) do not load it.
 */
export async function getServiceAccountToken({
  projectId,
  clientEmail,
  privateKey,
}) {
  const { cert, initializeApp } = await import('firebase-admin/app')
  const app = initializeApp(
    { credential: cert({ projectId, clientEmail, privateKey }) },
    `rules-api-${appCounter++}`,
  )
  return (await app.options.credential.getAccessToken()).access_token
}

/** The header set every firebaserules call sends. */
export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * The bucket a storage release is scoped to: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * (the same var the app routes use), or FIREBASE_STORAGE_BUCKET, falling back
 * to `{projectId}.appspot.com` — identical resolution to deploy-storage-rules.
 */
export function resolveStorageBucket(projectId) {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    `${projectId}.appspot.com`
  )
}

/**
 * The RTDB instance URL: NEXT_PUBLIC_FIREBASE_DATABASE_URL, or
 * FIREBASE_DATABASE_URL, falling back to the default
 * `{projectId}-default-rtdb.firebaseio.com` instance — identical resolution
 * to deploy-database-rules.
 */
export function resolveDatabaseUrl(projectId) {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    process.env.FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.firebaseio.com`
  ).replace(/\/+$/, '')
}

/**
 * Hit the RTDB `/.settings/rules.json` endpoint. The RTDB REST endpoint
 * accepts the OAuth token either as an Authorization header or the
 * `?access_token=` query param depending on the instance/region — try the
 * header first, fall back to the query param on an auth rejection. Shared by
 * the deploy's PUT and the checker's GET so the fallback dance exists once.
 */
export async function databaseRulesRequest(databaseUrl, token, init = {}) {
  const base = databaseUrl.replace(/\/+$/, '')
  const request = (viaQueryParam) => {
    const url = viaQueryParam
      ? `${base}/.settings/rules.json?access_token=${encodeURIComponent(token)}`
      : `${base}/.settings/rules.json`
    return fetch(url, {
      ...init,
      headers: viaQueryParam
        ? { 'Content-Type': 'application/json' }
        : {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
    })
  }
  let response = await request(false)
  if (response.status === 401 || response.status === 403) {
    response = await request(true)
  }
  return response
}

/** GET a JSON resource; throw a descriptive error on any non-2xx. */
async function fetchJson(url, init) {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new Error(`Network error fetching ${url}: ${error.message}`)
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 300)}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${body.slice(0, 300)}`)
  }
}

/**
 * Fetch the LIVE rules source behind a firebaserules release:
 * GET the release (e.g. `cloud.firestore`, `firebase.storage/{bucket}`) →
 * `rulesetName` → GET that ruleset → `source.files[0].content`. A release id
 * may contain a slash; the resource pattern is `projects/*\/releases/**`, so
 * it needs no encoding (same as the deploys' release-update PATCH).
 */
export async function fetchLiveRulesetContent({ token, projectId, releaseId }) {
  const base = rulesApiBase()
  const release = await fetchJson(
    `${base}/v1/projects/${projectId}/releases/${releaseId}`,
    { headers: authHeaders(token) },
  )
  if (!release.rulesetName) {
    throw new Error(
      `Release ${releaseId} has no rulesetName: ${JSON.stringify(release).slice(0, 300)}`,
    )
  }
  const ruleset = await fetchJson(`${base}/v1/${release.rulesetName}`, {
    headers: authHeaders(token),
  })
  const content = ruleset?.source?.files?.[0]?.content
  if (typeof content !== 'string') {
    throw new Error(
      `Ruleset ${release.rulesetName} has no source.files[0].content`,
    )
  }
  return {
    content,
    rulesetName: release.rulesetName,
    updateTime: release.updateTime,
  }
}

/** Fetch the LIVE RTDB rules text from `/.settings/rules.json`. */
export async function fetchLiveDatabaseRules({ token, databaseUrl }) {
  let response
  try {
    response = await databaseRulesRequest(databaseUrl, token, { method: 'GET' })
  } catch (error) {
    throw new Error(
      `Network error fetching ${databaseUrl}/.settings/rules.json: ${error.message}`,
    )
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `RTDB rules read failed (HTTP ${response.status}): ${body.slice(0, 300)}`,
    )
  }
  return { content: body }
}
