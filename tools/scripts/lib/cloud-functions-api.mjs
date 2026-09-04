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
 * Read access to the deployed Cloud Functions of `aglyn-main` (AGL-2580).
 *
 * The rules/index counterpart of this module is lib/firebase-rules-api.mjs,
 * and it is deliberately NOT an extension of it, because the credential is
 * different — see below.
 *
 * ⚠️ CREDENTIALS: ADC, NOT THE FIREBASE SERVICE ACCOUNT.
 *
 * Every other drift checker in this repo authenticates as the service account
 * in the root `.env` (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY), and
 * copying that here is the first thing anyone will try. It does not work:
 * that principal has no `cloudfunctions.functions.list`, so the call comes
 * back `403 PERMISSION_DENIED` rather than empty — which at least fails
 * loudly, but fails every time. Use Application Default Credentials instead:
 *
 *   FUNCTIONS_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token) \
 *     npm run check:functions-drift
 *
 * `resolveFunctionsToken()` below will also shell out to `gcloud` on its own
 * when it is on PATH, so an operator with a live gcloud session needs no
 * variable at all. In CI there is no gcloud, so one of the explicit paths has
 * to be configured — the checker's cannot-check message names them, and the
 * cheapest is to grant the EXISTING service account `roles/cloudfunctions.viewer`,
 * which needs no new secret.
 *
 * ⚠️ REGIONS: FUNCTIONS DO NOT ALL LIVE IN ONE. `consoleFastCrons` and its
 * seven siblings are in `us-central1`; `beforeSignupCreate` — a blocking auth
 * trigger — is in `us-east1`, because Identity Platform blocking functions are
 * pinned to the region Firebase Auth runs in. A checker that hardcoded
 * `us-central1` would report a clean sweep while never once looking at the
 * function that guards signups. `locations/-` asks the API to aggregate across
 * every region, and the `unreachable` list it returns names the regions it
 * could not answer for — which is a cannot-check, never a clean one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { getServiceAccountToken, readServiceAccount } from './firebase-rules-api.mjs'

/**
 * The Cloud Functions API origin. Overridable via CLOUD_FUNCTIONS_API_BASE so
 * the drift checker's tests can point the whole fetch pipeline at a local stub
 * and feed it a doctored deployment.
 */
export function cloudFunctionsApiBase() {
  return (
    process.env.CLOUD_FUNCTIONS_API_BASE ||
    'https://cloudfunctions.googleapis.com'
  ).replace(/\/+$/, '')
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

/** GET a JSON page; throw a descriptive error on any non-2xx. */
async function fetchJson(url, token) {
  let response
  try {
    response = await fetch(url, { headers: authHeaders(token) })
  } catch (error) {
    throw new Error(`Network error fetching ${url}: ${error.message}`, {
      cause: error,
    })
  }
  const body = await response.text()
  if (!response.ok) {
    const hint =
      response.status === 403
        ? ' — 403 on functions.list usually means the credential is the Firebase service account, which does not carry cloudfunctions.functions.list. Use ADC.'
        : ''
    throw new Error(
      `HTTP ${response.status} from ${url}: ${body.slice(0, 300)}${hint}`,
    )
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${body.slice(0, 300)}`)
  }
}

/**
 * Every deployed function in the project, across every region.
 *
 * Returns `{ functions, unreachable }`. `unreachable` is the API's own list of
 * regions it could not answer for, passed through rather than swallowed: a
 * region that did not answer holds functions whose age is unknown, and
 * "unknown" must never render as "current".
 */
export async function fetchDeployedFunctions({ token, projectId }) {
  const url =
    `${cloudFunctionsApiBase()}/v2/projects/${encodeURIComponent(projectId)}` +
    `/locations/-/functions`
  const functions = []
  const unreachable = new Set()
  let pageToken
  for (let page = 0; page < 100; page += 1) {
    const paged = pageToken
      ? `${url}?pageToken=${encodeURIComponent(pageToken)}`
      : url
    const body = await fetchJson(paged, token)
    functions.push(...(body.functions ?? []))
    for (const location of body.unreachable ?? []) unreachable.add(location)
    if (!body.nextPageToken || body.nextPageToken === pageToken) {
      return { functions, unreachable: [...unreachable].sort() }
    }
    pageToken = body.nextPageToken
  }
  throw new Error(`Pagination did not terminate after 100 pages for ${url}`)
}

/**
 * Ask `gcloud` for an ADC access token.
 *
 * Shelling out rather than importing google-auth-library keeps this check's
 * dependency surface at zero and matches how an operator reaches this API by
 * hand. Returns null — never throws — when gcloud is absent or its session has
 * expired, so the caller can move on to the next credential and end at a
 * cannot-check that names all of them.
 */
function gcloudAccessToken() {
  for (const args of [
    ['auth', 'print-access-token'],
    ['auth', 'application-default', 'print-access-token'],
  ]) {
    try {
      const token = execFileSync('gcloud', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
      }).trim()
      if (token) return token
    } catch {
      continue
    }
  }
  return null
}

/** Read a service-account JSON key from a file path, or null. */
function serviceAccountFromKeyFile(path) {
  if (!path || !existsSync(path)) return null
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'))
    if (!json.client_email || !json.private_key) return null
    return {
      projectId: json.project_id,
      clientEmail: json.client_email,
      privateKey: json.private_key,
    }
  } catch {
    return null
  }
}

/**
 * Mint a read token for the Cloud Functions API, or return the reason it could
 * not be minted. Never throws: the caller turns a missing credential into a
 * cannot-check exit, which must never be confused with a clean one.
 *
 * The order runs from most explicit to most ambient, so a configured
 * credential always beats whatever session happens to be lying around:
 *
 *   1. FUNCTIONS_CHECK_ACCESS_TOKEN   — a bearer token, however obtained
 *   2. GOOGLE_APPLICATION_CREDENTIALS — a service-account key file
 *   3. gcloud                         — the operator's own ADC session
 *   4. FIREBASE_CLIENT_EMAIL/_KEY     — the rules service account, which
 *      works only once it has been granted `roles/cloudfunctions.viewer`;
 *      attempted last so that a 403 is reported instead of a silent skip.
 */
export async function resolveFunctionsToken() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) return { error: 'FIREBASE_PROJECT_ID is not set.' }

  const override = process.env.FUNCTIONS_CHECK_ACCESS_TOKEN
  if (override) return { token: override, projectId, source: 'FUNCTIONS_CHECK_ACCESS_TOKEN' }

  const keyFile = serviceAccountFromKeyFile(
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  )
  if (keyFile) {
    try {
      return {
        token: await getServiceAccountToken({ ...keyFile, projectId }),
        projectId,
        source: 'GOOGLE_APPLICATION_CREDENTIALS',
      }
    } catch (error) {
      return { error: `minting a token from GOOGLE_APPLICATION_CREDENTIALS failed: ${error.message}` }
    }
  }

  const fromGcloud = gcloudAccessToken()
  if (fromGcloud) return { token: fromGcloud, projectId, source: 'gcloud ADC' }

  const serviceAccount = readServiceAccount()
  if (serviceAccount) {
    try {
      return {
        token: await getServiceAccountToken(serviceAccount),
        projectId,
        source: 'FIREBASE_CLIENT_EMAIL service account',
      }
    } catch (error) {
      return { error: `minting a service-account token failed: ${error.message}` }
    }
  }

  return {
    error:
      'no Cloud Functions credential is available (FUNCTIONS_CHECK_ACCESS_TOKEN, ' +
      'GOOGLE_APPLICATION_CREDENTIALS, a gcloud session, or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY).',
  }
}
