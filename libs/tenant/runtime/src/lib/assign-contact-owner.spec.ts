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
 * WHO A NEW RECORD BELONGS TO (AGL-2618), as a transaction over a fake
 * Firestore that keeps every write it is handed.
 *
 * What is pinned: a capture assigns only a record with no owner; the rules
 * are tried in order and the first that names somebody on the roster wins;
 * the site default is the fallback and nobody is the fallback's fallback;
 * the rotation reads and moves its pointer inside the transaction; the
 * lead beside the contact is given the same owner — at once when it is
 * there, on a later look when a door files it after the contact; the owner
 * is told about the record they will open, unless they are the actor; and
 * nothing here ever rejects.
 */

const docs = new Map<string, Record<string, any>>()
let notified: Array<{ uids: string[]; payload: Record<string, any> }> = []
let transactionFails = false
/** Reads made through the transaction, by path — the roster check budget. */
let transactionReads: string[] = []

function readPath(data: Record<string, any>, key: string): unknown {
  return key.split('.').reduce<any>((value, part) => value?.[part], data)
}

function applyUpdate(path: string, value: Record<string, any>) {
  const existing = docs.get(path)
  if (existing === undefined) {
    throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
  }
  const next: Record<string, any> = { ...existing }
  for (const [key, field] of Object.entries(value)) {
    let target = next
    let leaf = key
    if (key.includes('.')) {
      const parts = key.split('.')
      leaf = parts.pop() as string
      for (const part of parts) {
        target[part] = { ...(target[part] ?? {}) }
        target = target[part]
      }
    }
    target[leaf] = field
  }
  docs.set(path, next)
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? readPath(data, field) : undefined),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
    get: async () => snapshot(path),
    update: async (value: Record<string, any>) => applyUpdate(path, value),
  }
}

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    if (transactionFails) throw new Error('UNAVAILABLE')
    // Writes are staged and applied on commit, which is what makes "all
    // reads before the write" observable: a read after a write reads the
    // pre-transaction document, as Firestore would refuse.
    const staged: Array<[string, Record<string, any>]> = []
    const tx = {
      get: async (ref: { path: string }) => {
        transactionReads.push(ref.path)
        return snapshot(ref.path)
      },
      update: (ref: { path: string }, value: Record<string, any>) => {
        staged.push([ref.path, value])
      },
    }
    const result = await body(tx)
    for (const [path, value] of staged) applyUpdate(path, value)
    return result
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async (hostId: string) =>
    hostId === 'orphan' ? null : { orgId: 'org-1', org: docs.get('orgs/org-1') ?? {} },
  notifyUsers: async (uids: Iterable<string>, payload: Record<string, any>) => {
    notified.push({ uids: [...uids], payload })
  },
}))

import { personKey } from '@aglyn/aglyn/server'
import { assignOwnerForCapture, reassignContactOwner } from './assign-contact-owner'

const HOST = 'site-1'
const EMAIL = 'ada@acme.com'
const CONTACT = 'orgs/org-1/contacts/c1'
const ORG = 'orgs/org-1'
const LEAD = `hosts/${HOST}/leads/${personKey(EMAIL)}`
const facetOwner = () => readPath(docs.get(CONTACT) ?? {}, `facets.${HOST}.ownerUid`)
const pointer = () => readPath(docs.get(ORG) ?? {}, 'crm.roundRobin.lastAssignedUid')

/** The org with a roster, and no CRM settings unless the case sets them. */
function seed(crm: Record<string, unknown> = {}, roster = ['uid-sam', 'uid-kim', 'uid-lee']) {
  docs.clear()
  docs.set(ORG, { name: 'Acme', crm })
  for (const uid of roster) docs.set(`${ORG}/members/${uid}`, { role: 'editor' })
  docs.set(CONTACT, { email: EMAIL, name: 'Ada', facets: { [HOST]: { tags: ['vip'] } } })
}

