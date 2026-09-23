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
 * Where an account came from, written beside its writer (AGL-3289): the REAL
 * `recordAccountAcquisition` and the REAL `createOrganization` against a REAL
 * Firestore. No mocks on the code under test.
 *
 * What it holds: the record is written once and never restated; an account
 * older than the creation window is not written at all; and a workspace is
 * born carrying its creator's record — or, when the creator has none, an
 * unknown one that still names whose it is, so its card is never blank.
 *
 * The route's half — the verified token, the door, the cookie fallback, the
 * invitation — is `apps/console/app/api/auth/acquisition/route.emulator.spec.ts`.
 *
 * Skipped unless `FIRESTORE_EMULATOR_HOST` is set, so an ordinary `jest` run is
 * unaffected and this can never reach production. Main Gate does not run
 * `*.emulator.spec.ts`; `npm run test:emulator-guards` does.
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

// Before the modules under test load, so the Admin SDK they reach finds this
// app and talks only to the emulator.
if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip
const RUN = Date.now().toString(36)

const touch = () => ({
  v: 1,
  at: Date.now() - 5 * 60_000,
  host: 'example.com',
  path: '/pricing',
  ref: 'www.g2.com',
})

describeEmulated('account acquisition, beside its writer (emulator)', () => {
  let db: Firestore
  let acquisition: typeof import('./account-acquisition')
  let organizations: typeof import('./organizations')

  beforeAll(async () => {
    db = getFirestore()
    acquisition = await import('./account-acquisition')
    organizations = await import('./organizations')
  }, 60_000)

  const record = (uid: string, overrides: Record<string, unknown> = {}) =>
    acquisition.recordAccountAcquisition({
      uid,
      accountCreatedAtMs: Date.now() - 60_000,
      touch: touch(),
      door: 'signup-password',
      provider: 'password',
      email: null,
      headers: new Headers({ 'x-vercel-ip-country': 'AU' }),
      recordedBy: 'signup',
      ...overrides,
    })

  const stored = async (path: string) => (await db.doc(path).get()).get('acquisition')

  it('writes once, and a second call restates nothing', async () => {
    const uid = `acq-once-${RUN}`
    expect((await record(uid)).status).toBe('recorded')
    const first = await stored(`users/${uid}`)
    expect(first).toMatchObject({ source: 'g2.com', channel: 'referral', geo: { country: 'AU' } })
    const again = await record(uid, { touch: { ...touch(), ref: 'www.google.com' } })
    expect(again.status).toBe('exists')
    expect(await stored(`users/${uid}`)).toEqual(first)
  }, 60_000)

  it('writes nothing for an account older than the creation window', async () => {
    const uid = `acq-old-${RUN}`
    const result = await record(uid, { accountCreatedAtMs: Date.now() - 2 * 60 * 60_000 })
    expect(result).toEqual({ status: 'not-new' })
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false)
  }, 60_000)

  it('a workspace is born carrying its creator’s record', async () => {
    const uid = `acq-creator-${RUN}`
    await record(uid)
    const orgId = await organizations.createOrganization({
      name: 'Review',
      slug: `acq-review-${RUN}`,
      ownerUid: uid,
      bypassFreeWorkspaceCap: true,
    })
    expect(await stored(`orgs/${orgId}`)).toEqual({ ...(await stored(`users/${uid}`)), copiedFromUid: uid })
  }, 60_000)

  it('names the creator even when the creator has no record', async () => {
    const uid = `acq-bare-${RUN}`
    const orgId = await organizations.createOrganization({
      name: 'Bare',
      slug: `acq-bare-${RUN}`,
      ownerUid: uid,
      bypassFreeWorkspaceCap: true,
    })
    expect(await stored(`orgs/${orgId}`)).toMatchObject({
      source: 'unknown',
      channel: 'unknown',
      recordedBy: 'org-creation',
      copiedFromUid: uid,
    })
  }, 60_000)
})
