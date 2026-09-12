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
 * START A WORKFLOW WITHOUT A CREDENTIAL THAT EXPIRES (AGL-2758)
 *
 * Cloud Scheduler used to dispatch the signup canary with a fine-grained PAT
 * held in the job's own headers. That token expires, and the `aglyn`
 * organization forbids the obvious fix: its policy is "fine-grained personal
 * access tokens must expire", capped at 366 days, so no PAT here can outlive a
 * year. Lifting that policy is org-wide and would let any member mint a
 * permanent token against any resource, which is a far worse trade than the
 * rotation it avoids.
 *
 * A GitHub App is not subject to that policy. Its private key does not expire,
 * and the tokens minted FROM it live one hour — so the thing that crosses the
 * network hourly is short-lived even though the root secret is permanent.
 *
 * ## Zero dependencies, on purpose
 *
 * Node signs RS256 and speaks HTTP on its own, so this container installs
 * nothing. No dependency means no supply chain and no install step on a job
 * whose whole purpose is to hold a key: the less code sits next to the key,
 * the better.
 *
 * ## What it never does
 *
 * The JWT, the installation token and the key are never logged, never printed
 * on failure, and never returned. A dispatch either succeeds or reports the
 * status code and GitHub's own message, which never contains the credential.
 */

import { createSign } from 'node:crypto'

const APP_ID = process.env.GITHUB_APP_ID
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY
const REPO = process.env.GITHUB_REPOSITORY ?? 'aglyn/aglyn'
const WORKFLOW = process.env.GITHUB_WORKFLOW_FILE
const REF = process.env.GITHUB_WORKFLOW_REF ?? 'main'

const API = 'https://api.github.com'
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  // GitHub rejects an API request with no User-Agent.
  'User-Agent': 'aglyn-scheduler-dispatch',
}

const b64url = (value) => Buffer.from(value).toString('base64url')

/**
 * A ten-minute app JWT.
 *
 * `iat` is backdated a minute because GitHub rejects a token whose issue time
 * is in ITS future, and a small clock skew between here and GitHub is normal.
 * Ten minutes is the documented ceiling; this is used once, immediately.
 */
function appJwt() {
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID }),
  )
  const signature = createSign('RSA-SHA256')
    .update(`${head}.${body}`)
    .sign(PRIVATE_KEY, 'base64url')
  return `${head}.${body}.${signature}`
}

async function installationToken() {
  const response = await fetch(
    `${API}/app/installations/${INSTALLATION_ID}/access_tokens`,
    { method: 'POST', headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` } },
  )
  if (!response.ok) {
    // The body carries GitHub's reason ("Integration not found", a bad key,
    // a suspended installation) and never the credential.
    throw new Error(
      `minting an installation token failed: ${response.status} ${await response.text()}`,
    )
  }
  const { token, expires_at: expiresAt } = await response.json()
  if (!token) throw new Error('GitHub returned no token')
  console.log(`minted an installation token, valid until ${expiresAt}`)
  return token
}

async function dispatch(token) {
  const response = await fetch(
    `${API}/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ref: REF }),
    },
  )
  // 204 with an empty body is the success shape; anything else is a failure
  // worth the status, because a dispatch that silently does nothing is the
  // exact condition this whole arc exists to stop.
  if (response.status !== 204) {
    throw new Error(
      `dispatching ${WORKFLOW} failed: ${response.status} ${await response.text()}`,
    )
  }
  console.log(`dispatched ${WORKFLOW} on ${REPO}@${REF}`)
}

async function main() {
  const missing = Object.entries({
    GITHUB_APP_ID: APP_ID,
    GITHUB_APP_INSTALLATION_ID: INSTALLATION_ID,
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
    GITHUB_WORKFLOW_FILE: WORKFLOW,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`not configured: ${missing.join(', ')}`)
  }
  await dispatch(await installationToken())
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exitCode = 1
})
