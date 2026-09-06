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
 * The address index (AGL-2625): consulted before the query, trusted only
 * when the contact it names still exists, written lazily on a query hit,
 * and never in the way of a lookup that has to answer. Every door reads it
 * through one function (AGL-2633), so the two ways a door differs from the
 * capture — a site's scope, a transaction — are options on that function.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

import {
  emailIndexBeside,
  findContactByEmail,
  writeContactEmailIndex,
} from './contact-email-index'

const docs = new Map<string, Record<string, any>>()
let indexFailure: Error | null = null
/** When set, a read that did not go through the transaction throws. */
let transactionOnly = false

const snapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  exists: docs.has(path),
  data: () => docs.get(path),
  get: (field: string) => docs.get(path)?.[field],
})

const queryHits = (path: string, field: string, value: unknown) =>
  [...docs.keys()]
    .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
    .filter((key) => docs.get(key)?.[field] === value)
    .map(snapshot)

function collection(path: string): any {
  return {
    path,
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath
        ? { collection: (name: string) => collection(`${parentPath}/${name}`) }
        : null
    },
    doc: (id: string) => ({
      id,
      path: `${path}/${id}`,
      get: async () => {
        if (transactionOnly) throw new Error(`read outside the transaction: ${path}/${id}`)
        if (indexFailure && path.endsWith('/emailIndex')) throw indexFailure
        return snapshot(`${path}/${id}`)
      },
      set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
        if (indexFailure && path.endsWith('/emailIndex')) throw indexFailure
        docs.set(`${path}/${id}`, {
          ...(options?.merge ? (docs.get(`${path}/${id}`) ?? {}) : {}),
          ...value,
        })
      },
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        filter: { path, field, value },
        get: async () => {
          if (transactionOnly) throw new Error(`read outside the transaction: ${path}`)
          const hits = queryHits(path, field, value)
          return { empty: hits.length === 0, docs: hits }
        },
      }),
    }),
  }
}

/**
 * A transaction double that answers from the store itself rather than by
 * delegating to the plain `get`, so a read the helper routed around the
 * transaction is the plain `get` — which `transactionOnly` makes throw.
 */
const transaction = {
  get: jest.fn(async (target: any) => {
    if (typeof target.path === 'string') return snapshot(target.path)
    const { path, field, value } = target.filter
    const hits = queryHits(path, field, value)
    return { empty: hits.length === 0, docs: hits }
  }),
}

const CONTACTS = 'orgs/org-1/contacts'
const contactsRef = collection(CONTACTS)
const indexPath = (email: string) => `orgs/org-1/emailIndex/${personKey(email)}`

