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
  try {
    return (await app.options.credential.getAccessToken()).access_token
  } catch (error) {
    throw credentialError(error, { projectId, clientEmail })
  }
}

/**
 * What a self-hoster is told when their service account is rejected
 * (AGL-2447).
 *
 * These three scripts are the FIRST commands the self-hosting runbook has an
 * operator run, before anything is built, and a mistyped or wrong-project
 * service account is the likeliest thing to go wrong in the whole runbook.
 * What it produced was **230 lines** of `GaxiosError` with a gaxios config
 * dump, a retry policy, a `Response internals` object and no sentence naming a
 * variable — for a failure whose entire content is "these credentials were
 * refused".
 *
 * Pure, exported and tested: the classification is the part that can be wrong,
 * and it must not need a rejected credential to exercise.
 */
export function credentialFailureMessage(error, { projectId, clientEmail }) {
  const raw = String(error?.message ?? error ?? '')
  const account = clientEmail || '(FIREBASE_CLIENT_EMAIL is empty)'
  const lines = [
    `Firebase refused the service account for project "${projectId || '(unset)'}".`,
    `  service account: ${account}`,
    '',
  ]

  if (/invalid_grant|account not found/i.test(raw)) {
    lines.push(
      'The credentials were rejected outright — the account does not exist, or',
      'the key has been revoked, or it belongs to a different project.',
      '',
      'Check, in this order:',
      `  • FIREBASE_PROJECT_ID (${projectId || 'unset'}) is the project the key was issued from.`,
      '  • FIREBASE_CLIENT_EMAIL matches the `client_email` in the JSON you downloaded.',
      '  • FIREBASE_PRIVATE_KEY is the whole key, quoted, with its \\n escapes intact.',
      '    Re-download from Firebase console → Project settings → Service accounts',
      '    → Generate new private key rather than re-typing it.',
    )
  } else if (/private key|DECODER|PEM|asn1|unsupported/i.test(raw)) {
    lines.push(
      'The private key could not be parsed at all, so nothing was sent to Google.',
      '',
      'FIREBASE_PRIVATE_KEY must keep the literal \\n escapes from the JSON and stay',
      'QUOTED in the env file — `set -a && source .env` eats the escapes otherwise,',
      'and an unquoted value silently becomes a key with the newlines removed.',
    )
  } else if (/permission|forbidden|403|IAM/i.test(raw)) {
    lines.push(
      'The credentials are valid but the account lacks permission on this project.',
      '',
      'Grant the service account the Firebase Rules Admin role (or Editor) in',
      'Google Cloud console → IAM, then re-run. Rules deploys are idempotent.',
    )
  } else {
    lines.push('The underlying error is below.')
  }

  lines.push('', `underlying error: ${raw || '(no message)'}`)
  return lines.join('\n')
}

/**
 * The same message as an Error that prints as ONLY that message.
 *
 * Two things have to go, and both were measured rather than assumed:
 *
 *  - the `stack`, because Node prints `err.stack` for an uncaught rejection,
 *    which reinstates the wall of frames this exists to remove;
 *  - the `cause`, because Node prints that too — attaching the original
 *    `GaxiosError` left the output at 227 lines, since the dump is a gzip
 *    stream object and a 16 KB byte array, not the error text. The underlying
 *    message is already the last line of the message itself, which is the part
 *    anyone debugging actually reads.
 */
function credentialError(error, account) {
  const message = credentialFailureMessage(error, account)
  const wrapped = new Error(message)
  wrapped.name = 'FirebaseCredentialError'
  wrapped.stack = `${wrapped.name}: ${message}`
  return wrapped
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
    throw new Error(`Network error fetching ${url}: ${error.message}`, {
      cause: error,
    })
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
      { cause: error },
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
