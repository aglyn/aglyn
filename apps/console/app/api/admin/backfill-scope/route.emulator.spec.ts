/**
 * @jest-environment node
 */

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
 * Emulator integration for the AGL-1040 backfill: drives the REAL route
 * handler against a REAL Firestore, with a REAL token minted by the Auth
 * emulator — no mocks on the code under test.
 *
 * Skipped unless both emulator hosts are set, so a normal `jest` run is
 * unaffected and this can never reach production. Start the emulators and
 * seed first (docs/E2E_LOCAL.md), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns route.emulator
 *
 * Next's HTTP layer is deliberately not in the loop: it is not what is
 * under test, and a second dev server needs a second checkout because nx
 * serializes the `serve` target per workspace root.
 */

import { request as httpRequest } from 'node:http'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED =
  Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)

const ORG = 'scope-agency-jest'
const STAFF_UID = 'scope-jest-staff'
const STAFF_EMAIL = 'scope-jest-staff@aglyn.test'

// Initialised WITHOUT a credential; with FIRESTORE_EMULATOR_HOST set the
// Admin SDK talks only to the local emulator. Done before the route is
// imported so its module-scope init finds an existing default app rather
// than reaching for the root .env's production key.
if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('backfill-scope route (emulator)', () => {
  let db: Firestore
  let handler: (request: Request) => Promise<Response>
  let token: string

  beforeAll(async () => {
    db = getFirestore()
    const auth = getAuth()
    try {
      await auth.getUser(STAFF_UID)
    } catch {
      await auth.createUser({
        uid: STAFF_UID,
        email: STAFF_EMAIL,
        password: 'E2e-Password-1',
        emailVerified: true,
      })
    }
    await auth.setCustomUserClaims(STAFF_UID, { staff: true })
    token = await mintIdToken()
    await seed(db)
    handler = (await import('./route')).POST as typeof handler
  }, 60_000)

  it('dry run plans writes but changes nothing', async () => {
    const before = await readScopes(db)
    const body = await call(handler, token, { dryRun: true })
    expect(body.dryRun).toBe(true)
    expect(body.planned).toBeGreaterThan(0)
    expect(await readScopes(db)).toEqual(before)
  }, 60_000)

  it('stamps what is missing and leaves the rest alone', async () => {
    await call(handler, token, { dryRun: false })
    const scopes = await readScopes(db)
    expect(scopes.datasets['ds-unscoped']).toEqual(['org'])
    // Already scoped to one host — must survive untouched.
    expect(scopes.datasets['ds-preset']).toEqual(['host:h1'])
    // "Visible to nobody" — must NOT be widened to org.
    expect(scopes.datasets['ds-empty']).toEqual([])
    expect(scopes.media['m-unscoped']).toEqual(['org'])
    expect(scopes.folders['f-unscoped']).toEqual(['org'])
  }, 60_000)

  it('projects member scope tokens, including the legacy shape', async () => {
    const scopes = await readScopes(db)
    expect(scopes.members['owner']).toEqual(['org'])
    expect(scopes.members['collab']).toEqual(['org', 'host:h1'])
    // Neither allHosts nor hostAccess: pre-flag membership stays org-wide.
    expect(scopes.members['legacy']).toEqual(['org'])
  }, 60_000)

  it('is idempotent — a second pass plans zero writes', async () => {
    const second = await call(handler, token, { dryRun: true })
    expect(second.planned).toBe(0)
    expect(second.nextAfterOrg).toBeNull()
  }, 60_000)
})

/**
 * Signs in through the Auth emulator's REST endpoint. Uses `node:http`
 * rather than `fetch`: the jest environment's fetch polyfill is not a
 * usable client here, and this call is plain local HTTP.
 */
async function mintIdToken(): Promise<string> {
  const [hostname, port] = String(
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ).split(':')
  const payload = JSON.stringify({
    email: STAFF_EMAIL,
    password: 'E2e-Password-1',
    returnSecureToken: true,
  })
  const body = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname,
        port: Number(port),
        path:
          '/identitytoolkit.googleapis.com/v1/' +
          'accounts:signInWithPassword?key=fake',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let chunks = ''
        response.on('data', (chunk) => (chunks += chunk))
        response.on('end', () => resolve(chunks))
      },
    )
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
  const data = JSON.parse(body) as { idToken?: string }
  if (!data.idToken) throw new Error(`Auth emulator sign-in failed: ${body}`)
  return data.idToken
}

async function call(
  handler: (request: Request) => Promise<Response>,
  token: string,
  body: { dryRun: boolean },
) {
  const response = await handler(
    new Request('http://localhost/api/admin/backfill-scope', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
  const json = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json)}`)
  return json as {
    dryRun: boolean
    planned: number
    nextAfterOrg: string | null
    totals: Record<string, unknown>
  }
}

/** Deterministic ids + merge writes, so a re-run reseeds the same shape. */
async function seed(db: Firestore): Promise<void> {
  const orgRef = db.collection('orgs').doc(ORG)
  await orgRef.set({ name: 'Scope Jest', hosts: { h1: true, h2: true } })
  await orgRef.collection('members').doc('owner').set({ role: 'owner', allHosts: true })
  await orgRef
    .collection('members')
    .doc('collab')
    .set({ role: 'viewer', allHosts: false, hostAccess: { h1: 'editor' } })
  await orgRef.collection('members').doc('legacy').set({ role: 'editor' })
  await orgRef.collection('datasets').doc('ds-unscoped').set({ displayName: 'A' })
  await orgRef
    .collection('datasets')
    .doc('ds-preset')
    .set({ displayName: 'B', visibleTo: ['host:h1'] })
  await orgRef
    .collection('datasets')
    .doc('ds-empty')
    .set({ displayName: 'C', visibleTo: [] })
  await orgRef.collection('media').doc('m-unscoped').set({ fileName: 'a.png' })
  await orgRef.collection('mediaFolders').doc('f-unscoped').set({ name: 'F' })
}

async function readScopes(db: Firestore) {
  const orgRef = db.collection('orgs').doc(ORG)
  const [datasets, media, folders, members] = await Promise.all([
    orgRef.collection('datasets').get(),
    orgRef.collection('media').get(),
    orgRef.collection('mediaFolders').get(),
    orgRef.collection('members').get(),
  ])
  const scopeOf = (snap: FirebaseFirestore.QuerySnapshot) =>
    Object.fromEntries(
      snap.docs.map((doc) => [doc.id, doc.data()['visibleTo'] ?? null]),
    )
  return {
    datasets: scopeOf(datasets),
    media: scopeOf(media),
    folders: scopeOf(folders),
    members: Object.fromEntries(
      members.docs.map((doc) => [doc.id, doc.data()['scopeTokens'] ?? null]),
    ),
  }
}