const capture = (extra: Partial<Parameters<typeof assignOwnerForCapture>[0]> = {}) =>
  assignOwnerForCapture({ hostId: HOST, contactId: 'c1', email: EMAIL, source: 'form', ...extra })

beforeEach(() => {
  notified = []
  transactionFails = false
  transactionReads = []
  seed()
})

describe('a capture with no rule and no default', () => {
  it('assigns nobody and writes nothing', async () => {
    const before = docs.get(CONTACT)
    await expect(capture()).resolves.toEqual({ outcome: 'none', reason: 'no-rule' })
    expect(docs.get(CONTACT)).toEqual(before)
    expect(notified).toEqual([])
  })

  it('leaves a record that already has an owner alone, and tells nobody', async () => {
    seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
    docs.set(CONTACT, { email: EMAIL, facets: { [HOST]: { ownerUid: 'uid-kept' } } })
    await expect(capture()).resolves.toEqual({ outcome: 'unchanged', ownerUid: 'uid-kept' })
    expect(facetOwner()).toBe('uid-kept')
    expect(notified).toEqual([])
  })
})

describe('the site default owner', () => {
  it('takes the record when no rule does, and is told', async () => {
    seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
    const verdict = await capture()
    expect(verdict).toMatchObject({ outcome: 'assigned', ownerUid: 'uid-sam', by: 'default' })
    expect(facetOwner()).toBe('uid-sam')
    expect(docs.get(CONTACT)?.updatedAt).toBe('server-timestamp')
    expect(notified).toEqual([
      {
        uids: ['uid-sam'],
        payload: {
          type: 'content.contactAssigned',
          title: 'Contact assigned to you',
          body: 'Ada',
          link: `/${HOST}/crm/contacts/c1`,
          orgId: 'org-1',
          hostId: HOST,
        },
      },
    ])
  })

  it('is a default for THIS site, and a member no longer on the roster is nobody', async () => {
    seed({ hosts: { 'site-2': { defaultOwnerUid: 'uid-sam' }, [HOST]: { defaultOwnerUid: 'uid-gone' } } })
    await expect(capture()).resolves.toEqual({ outcome: 'none', reason: 'no-rule' })
    expect(facetOwner()).toBeUndefined()
  })
})

describe('the rules', () => {
  it('tries them in order and the first match assigns', async () => {
    seed({
      assignmentRules: [
        { id: 'bookings', when: { source: 'booking' }, assign: { memberUid: 'uid-kim' } },
        { id: 'acme', when: { emailDomain: 'acme.com' }, assign: { memberUid: 'uid-lee' } },
        { id: 'all', when: {}, assign: { memberUid: 'uid-sam' } },
      ],
      hosts: { [HOST]: { defaultOwnerUid: 'uid-kim' } },
    })
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-lee', by: 'rule', ruleId: 'acme' })
    expect(facetOwner()).toBe('uid-lee')
  })

  it('reads the contact’s own tags beside the capture’s', async () => {
    seed({ assignmentRules: [{ id: 'vip', when: { tag: 'VIP' }, assign: { memberUid: 'uid-kim' } }] })
    await expect(capture({ tags: ['website'] })).resolves.toMatchObject({ ownerUid: 'uid-kim' })
  })

  it('passes over a rule naming somebody who left, and one over an empty pool', async () => {
    seed({
      assignmentRules: [
        { id: 'gone', when: {}, assign: { memberUid: 'uid-gone' } },
        { id: 'pool', when: {}, assign: { roundRobin: true } },
        { id: 'sam', when: {}, assign: { memberUid: 'uid-sam' } },
      ],
    })
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-sam', ruleId: 'sam' })
    // Every roster check is one document read, and the departed member cost one.
    expect(transactionReads.filter((path) => path.includes('/members/'))).toEqual([
      `${ORG}/members/uid-gone`,
      `${ORG}/members/uid-sam`,
    ])
  })

  it('conditions on the form the capture came through', async () => {
    seed({
      assignmentRules: [{ id: 'f', when: { formId: 'form-9' }, assign: { memberUid: 'uid-kim' } }],
    })
    await expect(capture({ formId: 'form-1' })).resolves.toEqual({ outcome: 'none', reason: 'no-rule' })
    await expect(capture({ formId: 'form-9' })).resolves.toMatchObject({ ownerUid: 'uid-kim' })
  })
})

