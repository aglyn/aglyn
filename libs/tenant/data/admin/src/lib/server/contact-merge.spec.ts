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
 * The merge write (AGL-2625): children repointed before the swap, the swap
 * in one transaction, the index covering every address, the merged
 * document gone, and the audit line written once.
 *
 * Firestore is an in-memory map keyed by path, so every assertion reads
 * what LANDED. Sentinels are applied the way the SDK applies them; a batch
 * and a transaction apply their writes on commit and on return.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    increment: (by: number) => ({ __increment: by }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  },
}))

const mockLogHostActivity = jest.fn(async () => undefined)
jest.mock('./organizations', () => ({
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...(args as [])),
}))

import { mergeContacts } from './contact-merge'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function isSentinel(value: unknown): value is Record<string, any> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ('__serverTimestamp' in value ||
        '__increment' in value ||
        '__arrayUnion' in value ||
        '__arrayRemove' in value ||
        '__delete' in value),
  )
}

function applyValue(existing: unknown, value: unknown): unknown {
  if (!isSentinel(value)) return value
  if ('__serverTimestamp' in value) return { seconds: 1 }
  if ('__increment' in value) return Number(existing ?? 0) + Number(value.__increment)
  if ('__arrayUnion' in value) {
    const before = Array.isArray(existing) ? existing : []
    return [...before, ...value.__arrayUnion.filter((item: unknown) => !before.includes(item))]
  }
  if ('__arrayRemove' in value) {
    const before = Array.isArray(existing) ? existing : []
    return before.filter((item) => !value.__arrayRemove.includes(item))
  }
  return undefined
}

/** A merge-set: maps deep-merged, arrays and scalars replaced. */
function deepMerge(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (isSentinel(value)) {
      const next = applyValue(target[key], value)
      if (next === undefined) delete target[key]
      else target[key] = next
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] =
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
          ? { ...target[key] }
          : {}
      deepMerge(target[key], value)
    } else {
      target[key] = value
    }
  }
}

