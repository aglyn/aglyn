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
// The presence token broker (AGL-675) against the emulators.
//
// This route IS the authorization boundary for RTDB presence — the rules
// only check a claim, and this decides who gets one. So the checks here
// are about who is refused, not who succeeds.
//
// Setup as in docs/E2E_LOCAL.md, then: npm run e2e:presence-token

import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8082'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'

if (!getApps().length) initializeApp({ projectId: 'aglyn-main' })
const db = getFirestore()

const tokens = new Map()
async function idToken(uid) {
  if (tokens.has(uid)) return tokens.get(uid)
  const customToken = await getAuth().createCustomToken(uid)
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  const payload = await response.json()
  if (!payload.idToken) throw new Error(`token exchange failed for ${uid}`)
  tokens.set(uid, payload.idToken)
  return payload.idToken
}

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function mint(uid, body, withAuth = true) {
  const response = await fetch(`${BASE_URL}/api/presence/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(withAuth ? { Authorization: `Bearer ${await idToken(uid)}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

/** Decode a JWT payload without verifying — we only need the claims. */
function claims(jwt) {
  const [, payload] = String(jwt).split('.')
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
}

const MEMBER = 'e2e-owner' // member of the seeded org that owns `demo`
const OUTSIDER = 'e2e-nonstaff-owner' // owns a DIFFERENT org

const unauth = await mint(MEMBER, { hostId: 'demo' }, false)
check('refuses an unauthenticated caller', unauth.status === 401, `${unauth.status}`)

const noHost = await mint(MEMBER, {})
check('refuses a missing hostId', noHost.status === 400, `${noHost.status}`)

const unknown = await mint(MEMBER, { hostId: 'does-not-exist' })
check('refuses an unknown site', unknown.status === 404, `${unknown.status}`)

// The one that matters: membership is proven against the HOST's org, so a
// caller cannot mint a token for an org they merely name.
const outsider = await mint(OUTSIDER, { hostId: 'demo' })
check(
  'refuses a non-member of the site’s org',
  outsider.status === 403,
  `${outsider.status} ${outsider.body.error ?? ''}`,
)

const ok = await mint(MEMBER, { hostId: 'demo' })
check('mints for a member', ok.status === 200, `${ok.status}`)
if (ok.status === 200) {
  const parsed = claims(ok.body.token)
  const hostOrg = (await db.collection('hosts').doc('demo').get()).get('orgId')
  check(
    'token is scoped to the site’s own org',
    parsed.claims?.presenceOrg === hostOrg,
    `claim=${parsed.claims?.presenceOrg} host=${hostOrg}`,
  )
  check('token is issued for the caller', parsed.uid === MEMBER, `${parsed.uid}`)
  // A membership map would drift toward the 1000-byte claim ceiling; one
  // org per token keeps it a single string.
  check(
    'carries exactly one scoping claim',
    Object.keys(parsed.claims ?? {}).length === 1,
    JSON.stringify(parsed.claims),
  )
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
