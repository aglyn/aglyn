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
 * The retained-refusal store's three server doors (AGL-3338), over a
 * Firestore that queries: the write a record's delete makes, the read the
 * list gate makes, and the consent group change's carry — held to the carry
 * rule every store is held to, that a second run writes nothing and a
 * resumed run ends where an uninterrupted one does.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { Timestamp } from 'firebase-admin/firestore'
import { planContactDetach } from '@aglyn/aglyn/app-utils/contacts'
import {
  carryRetainedRefusals,
  deleteWholeContact,
  readRetainedRefusals,
  type RemoveContactInput,
  removeContactKeepingRefusals,
  retainRefusals,
} from './retained-refusals'
import { queryFakeFirestore } from './test-firestore-queries'

const ORG = 'org-1'
const STORE = `orgs/${ORG}/retainedRefusals`
const PAT = 'pat@example.com'
const key = (email: string) => personKey(email) as string
const refused = (atMs: number) => ({ marketingConsent: false, marketingConsentAtMs: atMs })

describe('retainRefusals', () => {
  it('keeps each refusal under the address, stamped, and holds no address', async () => {
    const firestore = queryFakeFirestore()
    const written = await retainRefusals({
      orgRef: firestore.doc(`orgs/${ORG}`),
      email: 'Pat@Example.com',
      contactId: 'con_1',
      retained: { byHost: { 'site-a': refused(100) }, unscoped: false },
      nowMs: 5_000,
    })
    expect(written).toBe(1)
    const stored = firestore.read(`${STORE}/${key(PAT)}`)
    expect(stored).toEqual({
      marketingConsentByHost: {
        'site-a': { ...refused(100), retainedAtMs: 5_000, retainedFromContactId: 'con_1' },
      },
      retainedAtMs: 5_000,
      updatedAt: expect.any(Timestamp),
    })
    expect(JSON.stringify(stored)).not.toContain('example.com')
  })

  it('keeps sites retained earlier, replaces the same site, and never clears an unscoped refusal', async () => {
    const firestore = queryFakeFirestore({
      [`${STORE}/${key(PAT)}`]: {
        marketingConsent: false,
        marketingConsentByHost: {
          'site-a': { ...refused(1), retainedAtMs: 2, retainedFromContactId: 'con_old', note: 'old' },
          'site-b': { ...refused(3), retainedAtMs: 4, retainedFromContactId: 'con_old' },
        },
      },
    })
    await retainRefusals({
      contactsRef: firestore.collection(`orgs/${ORG}/contacts`),
      email: PAT,
      contactId: 'con_2',
      retained: { byHost: { 'site-a': refused(10) }, unscoped: false },
      nowMs: 20,
    })
    expect(firestore.read(`${STORE}/${key(PAT)}`)).toMatchObject({
      marketingConsent: false,
      marketingConsentByHost: {
        'site-a': { ...refused(10), retainedAtMs: 20, retainedFromContactId: 'con_2' },
        'site-b': { ...refused(3), retainedAtMs: 4, retainedFromContactId: 'con_old' },
      },
    })
    expect(firestore.read(`${STORE}/${key(PAT)}`)?.['marketingConsentByHost']['site-a']).not.toHaveProperty('note')
  })

  it('writes the unscoped refusal, and every address the record answered to', async () => {
    const firestore = queryFakeFirestore()
    const written = await retainRefusals({
      orgRef: firestore.doc(`orgs/${ORG}`),
      email: [PAT, 'pat@work.example', 'PAT@example.com', 'not an address'],
      contactId: 'con_1',
      retained: { byHost: {}, unscoped: true },
      nowMs: 1,
    })
    expect(written).toBe(2)
    for (const email of [PAT, 'pat@work.example']) {
      expect(firestore.read(`${STORE}/${key(email)}`)).toMatchObject({ marketingConsent: false, retainedAtMs: 1 })
    }
  })

  it('writes nothing when there is nothing to keep', async () => {
    const firestore = queryFakeFirestore()
    for (const retained of [null, undefined, { byHost: {}, unscoped: false }]) {
      expect(
        await retainRefusals({ orgRef: firestore.doc(`orgs/${ORG}`), email: PAT, contactId: 'c', retained, nowMs: 1 }),
      ).toBe(0)
    }
    expect(firestore.writes()).toBe(0)
  })

  it('joins the delete’s transaction, so the two land together or not at all', async () => {
    const firestore = queryFakeFirestore({ [`orgs/${ORG}/contacts/con_1`]: { email: PAT } })
    const contacts = firestore.collection(`orgs/${ORG}/contacts`)
    await firestore.runTransaction(async (transaction) => {
      await transaction.get(contacts.doc('con_1'))
      await retainRefusals({
        contactsRef: contacts,
        email: PAT,
        contactId: 'con_1',
        retained: { byHost: { 'site-a': refused(1) }, unscoped: false },
        nowMs: 2,
        transaction,
      })
      transaction.delete(contacts.doc('con_1'))
    })
    expect(firestore.read(`orgs/${ORG}/contacts/con_1`)).toBeUndefined()
    expect(firestore.read(`${STORE}/${key(PAT)}`)).toBeDefined()

    // And a transaction that fails writes neither.
    const failing = queryFakeFirestore({ [`orgs/${ORG}/contacts/con_1`]: { email: PAT } })
    failing.failWritesTo(`orgs/${ORG}/contacts/con_1`, new Error('refused'))
    const refusedContacts = failing.collection(`orgs/${ORG}/contacts`)
    await expect(
      failing.runTransaction(async (transaction) => {
        await retainRefusals({
          contactsRef: refusedContacts,
          email: PAT,
          contactId: 'con_1',
          retained: { byHost: { 'site-a': refused(1) }, unscoped: false },
          nowMs: 2,
          transaction,
        })
        transaction.delete(refusedContacts.doc('con_1'))
      }),
    ).rejects.toThrow('refused')
    expect(failing.read(`${STORE}/${key(PAT)}`)).toBeUndefined()
  })
})

