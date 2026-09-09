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
 * ARE PAGE ROUTES THROWING? — read the drain, split by route (AGL-2709).
 *
 *   node tools/scripts/check-render-errors.mjs                 # last 60 min
 *   node tools/scripts/check-render-errors.mjs --minutes 30
 *   node tools/scripts/check-render-errors.mjs \
 *     --since 2026-09-09T04:00:00Z --until 2026-09-09T04:15:00Z
 *
 * Exit 0 when no page route 5xx'd in the window, 1 when one did, 2 when the
 * question could not be asked. The third code is the point: a check that
 * cannot read its source must not report calm, which is the same rule
 * `serverErrorsHealth` applies to a failed Firestore query.
 *
 * ## What this answers that a page fetch cannot
 *
 * `front-door/*` asks whether a visitor gets a page. It gets a 200 from the
 * ISR entry while every regeneration underneath it throws, so a green row is
 * not evidence the render works — the row now says so in those words. This is
 * the other half: the 5xx the render produced, named by route pattern, out of
 * the Vercel log drain, which sees a platform 500 whether or not our own
 * `onRequestError` hook ever ran.
 *
 * ## ⚠️ CREDENTIALS — this cannot run unattended today, and that is the honest
 * state
 *
 * The repo's own service account is **refused**: `entries:list` on
 * `projects/aglyn-main` answers `403 Permission denied for all log views`
 * (measured 2026-08-24 for `server-errors`, re-measured 2026-09-09 for
 * `vercel-runtime`). So no workflow can run this until somebody grants the
 * account a log-view role. `docs/UPTIME_AND_SLA.md` carries the exact command;
 * nothing in this repository has applied it.
 *
 * Three credential sources, in order, so the day that grant lands nothing here
 * has to change:
 *
 *  1. `GOOGLE_ACCESS_TOKEN` — an already-minted token. The CI shape.
 *  2. `FIREBASE_PROJECT_ID`/`CLIENT_EMAIL`/`PRIVATE_KEY` — the service
 *     account, JWT-bearer for the `logging.read` scope, exactly as
 *     `check-funnel-conversions.mjs` mints for GA4. Refused today; the refusal
 *     is reported as the missing grant it is, not as a stack.
 *  3. Application Default Credentials — a person's own `gcloud auth
 *     application-default login`, which is what makes this usable during an
 *     incident right now. `x-goog-user-project` is sent with it or the quota
 *     bills to a shared OAuth client and the call 429s for reasons that have
 *     nothing to do with the query.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  gradeRenderErrors,
  renderErrorLines,
  renderErrorsFilter,
} from './lib/render-errors.mjs'

const TIMEOUT_MS = 20_000
const PROJECT = process.env.AGLYN_LOG_PROJECT || 'aglyn-main'
const LOGGING_SCOPE = 'https://www.googleapis.com/auth/logging.read'
/** One page is plenty: a window with more than this is already past every
 * threshold that reads it, and the count is then a floor. */
const PAGE_SIZE = 500

const argv = process.argv.slice(2)
const flag = (name) => {
  const at = argv.indexOf(`--${name}`)
  if (at !== -1) return argv[at + 1] ?? null
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : null
}

const minutes = Number.parseInt(flag('minutes') ?? '60', 10)
const until = flag('until')
const since =
  flag('since') ??
  new Date(
    (until ? Date.parse(until) : Date.now()) - minutes * 60_000,
  ).toISOString()
const tolerated = Number.parseInt(flag('tolerated') ?? '0', 10)

const say = (message) => process.stderr.write(`render-errors: ${message}\n`)

/** A JWT-bearer token for one scope. Same shape as the GA4 alarm's. */
async function serviceAccountToken() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) return null
  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({
    iss: clientEmail,
    scope: LOGGING_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  signer.end()
  const jwt = `${header}.${claim}.${signer.sign(privateKey).toString('base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = await response.json().catch(() => ({}))
  return payload.access_token ?? null
}

/**
 * A token from the operator's own ADC file.
 *
 * The refresh grant is exchanged directly rather than shelling out to
 * `gcloud auth print-access-token`, which prompts for a browser and therefore
 * fails from any non-interactive session — the reason this path exists at all.
 */
async function adcToken() {
  let stored
  try {
    stored = JSON.parse(
      readFileSync(
        join(homedir(), '.config/gcloud/application_default_credentials.json'),
        'utf8',
      ),
    )
  } catch {
    return null
  }
  if (!stored?.refresh_token) return null
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: stored.client_id,
      client_secret: stored.client_secret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = await response.json().catch(() => ({}))
  return payload.access_token ?? null
}

async function accessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN)
    return {
      token: process.env.GOOGLE_ACCESS_TOKEN,
      source: 'GOOGLE_ACCESS_TOKEN',
    }
  const sa = await serviceAccountToken()
  if (sa) return { token: sa, source: 'service account' }
  const adc = await adcToken()
  if (adc) return { token: adc, source: 'application default credentials' }
  return { token: null, source: null }
}

/**
 * One page, deliberately.
 *
 * A window louder than `PAGE_SIZE` is already an incident, and the count is
 * then a floor that is past every threshold reading it. Paging further spends
 * quota to sharpen a number nobody is waiting on.
 */
async function listEntries(token) {
  const response = await fetch(
    'https://logging.googleapis.com/v2/entries:list',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // Or the quota bills to a shared OAuth client and the call 429s for
        // reasons that have nothing to do with this query.
        'x-goog-user-project': PROJECT,
      },
      body: JSON.stringify({
        resourceNames: [`projects/${PROJECT}`],
        filter: renderErrorsFilter({
          project: PROJECT,
          sinceIso: since,
          untilIso: until,
        }),
        orderBy: 'timestamp desc',
        pageSize: PAGE_SIZE,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  if (!response.ok) {
    const body = await response.text()
    if (response.status === 403 && /log views/i.test(body)) {
      throw new Error(
        'the credential is refused entries:list on this project ' +
          '("Permission denied for all log views"). It needs a log-view ' +
          'role — see docs/UPTIME_AND_SLA.md, "Reading the drain".',
      )
    }
    throw new Error(
      `entries:list HTTP ${response.status}: ${body.slice(0, 300)}`,
    )
  }
  const payload = await response.json()
  return payload.entries ?? []
}

const { token, source } = await accessToken()
if (!token) {
  say(
    'no credential. Set GOOGLE_ACCESS_TOKEN, or FIREBASE_PROJECT_ID/' +
      'FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or run ' +
      '`gcloud auth application-default login`.',
  )
  process.exit(2)
}

let entries
try {
  entries = await listEntries(token)
} catch (error) {
  // ⚠️ EXIT 2, NEVER 0. "We could not count the errors" and "there were no
  // errors" are the same output if this reports clean, and the first is most
  // likely exactly when the second is false.
  say(`could not read the drain via ${source}: ${error?.message ?? error}`)
  process.exit(2)
}

const verdict = gradeRenderErrors(entries, { tolerated })
for (const line of renderErrorLines(verdict, { since, until }))
  console.log(line)
console.log(`  read ${entries.length} drained 5xx via ${source}`)
process.exit(verdict.ok ? 0 : 1)