describe('the rotation', () => {
  const pool = (lastAssignedUid?: string) => ({
    assignmentRules: [{ id: 'rr', when: {}, assign: { roundRobin: true } }],
    roundRobin: { memberUids: ['uid-sam', 'uid-kim', 'uid-lee'], ...(lastAssignedUid ? { lastAssignedUid } : {}) },
  })

  it('hands the record to the member after the last recipient and moves the pointer with it', async () => {
    seed(pool('uid-sam'))
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-kim', by: 'rule' })
    expect(pointer()).toBe('uid-kim')
    // The next capture reads the moved pointer.
    docs.set(CONTACT, { email: EMAIL, facets: {} })
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-lee' })
    expect(pointer()).toBe('uid-lee')
    docs.set(CONTACT, { email: EMAIL, facets: {} })
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-sam' })
  })

  it('starts from the top with no pointer, or a pointer to somebody who left the pool', async () => {
    seed(pool())
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-sam' })
    seed(pool('uid-departed'))
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-sam' })
  })

  it('skips a pool member no longer on the roster without moving the pointer past them', async () => {
    seed(pool('uid-sam'), ['uid-sam', 'uid-lee'])
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-lee' })
    expect(pointer()).toBe('uid-lee')
  })

  it('leaves the pointer alone when a member rule assigned', async () => {
    seed({
      ...pool('uid-sam'),
      assignmentRules: [{ id: 'm', when: {}, assign: { memberUid: 'uid-lee' } }],
    })
    await capture()
    expect(pointer()).toBe('uid-sam')
  })
})

