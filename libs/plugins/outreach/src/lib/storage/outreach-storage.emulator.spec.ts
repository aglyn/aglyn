/**
 * @jest-environment node
 *
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
 * The compliance settings and the do-not-contact list against a real
 * Firestore (AGL-2980).
 *
 * The unit specs hold the shapes; what an in-memory store cannot show is
 * the database's own semantics, and both stores lean on one:
 *
 * - an address added to the do-not-contact list twice at once is ONE entry,
 *   the first — `create()`'s refusal of an existing document, not a map's;
 * - a lookup of many addresses is one `getAll`, answered per address;
 * - two members saving the settings at once each compare against the
 *   other's write, so exactly one save of the same values is a change.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start an emulator on ports
 * of your own and point this at it:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> \
 *     npx jest -c libs/plugins/outreach/jest.config.ts \
 *       --testPathPatterns outreach-storage.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import {
  outreachComplianceSettingsRef,
  readOutreachComplianceSettingsDoc,
  writeOutreachComplianceSettings,
} from './compliance-settings-store'
import {
  addOutreachDoNotContact,
  lookupOutreachDoNotContact,
  outreachDoNotContactCollection,
} from './do-not-contact-store'

const EMULATED = Boolean(process.env['FIRESTORE_EMULATOR_HOST'])
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })
const describeEmulated = EMULATED ? describe : describe.skip

const ORG = 'e2e-outreach-storage-org'
const AT = 1_750_000_000_000

let firestore: Firestore

beforeAll(() => {
  if (EMULATED) firestore = getFirestore()
})

afterAll(async () => {
  if (!EMULATED) return
  // Only what this spec wrote: the emulator may be shared with a dev server.
  await firestore.recursiveDelete(firestore.collection('orgs').doc(ORG))
})

describeEmulated('the do-not-contact list on Firestore (AGL-2980)', () => {
  it('keeps exactly one entry, the first, when the same address is added twice at once', async () => {
    const email = 'casey.morgan@example.com'
    const results = await Promise.all([
      addOutreachDoNotContact(firestore, {
        orgId: ORG,
        email,
        reason: 'manual',
        source: 'member',
        addedByUid: 'uid-rep',
        nowMs: AT,
      }),
      addOutreachDoNotContact(firestore, {
        orgId: ORG,
        email: 'Casey.Morgan@Example.com',
        reason: 'unsubscribe',
        source: 'runtime',
        nowMs: AT + 1,
      }),
    ])
    expect(results.filter((result) => result.created)).toHaveLength(1)
    const winner = results.find((result) => result.created)?.entry
    expect(results.find((result) => !result.created)?.entry).toEqual(winner)
    const stored = await outreachDoNotContactCollection(firestore, ORG)
      .doc(String(outreachDoNotContactKey(email)))
      .get()
    expect(stored.data()).toEqual(winner)
  })

  it('answers many addresses in one lookup', async () => {
    await addOutreachDoNotContact(firestore, {
      orgId: ORG,
      email: 'avery.quinn@example.org',
      reason: 'hard_bounce',
      source: 'runtime',
      nowMs: AT,
    })
    const answers = await lookupOutreachDoNotContact(firestore, ORG, [
      'avery.quinn@example.org',
      'jordan.lee@example.net',
      'casey.morgan@example.com',
    ])
    expect(Object.fromEntries(answers)).toEqual({
      'avery.quinn@example.org': true,
      'jordan.lee@example.net': false,
      'casey.morgan@example.com': true,
    })
  })
})

describeEmulated('the compliance settings on Firestore (AGL-2980)', () => {
  const settings = {
    legalName: 'Example Co LLC',
    brandName: 'Example Co',
    postalAddress: '100 Example St\nSpringfield, IL 62701',
    allowedCountries: ['US'],
  }

  it('reads the defaults before the first save', async () => {
    await outreachComplianceSettingsRef(firestore, ORG).delete()
    expect(await readOutreachComplianceSettingsDoc(firestore, ORG)).toMatchObject({
      legalName: '',
      allowedCountries: ['US'],
      updatedAtMs: 0,
    })
  })

  it('counts exactly one of two simultaneous identical saves as a change', async () => {
    await outreachComplianceSettingsRef(firestore, ORG).delete()
    const results = await Promise.all([
      writeOutreachComplianceSettings(firestore, { orgId: ORG, settings, byUid: 'uid-a', nowMs: AT }),
      writeOutreachComplianceSettings(firestore, { orgId: ORG, settings, byUid: 'uid-b', nowMs: AT + 1 }),
    ])
    expect(results.filter((result) => result.changed)).toHaveLength(1)
    const stored = await readOutreachComplianceSettingsDoc(firestore, ORG)
    expect(stored).toMatchObject(settings)
    expect(['uid-a', 'uid-b']).toContain(stored.updatedByUid)
  })
})