describe('removeContactKeepingRefusals — the CRM delete and the API delete', () => {
  const CONTACT = `orgs/${ORG}/contacts/con_1`
  const GROUP_A = { groupId: 'site-a', hostIds: ['site-a'] }
  const shared = () => ({
    email: PAT,
    alternateEmails: ['pat@work.example'],
    visibleTo: ['host:site-a', 'host:site-b'],
    capturedByHostIds: ['site-a', 'site-b'],
    facets: { 'site-a': { notes: 'a' }, 'site-b': { notes: 'b' } },
    marketingConsentByHost: {
      'site-a': refused(10),
      'site-b': { marketingConsent: true, marketingConsentAtMs: 5 },
    },
  })
  const remove = (
    firestore: ReturnType<typeof queryFakeFirestore>,
    decide: RemoveContactInput['decide'] = (contact) => planContactDetach(contact, GROUP_A),
  ) => removeContactKeepingRefusals({ contactRef: firestore.doc(CONTACT), decide, nowMs: 50 })

  it('detaches a shared contact and leaves the leaving site’s refusal on it', async () => {
    const firestore = queryFakeFirestore({ [CONTACT]: shared() })
    expect(await remove(firestore)).toEqual({ outcome: 'detached' })
    const after = firestore.read(CONTACT) as Record<string, any>
    expect(after['visibleTo']).toEqual(['host:site-b'])
    expect(after['capturedByHostIds']).toEqual(['site-b'])
    expect(after['facets']).toEqual({ 'site-b': { notes: 'b' } })
    expect(after['marketingConsentByHost']['site-a']).toEqual(refused(10))
    expect(firestore.docs(STORE)).toEqual({})
  })

  it('drops the leaving site’s GRANT on a detach', async () => {
    const contact = shared()
    contact.marketingConsentByHost['site-a'] = { marketingConsent: true, marketingConsentAtMs: 1 } as never
    const firestore = queryFakeFirestore({ [CONTACT]: contact })
    await remove(firestore)
    expect((firestore.read(CONTACT) as Record<string, any>)['marketingConsentByHost']).toEqual({
      'site-b': { marketingConsent: true, marketingConsentAtMs: 5 },
    })
  })

  it('keeps every refusal under every address when the last holder deletes', async () => {
    const firestore = queryFakeFirestore({
      [CONTACT]: {
        ...shared(),
        visibleTo: ['host:site-a'],
        marketingConsent: false,
        marketingConsentByHost: { 'site-a': refused(10), 'site-z': refused(7) },
      },
    })
    expect(await remove(firestore)).toEqual({ outcome: 'deleted', retained: 2 })
    expect(firestore.read(CONTACT)).toBeUndefined()
    for (const email of [PAT, 'pat@work.example']) {
      expect(firestore.read(`${STORE}/${key(email)}`)).toMatchObject({
        marketingConsent: false,
        marketingConsentByHost: {
          'site-a': { ...refused(10), retainedAtMs: 50, retainedFromContactId: 'con_1' },
          'site-z': { ...refused(7), retainedAtMs: 50, retainedFromContactId: 'con_1' },
        },
      })
    }
  })

  it('deletes a contact that held no refusal and keeps nothing', async () => {
    const firestore = queryFakeFirestore({ [CONTACT]: { email: PAT, visibleTo: ['host:site-a'] } })
    expect(await remove(firestore)).toEqual({ outcome: 'deleted', retained: 0 })
    expect(firestore.read(CONTACT)).toBeUndefined()
    expect(firestore.docs(STORE)).toEqual({})
  })

  it('deletes regardless of holders for the API, keeping every refusal', async () => {
    const firestore = queryFakeFirestore({ [CONTACT]: shared() })
    expect(await remove(firestore, deleteWholeContact)).toEqual({ outcome: 'deleted', retained: 2 })
    expect(firestore.read(CONTACT)).toBeUndefined()
    const kept = firestore.read(`${STORE}/${key(PAT)}`) as Record<string, any>
    expect(Object.keys(kept['marketingConsentByHost'])).toEqual(['site-a'])
  })

  it('answers missing and refused without writing', async () => {
    const firestore = queryFakeFirestore({ [CONTACT]: shared() })
    expect(
      await removeContactKeepingRefusals({
        contactRef: firestore.doc(`orgs/${ORG}/contacts/nobody`),
        decide: deleteWholeContact,
        nowMs: 1,
      }),
    ).toEqual({ outcome: 'missing' })
    expect(await remove(firestore, () => ({ refused: 'not yours' }))).toEqual({
      outcome: 'refused',
      error: 'not yours',
    })
    expect(firestore.writes()).toBe(0)
  })

  it('decides against the document as the transaction read it', async () => {
    // A refusal recorded after a table row was read is still the one kept.
    const firestore = queryFakeFirestore({ [CONTACT]: { email: PAT, visibleTo: ['host:site-a'] } })
    firestore.seed(CONTACT, {
      email: PAT,
      visibleTo: ['host:site-a'],
      marketingConsentByHost: { 'site-a': refused(40) },
    })
    expect(await remove(firestore)).toEqual({ outcome: 'deleted', retained: 1 })
    expect(firestore.read(`${STORE}/${key(PAT)}`)).toBeDefined()
  })
})

