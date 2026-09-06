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
 * and never in the way of a lookup that has to answer.
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

const snapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  exists: docs.has(path),
  data: () => docs.get(path),
  get: (field: string) => docs.get(path)?.[field],
})

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
      get: async () => {
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
        get: async () => {
          const hits = [...docs.keys()]
            .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
            .filter((key) => docs.get(key)?.[field] === value)
            .map(snapshot)
          return { empty: hits.length === 0, docs: hits }
        },
      }),
    }),
  }
}

const CONTACTS = 'orgs/org-1/contacts'
const contactsRef = collection(CONTACTS)
const indexPath = (email: string) => `orgs/org-1/emailIndex/${personKey(email)}`

beforeEach(() => {
  docs.clear()
  indexFailure = null
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