/** An update: dotted keys are paths, sentinels applied. */
function applyUpdate(existing: Record<string, any>, data: Record<string, any>) {
  const next = { ...existing }
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.')
    let cursor = next
    for (const part of parts.slice(0, -1)) {
      cursor[part] = { ...(cursor[part] ?? {}) }
      cursor = cursor[part]
    }
    const leaf = parts[parts.length - 1]
    const resolved = applyValue(cursor[leaf], value)
    if (resolved === undefined) delete cursor[leaf]
    else cursor[leaf] = resolved
  }
  return next
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      if (options?.merge) {
        const next = { ...(docs.get(path) ?? {}) }
        deepMerge(next, value)
        docs.set(path, next)
      } else {
        const next = {}
        deepMerge(next, value)
        docs.set(path, next)
      }
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyUpdate(existing, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, max?: number): any => ({
    path,
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported op ${op}`)
      return make([...filters, [field, value]], max)
    },
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (data: Record<string, any>) => {
      const ref = docRef(`${path}/auto-${++autoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([])
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) =>
        void queued.push(() => ref.set(value, options)),
      update: (ref: any, value: Record<string, any>) =>
        void queued.push(() => ref.update(value)),
      delete: (ref: any) => void queued.push(() => ref.delete()),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
  runTransaction: async (body: (transaction: any) => Promise<unknown>) => {
    const queued: Array<() => Promise<void>> = []
    const result = await body({
      get: async (ref: any) => ref.get(),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) =>
        void queued.push(() => ref.set(value, options)),
      update: (ref: any, value: Record<string, any>) =>
        void queued.push(() => ref.update(value)),
      delete: (ref: any) => void queued.push(() => ref.delete()),
    })
    for (const write of queued) await write()
    return result
  },
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'orgs/org-1'
const orgRef = () => docRef(ORG)
const SURVIVOR = `${ORG}/contacts/c-keep`
const MERGED = `${ORG}/contacts/c-gone`
const actor = { uid: 'u-1', email: 'ada@acme.test' }

function seed() {
  docs.set(SURVIVOR, {
    email: 'jane@acme.com',
    name: 'Jane Doe',
    hostId: 'h1',
    visibleTo: ['host:h1'],
    capturedByHostIds: ['h1'],
    companyIds: ['co-both'],
    facets: {
      h1: {
        sources: { form: true },
        interactions: [{ type: 'form', atMs: 100, refId: 's1', hostId: 'h1' }],
        tags: ['vip'],
        phone: '+15125550100',
      },
    },
  })
  docs.set(MERGED, {
    email: 'jane@gmail.com',
    name: 'J Doe',
    hostId: 'h2',
    visibleTo: ['host:h2'],
    capturedByHostIds: ['h2'],
    companyIds: ['co-both', 'co-gone'],
    alternateEmails: ['jd@example.org'],
    facets: {
      h1: {
        sources: { order: true },
        interactions: [{ type: 'order', atMs: 200, refId: 'o1', hostId: 'h1' }],
        tags: ['wholesale'],
        jobTitle: 'Buyer',
      },
      h2: { sources: { newsletter: true }, interactions: [] },
    },
  })
  docs.set(`${ORG}/companies/co-both`, { name: 'Both', contactsCount: 2 })
  docs.set(`${ORG}/companies/co-gone`, { name: 'Gone only', contactsCount: 1 })
  docs.set(`${ORG}/deals/d-1`, { title: 'Renewal', contactId: 'c-gone' })
  docs.set(`${ORG}/deals/d-2`, { title: 'Other', contactId: 'c-other' })
  docs.set(`${ORG}/crmTasks/t-1`, { title: 'Call', contactId: 'c-gone' })
  docs.set(`${ORG}/crmActivities/a-1`, { kind: 'call', contactId: 'c-gone' })
  docs.set(`hosts/h2/leads/${personKey('jane@gmail.com')}`, {
    email: 'jane@gmail.com',
    convertedContactId: 'c-gone',
  })
  docs.set(`hosts/h1/leads/${personKey('jd@example.org')}`, {
    email: 'jd@example.org',
    convertedContactId: 'c-gone',
  })
  // A lead converted into somebody else under one of the merged addresses.
  docs.set(`hosts/h1/leads/${personKey('jane@gmail.com')}`, {
    email: 'jane@gmail.com',
    convertedContactId: 'c-other',
  })
}

const merge = (over: Partial<Parameters<typeof mergeContacts>[0]> = {}) =>
  mergeContacts({
    firestore,
    orgRef: orgRef(),
    survivorId: 'c-keep',
    mergedId: 'c-gone',
    actor,
    hostId: 'h1',
    actorName: 'Ada',
    ...over,
  })

beforeEach(() => {
  docs.clear()
  autoId = 0
  mockLogHostActivity.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  seed()
})

describe('mergeContacts', () => {
  it('folds the merged record into the survivor and deletes it', async () => {
    const result = await merge()
    expect(result).toMatchObject({
      ok: true,
      survivorId: 'c-keep',
      survivorEmail: 'jane@acme.com',
      mergedId: 'c-gone',
      mergedEmail: 'jane@gmail.com',
      emails: ['jane@acme.com', 'jane@gmail.com', 'jd@example.org'],
      repointed: { deals: 1, tasks: 1, activities: 1, leads: 2 },
    })
    expect(docs.has(MERGED)).toBe(false)
    const survivor = docs.get(SURVIVOR)!
    expect(survivor.email).toBe('jane@acme.com')
    expect(survivor.name).toBe('Jane Doe')
    expect(survivor.alternateEmails).toEqual(['jane@gmail.com', 'jd@example.org'])
    expect(survivor.visibleTo).toEqual(['host:h1', 'host:h2'])
    expect(survivor.companyIds).toEqual(['co-both', 'co-gone'])
    expect(survivor.facets.h1).toMatchObject({
      sources: { form: true, order: true },
      tags: ['vip', 'wholesale'],
      phone: '+15125550100',
      jobTitle: 'Buyer',
    })
    expect(survivor.facets.h1.interactions.map((entry: any) => entry.refId)).toEqual(['o1', 's1'])
    expect(survivor.facets.h2).toEqual({ sources: { newsletter: true }, interactions: [] })
    expect(survivor.updatedAt).toEqual({ seconds: 1 })
  })

  it('repoints deals, tasks, activities and the merged record’s leads, and nothing else', async () => {
    await merge()
    expect(docs.get(`${ORG}/deals/d-1`)).toMatchObject({ contactId: 'c-keep', updatedAt: { seconds: 1 } })
    expect(docs.get(`${ORG}/deals/d-2`)?.contactId).toBe('c-other')
    expect(docs.get(`${ORG}/crmTasks/t-1`)?.contactId).toBe('c-keep')
    expect(docs.get(`${ORG}/crmActivities/a-1`)?.contactId).toBe('c-keep')
    expect(docs.get(`hosts/h2/leads/${personKey('jane@gmail.com')}`)?.convertedContactId).toBe('c-keep')
    expect(docs.get(`hosts/h1/leads/${personKey('jd@example.org')}`)?.convertedContactId).toBe('c-keep')
    expect(docs.get(`hosts/h1/leads/${personKey('jane@gmail.com')}`)?.convertedContactId).toBe('c-other')
  })

  it('indexes every address the survivor answers to at the survivor', async () => {
    await merge()
    for (const email of ['jane@acme.com', 'jane@gmail.com', 'jd@example.org']) {
      expect(docs.get(`${ORG}/emailIndex/${personKey(email)}`)).toMatchObject({
        email,
        contactId: 'c-keep',
      })
    }
  })

  it('counts down only the companies both records named', async () => {
    await merge()
    expect(docs.get(`${ORG}/companies/co-both`)?.contactsCount).toBe(1)
    expect(docs.get(`${ORG}/companies/co-gone`)?.contactsCount).toBe(1)
  })

  it('writes one timeline note on the survivor and one feed entry on the site', async () => {
    await merge()
    const notes = childPaths(`${ORG}/crmActivities`)
      .map((path) => docs.get(path)!)
      .filter((row) => row.kind === 'note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      body: 'Merged with jane@gmail.com',
      contactId: 'c-keep',
      byUid: 'u-1',
      byName: 'Ada',
      hostId: 'h1',
      visibleTo: ['host:h1', 'host:h2'],
    })
    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    expect(mockLogHostActivity).toHaveBeenCalledWith(
      'h1',
      actor,
      'Merged with jane@gmail.com',
      { type: 'contact', id: 'c-keep', name: 'Jane Doe' },
    )
  })

  it('writes no feed entry for a door with no site, and files the note under the survivor’s first site', async () => {
    await merge({ hostId: null })
    expect(mockLogHostActivity).not.toHaveBeenCalled()
    const note = childPaths(`${ORG}/crmActivities`)
      .map((path) => docs.get(path)!)
      .find((row) => row.kind === 'note')
    expect(note?.hostId).toBe('h1')
  })

  it('refuses to merge a record into itself', async () => {
    expect(await merge({ mergedId: 'c-keep' })).toEqual({ ok: false, reason: 'same-record' })
    expect(docs.has(SURVIVOR)).toBe(true)
  })

  it('refuses when either record is missing, and moves nothing', async () => {
    expect(await merge({ survivorId: 'c-none' })).toEqual({
      ok: false,
      reason: 'survivor-missing',
    })
    expect(await merge({ mergedId: 'c-none' })).toEqual({ ok: false, reason: 'merged-missing' })
    expect(docs.get(`${ORG}/deals/d-1`)?.contactId).toBe('c-gone')
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('is idempotent: a second merge of a pair already merged is a missing record', async () => {
    await merge()
    expect(await merge()).toEqual({ ok: false, reason: 'merged-missing' })
    expect(docs.get(SURVIVOR)?.alternateEmails).toEqual(['jane@gmail.com', 'jd@example.org'])
  })

  it('moves every pointing row when there are more than one page of them', async () => {
    for (let index = 0; index < 850; index += 1) {
      docs.set(`${ORG}/deals/bulk-${index}`, { contactId: 'c-gone' })
    }
    const result = await merge()
    expect(result.ok && result.repointed.deals).toBe(851)
    expect(
      childPaths(`${ORG}/deals`).filter((path) => docs.get(path)?.contactId === 'c-gone'),
    ).toHaveLength(0)
  })
})