describe('readRetainedRefusals', () => {
  it('answers by the normalized address, and leaves out an address with nothing retained', async () => {
    const firestore = queryFakeFirestore({
      [`${STORE}/${key(PAT)}`]: { marketingConsentByHost: { 'site-a': refused(1) } },
    })
    const found = await readRetainedRefusals(firestore.doc(`orgs/${ORG}`), [
      ' PAT@example.com ',
      'lee@example.com',
      'nonsense',
    ])
    expect([...found.keys()]).toEqual([PAT])
    expect(found.get(PAT)).toEqual({ marketingConsentByHost: { 'site-a': refused(1) } })
  })

  it('reads beside the contacts it is handed, in chunks', async () => {
    const seed: Record<string, Record<string, unknown>> = {}
    const emails = Array.from({ length: 150 }, (_, index) => `p${index}@example.com`)
    for (const email of emails) seed[`${STORE}/${key(email)}`] = { marketingConsent: false }
    const firestore = queryFakeFirestore(seed)
    const getAll = jest.spyOn(firestore, 'getAll')
    const found = await readRetainedRefusals(firestore.collection(`orgs/${ORG}/contacts`), emails)
    expect(found.size).toBe(150)
    expect(getAll).toHaveBeenCalledTimes(2)
  })

  it('throws when the read fails, rather than reading as nothing retained', async () => {
    const orgRef = {
      collection: () => ({ doc: (id: string) => ({ id }) }),
      firestore: { getAll: async () => Promise.reject(new Error('unavailable')) },
    }
    await expect(readRetainedRefusals(orgRef as never, [PAT])).rejects.toThrow('unavailable')
  })
})