beforeEach(() => {
  docs.clear()
  indexFailure = null
  transactionOnly = false
  transaction.get.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('findContactByEmail', () => {
  it('resolves an alternate address through the index to the survivor', async () => {
    docs.set(`${CONTACTS}/c-1`, { email: 'jane@acme.com', alternateEmails: ['jane@gmail.com'] })
    docs.set(indexPath('jane@gmail.com'), { email: 'jane@gmail.com', contactId: 'c-1' })
    const found = await findContactByEmail(contactsRef, 'Jane@Gmail.com ')
    expect(found?.id).toBe('c-1')
  })

  it('falls back to the query when the index has no entry, and writes the entry it lacked', async () => {
    docs.set(`${CONTACTS}/c-2`, { email: 'sam@acme.com' })
    const found = await findContactByEmail(contactsRef, 'sam@acme.com')
    expect(found?.id).toBe('c-2')
    expect(docs.get(indexPath('sam@acme.com'))).toMatchObject({
      email: 'sam@acme.com',
      contactId: 'c-2',
    })
  })

  it('does not trust an entry naming a contact that no longer exists', async () => {
    docs.set(indexPath('gone@acme.com'), { email: 'gone@acme.com', contactId: 'c-deleted' })
    docs.set(`${CONTACTS}/c-3`, { email: 'gone@acme.com' })
    const found = await findContactByEmail(contactsRef, 'gone@acme.com')
    expect(found?.id).toBe('c-3')
    // The query hit repoints the stale entry.
    expect(docs.get(indexPath('gone@acme.com'))?.contactId).toBe('c-3')
  })

  it('answers the query when the index cannot be read', async () => {
    docs.set(`${CONTACTS}/c-4`, { email: 'ok@acme.com' })
    indexFailure = new Error('unavailable')
    const found = await findContactByEmail(contactsRef, 'ok@acme.com')
    expect(found?.id).toBe('c-4')
  })

  it('answers null for an address nobody holds, and for an unusable one', async () => {
    expect(await findContactByEmail(contactsRef, 'nobody@acme.com')).toBeNull()
    expect(await findContactByEmail(contactsRef, 'not an address')).toBeNull()
  })

  it('needs no index at all for a contacts handle with no parent', async () => {
    const bare = { ...collection('contacts') }
    Object.defineProperty(bare, 'parent', { get: () => null })
    docs.set('contacts/c-5', { email: 'flat@acme.com' })
    expect(emailIndexBeside(bare as any)).toBeNull()
    const found = await findContactByEmail(bare as any, 'flat@acme.com')
    expect(found?.id).toBe('c-5')
    expect([...docs.keys()].some((key) => key.includes('emailIndex'))).toBe(false)
  })

  describe('narrowed to one site (hostId)', () => {
    it('answers the survivor an alternate names when the site may see it', async () => {
      docs.set(`${CONTACTS}/c-6`, {
        email: 'jane@acme.com',
        alternateEmails: ['jane@gmail.com'],
        visibleTo: ['host:site-a'],
      })
      docs.set(indexPath('jane@gmail.com'), { email: 'jane@gmail.com', contactId: 'c-6' })
      const found = await findContactByEmail(contactsRef, 'jane@gmail.com', { hostId: 'site-a' })
      expect(found?.id).toBe('c-6')
    })

    it('answers null for a contact the index names but the site cannot see', async () => {
      docs.set(`${CONTACTS}/c-7`, {
        email: 'jane@acme.com',
        alternateEmails: ['jane@gmail.com'],
        visibleTo: ['host:site-b'],
      })
      docs.set(indexPath('jane@gmail.com'), { email: 'jane@gmail.com', contactId: 'c-7' })
      expect(
        await findContactByEmail(contactsRef, 'jane@gmail.com', { hostId: 'site-a' }),
      ).toBeNull()
    })

    it('narrows the query fallback the same way, and an org-wide contact passes', async () => {
      docs.set(`${CONTACTS}/c-8`, { email: 'sam@acme.com', visibleTo: ['host:site-b'] })
      expect(
        await findContactByEmail(contactsRef, 'sam@acme.com', { hostId: 'site-a' }),
      ).toBeNull()
      docs.set(`${CONTACTS}/c-8`, { email: 'sam@acme.com', visibleTo: ['org'] })
      const found = await findContactByEmail(contactsRef, 'sam@acme.com', { hostId: 'site-a' })
      expect(found?.id).toBe('c-8')
    })
  })

  describe('inside a transaction', () => {
    it('reads the index entry and the survivor through the transaction', async () => {
      docs.set(`${CONTACTS}/c-10`, { email: 'jane@acme.com', alternateEmails: ['jane@gmail.com'] })
      docs.set(indexPath('jane@gmail.com'), { email: 'jane@gmail.com', contactId: 'c-10' })
      transactionOnly = true
      const found = await findContactByEmail(contactsRef, 'jane@gmail.com', {
        transaction: transaction as any,
      })
      expect(found?.id).toBe('c-10')
      expect(transaction.get).toHaveBeenCalledTimes(2)
    })

    it('runs the fallback query through the transaction and still fills the entry', async () => {
      docs.set(`${CONTACTS}/c-11`, { email: 'sam@acme.com' })
      transactionOnly = true
      const found = await findContactByEmail(contactsRef, 'sam@acme.com', {
        transaction: transaction as any,
      })
      expect(found?.id).toBe('c-11')
      // The index miss and the query: two reads, both through the transaction.
      expect(transaction.get).toHaveBeenCalledTimes(2)
      // The lazy write is a plain `set`, outside the transaction.
      expect(docs.get(indexPath('sam@acme.com'))?.contactId).toBe('c-11')
    })

    it('applies the site scope to a transactional read too', async () => {
      docs.set(`${CONTACTS}/c-12`, {
        email: 'jane@acme.com',
        alternateEmails: ['jane@gmail.com'],
        visibleTo: ['host:site-b'],
      })
      docs.set(indexPath('jane@gmail.com'), { email: 'jane@gmail.com', contactId: 'c-12' })
      transactionOnly = true
      expect(
        await findContactByEmail(contactsRef, 'jane@gmail.com', {
          hostId: 'site-a',
          transaction: transaction as any,
        }),
      ).toBeNull()
    })
  })
})

describe('writeContactEmailIndex', () => {
  it('points every usable address at the contact and skips the rest', async () => {
    await writeContactEmailIndex(emailIndexBeside(contactsRef), 'c-9', [
      'a@acme.com',
      'B@Acme.com',
      'nope',
    ])
    expect(docs.get(indexPath('a@acme.com'))?.contactId).toBe('c-9')
    expect(docs.get(indexPath('b@acme.com'))?.contactId).toBe('c-9')
    expect([...docs.keys()]).toHaveLength(2)
  })

  it('never rejects', async () => {
    indexFailure = new Error('unavailable')
    await expect(
      writeContactEmailIndex(emailIndexBeside(contactsRef), 'c-9', ['a@acme.com']),
    ).resolves.toBeUndefined()
  })
})
