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
 * READ-ONLY access to the live Firestore index configuration, via the
 * Firestore Admin REST API (AGL-1804). GET only — nothing here writes, and
 * deploying indexes stays the manual `firebase deploy --only firestore:indexes`
 * step it has always been.
 *
 * Auth is deliberately the rules checker's: service account out of the root
 * .env via lib/firebase-rules-api.mjs. That path already has CI secrets
 * (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) wired for rules-drift.yml, so
 * the index check costs no new credential. The alternative — shelling out to
 * `firebase firestore:indexes` — would need a second, differently-authenticated
 * tool on the runner. Its output WAS used to cross-check this module: the CLI
 * and these two calls report the same 43 indexes and the same 16 overrides
 * against `aglyn-main`.
 *
 * ⚠️ TWO TRAPS LIVE HERE, both measured against production:
 *
 *  1. `pageSize` IS REJECTED on the `-` (all collection groups) wildcard:
 *     "Invalid page size. Only 0 is supported." So the page size is never sent
 *     and pagination is driven purely by `nextPageToken`.
 *
 *  2. THE OBVIOUS FIELD FILTER SILENTLY OMITS TTL POLICIES. `ListFields` only
 *     returns overridden fields, and the documented filter for that is
 *     `indexConfig.usesAncestorConfig=false`. Both of this project's TTL fields
 *     report `usesAncestorConfig: TRUE` — a TTL policy does not necessarily
 *     give the field an index config of its own — so that filter returns 15
 *     fields and misses `mediaTombstones.expiresAt` and
 *     `rateLimits.expiresAt` entirely. A drift checker built on it would have
 *     reported a clean project on the exact AGL-1801 case it exists to catch.
 *     `... OR ttlConfig:*` returns 17 and matches what the Firebase CLI shows.
 */

import {
  authHeaders,
  getServiceAccountToken,
  readServiceAccount,
} from './firebase-rules-api.mjs'

/**
 * The Firestore Admin API origin. Overridable via FIRESTORE_ADMIN_API_BASE so
 * a test can point the whole fetch pipeline at a local stub.
 */
export function firestoreAdminApiBase() {
  return (
    process.env.FIRESTORE_ADMIN_API_BASE || 'https://firestore.googleapis.com'
  ).replace(/\/+$/, '')
}

/** The database id to read; `(default)` unless FIRESTORE_DATABASE_ID says otherwise. */
export function resolveDatabaseId() {
  return process.env.FIRESTORE_DATABASE_ID || '(default)'
}

/**
 * The filter that makes `ListFields` return every explicitly-configured field.
 * See trap 2 above: without the `ttlConfig` half, TTL policies are invisible.
 */
export const FIELD_OVERRIDE_FILTER =
  'indexConfig.usesAncestorConfig=false OR ttlConfig:*'

function collectionGroupsBase({ projectId, databaseId }) {
  return (
    `${firestoreAdminApiBase()}/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/collectionGroups/-`
  )
}

/** GET a JSON page; throw a descriptive error on any non-2xx. */
async function fetchJson(url, token) {
  let response
  try {
    response = await fetch(url, { headers: authHeaders(token) })
  } catch (error) {
    throw new Error(`Network error fetching ${url}: ${error.message}`)
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${url}: ${body.slice(0, 300)}`,
    )
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${body.slice(0, 300)}`)
  }
}

/**
 * Follow `nextPageToken` to exhaustion. No `pageSize` is ever sent (trap 1),
 * and a page cap guards against a server that keeps handing back the same
 * token — an infinite loop here would look like a hung check, which reads as
 * "still running" rather than "broken".
 */
async function listAll({ url, token, collect }) {
  const out = []
  let pageToken
  for (let page = 0; page < 100; page += 1) {
    const paged = pageToken
      ? `${url}${url.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(pageToken)}`
      : url
    const body = await fetchJson(paged, token)
    out.push(...collect(body))
    if (!body.nextPageToken || body.nextPageToken === pageToken) return out
    pageToken = body.nextPageToken
  }
  throw new Error(`Pagination did not terminate after 100 pages for ${url}`)
}

/** Every composite index in the project, all collection groups. */
export async function fetchLiveCompositeIndexes({
  token,
  projectId,
  databaseId = resolveDatabaseId(),
}) {
  return listAll({
    url: `${collectionGroupsBase({ projectId, databaseId })}/indexes`,
    token,
    collect: (body) => body.indexes ?? [],
  })
}

/** Every explicitly-configured field (index override and/or TTL policy). */
export async function fetchLiveFieldOverrides({
  token,
  projectId,
  databaseId = resolveDatabaseId(),
}) {
  const base = collectionGroupsBase({ projectId, databaseId })
  return listAll({
    url: `${base}/fields?filter=${encodeURIComponent(FIELD_OVERRIDE_FILTER)}`,
    token,
    collect: (body) => body.fields ?? [],
  })
}

/**
 * Mint the read token, or return the reason it could not be minted. Never
 * throws: the caller turns a missing credential into a cannot-check exit,
 * which must never be confused with a clean one.
 */
export async function resolveReadToken() {
  const override = process.env.INDEX_CHECK_ACCESS_TOKEN
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) return { error: 'FIREBASE_PROJECT_ID is not set.' }
  if (override) return { token: override, projectId }
  const serviceAccount = readServiceAccount()
  if (!serviceAccount) {
    return {
      error:
        'FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set (and no INDEX_CHECK_ACCESS_TOKEN).',
    }
  }
  try {
    return { token: await getServiceAccountToken(serviceAccount), projectId }
  } catch (error) {
    return { error: `minting an access token failed: ${error.message}` }
  }
}