describe('carryRetainedRefusals — the carry over the retained store', () => {
  const FROM = 'site-r'
  const TO = 'site-x'
  const CARRY = { toHostId: TO, fromHostId: FROM }
  const at = (ms: number) => Timestamp.fromMillis(ms)

  async function carryAll(
    firestore: ReturnType<typeof queryFakeFirestore>,
    options: { pageSize?: number; sinceMs?: number | null; dryRun?: boolean } = {},
  ) {
    let cursor: string | null = null
    let written = 0
    let pages = 0
    for (;;) {
      const page = await carryRetainedRefusals({
        firestore: firestore as never,
        orgId: ORG,
        carry: CARRY,
        changeId: 'change-1',
        cursor,
        ...options,
      })
      written += page.written
      pages += 1
      cursor = page.cursor
      if (page.done) return { written, pages }
    }
  }

  const seed = () =>
    queryFakeFirestore({
      [`${STORE}/k1`]: {
        marketingConsentByHost: { [FROM]: { ...refused(1), retainedAtMs: 2, retainedFromContactId: 'con_1' } },
        updatedAt: at(2),
      },
      // The receiving site already refuses: left as it is.
      [`${STORE}/k2`]: {
        marketingConsentByHost: { [FROM]: refused(3), [TO]: refused(4) },
        updatedAt: at(4),
      },
      // Another site's refusal alone: nothing of FROM's to carry.
      [`${STORE}/k3`]: { marketingConsentByHost: { other: refused(5) }, updatedAt: at(5) },
    })

  it('gives the receiving site the refusals it lacks, with where they came from', async () => {
    const firestore = seed()
    expect(await carryAll(firestore)).toMatchObject({ written: 1 })
    expect(firestore.read(`${STORE}/k1`)?.['marketingConsentByHost'][TO]).toEqual({
      ...refused(1),
      retainedAtMs: 2,
      retainedFromContactId: 'con_1',
      carriedFromHostId: FROM,
      carriedByChangeId: 'change-1',
    })
    expect(firestore.read(`${STORE}/k2`)?.['marketingConsentByHost'][TO]).toEqual(refused(4))
    expect(firestore.read(`${STORE}/k3`)?.['marketingConsentByHost'][TO]).toBeUndefined()
  })

  it('a second run writes nothing', async () => {
    const firestore = seed()
    await carryAll(firestore)
    firestore.resetWrites()
    expect(await carryAll(firestore)).toMatchObject({ written: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('a dry run counts and writes nothing', async () => {
    const firestore = seed()
    expect(await carryAll(firestore, { dryRun: true })).toMatchObject({ written: 1 })
    expect(firestore.writes()).toBe(0)
  })

  it('a catch-up reads only what was written since, and decides each in hand', async () => {
    const firestore = seed()
    firestore.seed(`${STORE}/k4`, {
      marketingConsentByHost: { [FROM]: refused(9) },
      updatedAt: at(9_000),
    })
    expect(await carryAll(firestore, { sinceMs: 9_000 })).toMatchObject({ written: 1 })
    expect(firestore.read(`${STORE}/k4`)?.['marketingConsentByHost'][TO]).toBeDefined()
    expect(firestore.read(`${STORE}/k1`)?.['marketingConsentByHost'][TO]).toBeUndefined()
  })

  it('ends page by page exactly where one uninterrupted run does', async () => {
    const docs: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index < 7; index += 1) {
      docs[`${STORE}/k${index}`] = { marketingConsentByHost: { [FROM]: refused(index) }, updatedAt: at(5_000) }
    }
    const whole = queryFakeFirestore(docs)
    const paged = queryFakeFirestore(docs)
    await carryAll(whole)
    expect(await carryAll(paged, { pageSize: 2 })).toMatchObject({ written: 7, pages: 4 })
    expect(paged.docs(STORE)).toEqual(whole.docs(STORE))
    // And a catch-up pages its ties on the one instant without skipping any.
    const tied = queryFakeFirestore(docs)
    expect(await carryAll(tied, { pageSize: 2, sinceMs: 5_000 })).toMatchObject({ written: 7 })
  })

  it('decides again from a fresh read when the document moved under it', async () => {
    const firestore = seed()
    const realBulkWriter = firestore.bulkWriter.bind(firestore)
    let raced = false
    ;(firestore as { bulkWriter: () => unknown }).bulkWriter = () => {
      const writer = realBulkWriter()
      const close = writer.close
      writer.close = async () => {
        if (!raced) {
          raced = true
          // Another delete retains a second site for the same person between
          // the carry's read and its write.
          firestore.seed(`${STORE}/k1`, {
            ...firestore.read(`${STORE}/k1`),
            marketingConsentByHost: {
              ...firestore.read(`${STORE}/k1`)?.['marketingConsentByHost'],
              other: refused(8),
            },
          })
        }
        return close()
      }
      return writer
    }
    expect(await carryAll(firestore)).toMatchObject({ written: 1 })
    expect(raced).toBe(true)
    expect(Object.keys(firestore.read(`${STORE}/k1`)?.['marketingConsentByHost']).sort()).toEqual(
      ['other', FROM, TO].sort(),
    )
  })
})
