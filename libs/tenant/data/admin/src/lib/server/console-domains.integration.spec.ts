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
 * The console-domain uniqueness guard against a REAL Firestore transaction
 * (AGL-1373).
 *
 * The unit spec beside this one models transaction semantics — read versions,
 * abort on a moved read set — and a model is exactly as correct as its author
 * believed Firestore to be. This one runs the same claims through the actual
 * transaction machinery, where the retry, the read-set tracking and the
 * contention abort are Firestore's rather than mine.
 *
 * That distinction is the whole reason the file exists. AGL-743 was a
 * uniqueness check that read correct and lost the race anyway, and the design
 * says so directly: "Run against the Firestore emulator; a serial test does not
 * exercise the property."
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   npx jest --config libs/tenant/data/admin/jest.integration.config.ts
 */

import {
  claimConsoleDomain,
  ConsoleDomainTakenError,
  CONSOLE_DOMAINS_COLLECTION,
} from './console-domains'
import firebaseAdmin from './firebase-admin'

const ORG = 'zz-console-domain-org'
const RIVAL = 'zz-console-domain-rival'
const APEX = 'zz-console-fixture.example.com'
const PRIMARY = 'console.zz-console-fixture.test-domain.com'

const db = () => firebaseAdmin.app().firestore()

async function wipe(): Promise<void> {
  const names = [
    APEX,
    `www.${APEX}`,
    PRIMARY,
    'zz-console-apex.com',
    'www.zz-console-apex.com',
  ]
  await Promise.all(
    names.map((name) =>
      db()
        .collection(CONSOLE_DOMAINS_COLLECTION)
        .doc(name)
        .delete()
        .catch(() => undefined),
    ),
  )
}

beforeEach(wipe)
afterAll(wipe)

describe('claimConsoleDomain, on real Firestore', () => {
  it('lets exactly ONE of several concurrent claims win', async () => {
    // Eight simultaneous claims on the same name by eight different orgs.
    // Serially this proves nothing — the point is that all eight transaction
    // bodies start before any of them commits.
    const claimants = Array.from({ length: 8 }, (unused, index) => `${RIVAL}-${index}`)
    const outcomes = await Promise.allSettled(
      claimants.map((orgId) => claimConsoleDomain(orgId, PRIMARY)),
    )
    const won = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const lost = outcomes.filter((outcome) => outcome.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(7)
    for (const outcome of lost) {
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(
        ConsoleDomainTakenError,
      )
    }
    // And the survivor is the one the document actually names.
    const stored = await db()
      .collection(CONSOLE_DOMAINS_COLLECTION)
      .doc(PRIMARY)
      .get()
    expect(stored.get('orgId')).toBe(
      (won[0] as PromiseFulfilledResult<{ orgId: string }>).value.orgId,
    )
  })

  it('claims the twin atomically — no window where only the primary exists', async () => {
    await claimConsoleDomain(ORG, 'zz-console-apex.com')
    const [primary, twin] = await db().getAll(
      db().collection(CONSOLE_DOMAINS_COLLECTION).doc('zz-console-apex.com'),
      db().collection(CONSOLE_DOMAINS_COLLECTION).doc('www.zz-console-apex.com'),
    )
    expect(primary.get('orgId')).toBe(ORG)
    expect(twin.get('orgId')).toBe(ORG)
    expect(twin.get('primaryHost')).toBe('zz-console-apex.com')
    // Same commit, so the same write time — the property a follow-up write
    // for the twin would break (AGL-743).
    expect(twin.updateTime.isEqual(primary.updateTime)).toBe(true)
  })

  it('refuses when only the TWIN is held by another org, and writes nothing', async () => {
    await db()
      .collection(CONSOLE_DOMAINS_COLLECTION)
      .doc('www.zz-console-apex.com')
      .set({ orgId: RIVAL })

    await expect(claimConsoleDomain(ORG, 'zz-console-apex.com')).rejects.toBeInstanceOf(
      ConsoleDomainTakenError,
    )
    const primary = await db()
      .collection(CONSOLE_DOMAINS_COLLECTION)
      .doc('zz-console-apex.com')
      .get()
    // A partial claim is worse than no claim: it reserves a name against an
    // org that will never be able to attach it.
    expect(primary.exists).toBe(false)
  })

  it('is idempotent for the owner and keeps the published token', async () => {
    const first = await claimConsoleDomain(ORG, PRIMARY)
    const second = await claimConsoleDomain(ORG, PRIMARY)
    expect(second.token).toBe(first.token)
    expect(second.token).toHaveLength(48)
  })
})
