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
 * THE EMAIL PLUGIN'S SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080), called
 * the way the erasure calls it. The whole erasure runs in
 * `apps/console/specs/person-erasure.spec.ts`.
 */

import { createHash } from 'node:crypto'
import { createEmailPersonEraser } from './person-eraser'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
}

function applyPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const next = { ...existing }
  for (const [field, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__delete' in value) delete next[field]
    else if (value && typeof value === 'object' && '__increment' in value) {
      next[field] = Number(next[field] ?? 0) + Number(value.__increment)
    } else next[field] = value
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
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyPatch(existing, value))
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, max?: number): any => ({
    where: (field: string, _op: string, value: unknown) => make([...filters, [field, value]], max),
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return make([])
}

const store: any = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      delete: (ref: any) => void queued.push(() => ref.delete()),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

store.getAll = async (...refs: any[]) => refs.map((ref) => snapshot(ref.path))

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')
const REQUEST = { orgId: ORG, email: EMAIL, key: KEY, dryRun: false, atMs: 777, contactIds: [] }

const eraser = createEmailPersonEraser({ firestore: () => store })

beforeEach(() => {
  docs.clear()
  docs.set(`orgs/${ORG}/lists/l1`, { name: 'Newsletter' })
  docs.set(`orgs/${ORG}/lists/l1/members/${KEY}`, { email: EMAIL })
  docs.set(`orgs/${ORG}/lists/l1/members/stranger`, { email: 'someone@else.com' })
  docs.set(`orgs/${ORG}/lists/l2`, { name: 'Empty' })
  docs.set(`orgs/org2/lists/l9/members/${KEY}`, { email: EMAIL })
})

describe('the email plugin’s person eraser', () => {
  it('takes the person off every audience list of the workspace, leaving the lists', async () => {
    expect(await eraser(REQUEST)).toEqual({ memberships: 1 })
    expect(docs.has(`orgs/${ORG}/lists/l1/members/${KEY}`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/lists/l1/members/stranger`)).toBe(true)
    expect(docs.has(`orgs/${ORG}/lists/l1`)).toBe(true)
    expect(docs.has(`orgs/org2/lists/l9/members/${KEY}`)).toBe(true)
  })

  it('counts on a dry run, and writes nothing', async () => {
    const before = new Map(docs)
    expect(await eraser({ ...REQUEST, dryRun: true })).toEqual({ memberships: 1 })
    expect(docs).toEqual(before)
  })
})