describe('the lead beside the contact', () => {
  it('is given the same owner in the same transaction, and the owner is told about the lead', async () => {
    seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
    docs.set(LEAD, { email: EMAIL, sources: ['form:f1'] })
    await expect(capture()).resolves.toMatchObject({ leadMirrored: true, notified: true })
    expect(docs.get(LEAD)?.ownerUid).toBe('uid-sam')
    expect(notified[0].payload).toMatchObject({
      type: 'content.leadAssigned',
      title: 'Lead assigned to you',
      link: `/${HOST}/crm/leads/${personKey(EMAIL)}`,
    })
  })

  it('keeps a lead somebody already assigned by hand', async () => {
    seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
    docs.set(LEAD, { email: EMAIL, ownerUid: 'uid-by-hand' })
    await expect(capture()).resolves.toMatchObject({ ownerUid: 'uid-sam', leadMirrored: false })
    expect(docs.get(LEAD)?.ownerUid).toBe('uid-by-hand')
    expect(notified[0].payload.type).toBe('content.contactAssigned')
  })

  it('catches a lead a door files after the contact, on a later look', async () => {
    jest.useFakeTimers()
    try {
      seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
      await expect(capture({ source: 'booking' })).resolves.toMatchObject({ leadMirrored: false })
      expect(docs.get(LEAD)).toBeUndefined()
      await jest.advanceTimersByTimeAsync(1_000)
      // Lands between the first look and the second.
      docs.set(LEAD, { email: EMAIL, sources: ['booking'] })
      await jest.advanceTimersByTimeAsync(2_000)
      expect(docs.get(LEAD)?.ownerUid).toBe('uid-sam')
      // One notification, for the contact — the later look tells nobody twice.
      expect(notified).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not look again for a door that files no lead', async () => {
    jest.useFakeTimers()
    try {
      seed({ hosts: { [HOST]: { defaultOwnerUid: 'uid-sam' } } })
      await capture({ source: 'order' })
      docs.set(LEAD, { email: EMAIL })
      await jest.advanceTimersByTimeAsync(10_000)
      expect(docs.get(LEAD)?.ownerUid).toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('a deliberate reassignment', () => {
  it('overwrites the owner, moves the lead with it, and tells the new owner', async () => {
    docs.set(CONTACT, { email: EMAIL, facets: { [HOST]: { ownerUid: 'uid-sam' } } })
    docs.set(LEAD, { email: EMAIL, ownerUid: 'uid-sam' })
    const verdict = await reassignContactOwner({
      hostId: HOST,
      contactId: 'c1',
      email: EMAIL,
      assign: { memberUid: 'uid-kim' },
    })
    expect(verdict).toMatchObject({ outcome: 'assigned', ownerUid: 'uid-kim', by: 'member' })
    expect(facetOwner()).toBe('uid-kim')
    expect(docs.get(LEAD)?.ownerUid).toBe('uid-kim')
    expect(notified).toHaveLength(1)
    expect(notified[0].uids).toEqual(['uid-kim'])
  })

  it('changes nothing and tells nobody when the owner is named again', async () => {
    docs.set(CONTACT, { email: EMAIL, facets: { [HOST]: { ownerUid: 'uid-kim' } } })
    await expect(
      reassignContactOwner({ hostId: HOST, contactId: 'c1', email: EMAIL, assign: { memberUid: 'uid-kim' } }),
    ).resolves.toEqual({ outcome: 'unchanged', ownerUid: 'uid-kim' })
    expect(docs.get(CONTACT)?.updatedAt).toBeUndefined()
    expect(notified).toEqual([])
  })

  it('refuses a member not on the roster, and a rotation over an empty pool', async () => {
    await expect(
      reassignContactOwner({ hostId: HOST, contactId: 'c1', email: EMAIL, assign: { memberUid: 'uid-gone' } }),
    ).resolves.toEqual({ outcome: 'none', reason: 'not-a-member' })
    await expect(
      reassignContactOwner({ hostId: HOST, contactId: 'c1', email: EMAIL, assign: { roundRobin: true } }),
    ).resolves.toEqual({ outcome: 'none', reason: 'empty-pool' })
    expect(facetOwner()).toBeUndefined()
  })

  it('rotates from the pool the settings keep', async () => {
    seed({ roundRobin: { memberUids: ['uid-sam', 'uid-kim'], lastAssignedUid: 'uid-sam' } })
    await expect(
      reassignContactOwner({ hostId: HOST, contactId: 'c1', email: EMAIL, assign: { roundRobin: true } }),
    ).resolves.toMatchObject({ ownerUid: 'uid-kim', by: 'roundRobin' })
    expect(pointer()).toBe('uid-kim')
  })
})

describe('the actor', () => {
  it('is not told about a record they handed themselves', async () => {
    const verdict = await reassignContactOwner({
      hostId: HOST,
      contactId: 'c1',
      email: EMAIL,
      assign: { memberUid: 'uid-kim' },
      actorUid: 'uid-kim',
    })
    expect(verdict).toMatchObject({ outcome: 'assigned', notified: false })
    expect(notified).toEqual([])
  })
})

describe('the posture', () => {
  it('answers none for a site with no organization, and for a contact that is gone', async () => {
    await expect(capture({ hostId: 'orphan' })).resolves.toEqual({ outcome: 'none', reason: 'no-org' })
    docs.delete(CONTACT)
    await expect(capture()).resolves.toEqual({ outcome: 'none', reason: 'no-contact' })
  })

  it('never rejects: a failed transaction is logged and answered as none', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    transactionFails = true
    await expect(capture()).resolves.toEqual({ outcome: 'none', reason: 'failed' })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
