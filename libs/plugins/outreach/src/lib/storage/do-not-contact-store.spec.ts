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

import { outreachDoNotContactKey } from '../engine/do-not-contact'
import {
  addOutreachDoNotContact,
  getOutreachDoNotContactEntry,
  isOutreachDoNotContact,
  lookupOutreachDoNotContact,
  readOutreachDoNotContactEntry,
} from './do-not-contact-store'

/**
 * The organization's do-not-contact list (AGL-2980), against an in-memory
 * store whose `create` refuses an existing document the way Firestore's
 * does. `outreach-storage.emulator.spec.ts` proves the same against a real
 * Firestore.
 */

type Docs = Map<string, Record<string, unknown>>

function fakeFirestore(docs: Docs, options: { failReads?: boolean } = {}) {
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) }
  }
  const doc = (path: string): any => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, structuredClone(data))
    },
  })
  const collection = (path: string): any => ({ doc: (id: string) => doc(`${path}/${id}`) })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => {
      if (options.failReads) throw new Error('UNAVAILABLE')
      return refs.map((ref) => snapshot(ref.path))
    },
  } as unknown as FirebaseFirestore.Firestore
}

const ORG = 'org-outreach'
const AT = 1_750_000_000_000
const EMAIL = 'casey.morgan@example.com'
const path = (email: string) => `orgs/${ORG}/outreachDoNotContact/${outreachDoNotContactKey(email)}`

let docs: Docs
beforeEach(() => {
  docs = new Map()
})

describe('addOutreachDoNotContact (AGL-2980)', () => {
  it('writes an entry under the address key that carries no address', async () => {
    const result = await addOutreachDoNotContact(fakeFirestore(docs), {
      orgId: ORG,
      email: ' Casey.Morgan@Example.com ',
      reason: 'manual',
      source: 'member',
      addedByUid: 'uid-rep',
      nowMs: AT,
      enrollmentId: 'enr-1',
      sequenceId: 'seq-1',
      detail: '  Asked on a call  ',
    })
    expect(result.created).toBe(true)
    const stored = docs.get(path(EMAIL))
    expect(stored).toEqual({
      key: outreachDoNotContactKey(EMAIL),
      reason: 'manual',
      source: 'member',
      addedByUid: 'uid-rep',
      addedAtMs: AT,
      enrollmentId: 'enr-1',
      sequenceId: 'seq-1',
      detail: 'Asked on a call',
    })
    expect(JSON.stringify(stored).toLowerCase()).not.toContain('casey')
  })

  it('keeps the first entry when the address is added again', async () => {
    const firestore = fakeFirestore(docs)
    await addOutreachDoNotContact(firestore, {
      orgId: ORG,
      email: EMAIL,
      reason: 'manual',
      source: 'member',
      addedByUid: 'uid-rep',
      nowMs: AT,
    })
    const again = await addOutreachDoNotContact(firestore, {
      orgId: ORG,
      email: EMAIL,
      reason: 'unsubscribe',
      source: 'runtime',
      nowMs: AT + 1000,
    })
    expect(again.created).toBe(false)
    expect(again.entry).toMatchObject({ reason: 'manual', source: 'member', addedAtMs: AT })
    expect(docs.get(path(EMAIL))?.['reason']).toBe('manual')
  })

  it('records a runtime entry with no member', async () => {
    const { entry } = await addOutreachDoNotContact(fakeFirestore(docs), {
      orgId: ORG,
      email: EMAIL,
      reason: 'hard_bounce',
      source: 'runtime',
      nowMs: AT,
      detail: '550 5.1.1 The email account that you tried to reach does not exist.',
    })
    expect(entry).toMatchObject({ source: 'runtime', addedByUid: null, reason: 'hard_bounce' })
  })

  it('refuses what it cannot explain: no address, an unknown reason or source, a member entry with no member', async () => {
    const firestore = fakeFirestore(docs)
    const base = { orgId: ORG, email: EMAIL, nowMs: AT }
    await expect(
      addOutreachDoNotContact(firestore, { ...base, email: 'not an address', reason: 'manual', source: 'runtime' }),
    ).rejects.toThrow('cannot key')
    await expect(
      addOutreachDoNotContact(firestore, { ...base, reason: 'spite' as never, source: 'runtime' }),
    ).rejects.toThrow('not a do-not-contact reason')
    await expect(
      addOutreachDoNotContact(firestore, { ...base, reason: 'manual', source: 'robot' as never }),
    ).rejects.toThrow('not a do-not-contact source')
    await expect(
      addOutreachDoNotContact(firestore, { ...base, reason: 'manual', source: 'member' }),
    ).rejects.toThrow('names the member')
    expect(docs.size).toBe(0)
  })
})

describe('reading the list (AGL-2980)', () => {
  beforeEach(async () => {
    await addOutreachDoNotContact(fakeFirestore(docs), {
      orgId: ORG,
      email: EMAIL,
      reason: 'opt_out_reply',
      source: 'runtime',
      nowMs: AT,
    })
  })

  it('answers every address in one lookup, keyed as given', async () => {
    const answers = await lookupOutreachDoNotContact(fakeFirestore(docs), ORG, [
      'CASEY.MORGAN@example.com',
      'avery.quinn@example.org',
      'not an address',
    ])
    expect([...answers.entries()]).toEqual([
      ['not an address', null],
      ['CASEY.MORGAN@example.com', true],
      ['avery.quinn@example.org', false],
    ])
  })

  it('reads a failed lookup as unchecked, never as absent', async () => {
    const answers = await lookupOutreachDoNotContact(fakeFirestore(docs, { failReads: true }), ORG, [EMAIL])
    expect(answers.get(EMAIL)).toBeNull()
    expect(await isOutreachDoNotContact(fakeFirestore(docs, { failReads: true }), ORG, EMAIL)).toBeNull()
  })

  it('answers one address, and its entry', async () => {
    expect(await isOutreachDoNotContact(fakeFirestore(docs), ORG, EMAIL)).toBe(true)
    expect(await isOutreachDoNotContact(fakeFirestore(docs), ORG, 'avery.quinn@example.org')).toBe(false)
    expect(await getOutreachDoNotContactEntry(fakeFirestore(docs), ORG, EMAIL)).toMatchObject({
      reason: 'opt_out_reply',
      source: 'runtime',
    })
    expect(await getOutreachDoNotContactEntry(fakeFirestore(docs), ORG, 'avery.quinn@example.org')).toBeNull()
  })

  it('reads an entry another writer produced with its reason and source defaulted', () => {
    expect(readOutreachDoNotContactEntry('k', { reason: 'whim', addedAtMs: 'soon' })).toEqual({
      key: 'k',
      reason: 'manual',
      source: 'member',
      addedByUid: null,
      addedAtMs: 0,
      enrollmentId: null,
      sequenceId: null,
      detail: null,
    })
    expect(readOutreachDoNotContactEntry('k', undefined)).toBeNull()
  })
})
