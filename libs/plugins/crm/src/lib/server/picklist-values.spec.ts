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
 * `crm/picklist-values` (AGL-3298, AGL-3510): a rename or a delete of a
 * picklist value, which changes the org's list AND every record the
 * definition's targets name that holds the old label. `crm/lead-source-values`
 * is the same route fixed to the lead source.
 *
 * What has to hold: the caller is the CRM writer the rules would admit;
 * the picklist is a registered one; the list is written before any record;
 * a rename keeps the value's id and moves every holder to the new label; a
 * delete moves them to the named ACTIVE replacement or clears them, and is
 * refused for a standard value; each contact is rewritten in the facet of
 * the holder that holds the value, and no other.
 */

const authorizeCrmWriter = jest.fn()
const orgHostIds = jest.fn()

/** The documents, by path. */
let store: Record<string, Record<string, unknown>> = {}
/** Every write, in order, for the list-before-records claim. */
let writes: string[] = []

const read = (data: Record<string, unknown> | undefined, path: readonly string[]) =>
  path.reduce<unknown>(
    (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
    data,
  )
const pathOf = (field: unknown): string[] =>
  typeof field === 'string' ? field.split('.') : (field as { segments: string[] }).segments

function write(path: string, field: unknown, value: unknown) {
  const target = { ...(store[path] ?? {}) }
  const segments = pathOf(field)
  let node: Record<string, unknown> = target
  for (const key of segments.slice(0, -1)) {
    node[key] = { ...((node[key] as Record<string, unknown>) ?? {}) }
    node = node[key] as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (value === '__delete') delete node[last]
  else node[last] = value
  store[path] = target
  writes.push(path)
}

function docRef(path: string) {
  return {
    path,
    get id() {
      return path.split('/').pop() as string
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => ({
      exists: path in store,
      id: path.split('/').pop(),
      data: () => store[path],
      get: (field: string) => store[path]?.[field],
      ref: docRef(path),
    }),
  }
}

function collectionRef(path: string) {
  const query = (filters: { field: unknown; value: unknown }[], max = Infinity) => ({
    where: (field: unknown, _op: string, value: unknown) =>
      query([...filters, { field, value }], max),
    limit: (n: number) => query(filters, n),
    get: async () => {
      const docs = Object.keys(store)
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) =>
          filters.every(({ field, value }) => read(store[key], pathOf(field)) === value),
        )
        .slice(0, max)
        .map((key) => ({ id: key.split('/').pop(), ref: docRef(key), data: () => store[key] }))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  })
  return { ...query([]), doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestoreHandle = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const pending: [string, unknown[]][] = []
    return {
      update: (ref: { path: string }, ...pairs: unknown[]) => void pending.push([ref.path, pairs]),
      commit: async () => {
        for (const [path, pairs] of pending) {
          for (let i = 0; i < pairs.length; i += 2) write(path, pairs[i], pairs[i + 1])
        }
      },
    }
  },
  runTransaction: async (fn: (transaction: unknown) => Promise<unknown>) =>
    fn({
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, value: Record<string, unknown>) => {
        store[ref.path] = { ...(store[ref.path] ?? {}), ...value }
        writes.push(ref.path)
      },
    }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp', delete: () => '__delete' },
  FieldPath: class {
    segments: string[]
    constructor(...segments: string[]) {
      this.segments = segments
    }
  },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
}))
jest.mock('./task-routes', () => ({
  __esModule: true,
  authorizeCrmWriter: (...args: unknown[]) => authorizeCrmWriter(...args),
}))
jest.mock('./org-caller', () => ({
  __esModule: true,
  readCrmRouteScope: (body: Record<string, unknown>) =>
    body['orgId']
      ? { level: 'org', hostId: '', orgId: body['orgId'] }
      : body['hostId']
        ? { level: 'site', hostId: body['hostId'], orgId: '' }
        : null,
  orgHostIds: (...args: unknown[]) => orgHostIds(...args),
}))

import { crmLeadSourceValuesHandler, crmPicklistValuesHandler } from './picklist-values'

const ORG = 'org-1'
const LIST = `orgs/${ORG}/crmPicklists/leadSource`

async function call(
  body: Record<string, unknown>,
  handler = crmLeadSourceValuesHandler,
) {
  let status = 0
  let payload: Record<string, unknown> = {}
  const res = {
    setHeader: jest.fn(),
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: Record<string, unknown>) => {
      payload = value
    },
  }
  await handler(
    { method: 'POST', body, headers: { authorization: 'Bearer t' } } as never,
    res as never,
  )
  return { status, payload }
}

beforeEach(() => {
  writes = []
  authorizeCrmWriter.mockReset()
  authorizeCrmWriter.mockResolvedValue({ ok: true, orgId: ORG, org: {}, uid: 'u', staff: false })
  orgHostIds.mockResolvedValue(['site-a', 'site-b'])
  store = {
    [LIST]: {
      values: [
        { id: 'apollo', label: 'Outbound · Apollo', active: true },
        { id: 'site', label: 'Website form', active: true },
        { id: 'test', label: 'Internal test', active: true },
        { id: 'web', label: 'Web', active: true, group: 'inbound' },
      ],
      defaultValueId: 'test',
      visibleTo: ['org'],
    },
    [`orgs/${ORG}/leads/l1`]: { leadSource: 'Outbound · Apollo' },
    [`orgs/${ORG}/leads/l2`]: { leadSource: 'Outbound · Apollo' },
    [`orgs/${ORG}/leads/l3`]: { leadSource: 'Website form' },
    // A deal carries the lead source of the lead it was converted from (AGL-3516).
    [`orgs/${ORG}/deals/d1`]: { leadSource: 'Outbound · Apollo', leadSourceKey: 'outbound · apollo' },
    [`orgs/${ORG}/contacts/c1`]: {
      facets: {
        'site-a': { leadSource: 'Outbound · Apollo' },
        'site-b': { leadSource: 'Website form' },
      },
    },
  }
})

describe('crm/picklist-values', () => {
  it('refuses a caller the CRM writer check refuses, and writes nothing', async () => {
    authorizeCrmWriter.mockResolvedValueOnce({ ok: false, status: 403, body: { error: 'No' } })
    const out = await call({ orgId: ORG, action: 'rename', valueId: 'apollo', label: 'Apollo' })
    expect(out.status).toBe(403)
    expect(writes).toEqual([])
    expect((await call({ orgId: ORG, action: 'nope', valueId: 'apollo' })).status).toBe(400)
  })

  it('renames the value in place, then moves every lead and the holding facet to the new label', async () => {
    const out = await call({ orgId: ORG, action: 'rename', valueId: 'apollo', label: 'Apollo' })
    expect(out).toEqual({ status: 200, payload: { ok: true, updated: { lead: 2, contact: 1, company: 0, deal: 1 } } })
    expect((store[LIST]['values'] as { id: string; label: string }[])[0]).toEqual({
      id: 'apollo',
      label: 'Apollo',
      active: true,
      group: null,
    })
    expect(writes[0]).toBe(LIST)
    expect(store[`orgs/${ORG}/leads/l1`]['leadSource']).toBe('Apollo')
    expect(store[`orgs/${ORG}/leads/l3`]['leadSource']).toBe('Website form')
    // The deal's label and the key its list filters by move together.
    expect(store[`orgs/${ORG}/deals/d1`]).toMatchObject({ leadSource: 'Apollo', leadSourceKey: 'apollo' })
    expect(read(store[`orgs/${ORG}/contacts/c1`], ['facets', 'site-a', 'leadSource'])).toBe('Apollo')
    expect(read(store[`orgs/${ORG}/contacts/c1`], ['facets', 'site-b', 'leadSource'])).toBe(
      'Website form',
    )
    // The Contacts list's lead source filter key moves with the label (AGL-3511).
    expect(store[`orgs/${ORG}/contacts/c1`]['facetKeys']).toEqual(
      expect.arrayContaining(['site-a:leadSource=apollo', '*:leadSource=apollo', 'site-b:leadSource=website form']),
    )
    expect(store[`orgs/${ORG}/contacts/c1`]['facetKeys']).not.toContain('site-a:leadSource=outbound · apollo')
  })

  it('refuses a rename onto another value, naming it', async () => {
    const out = await call({ orgId: ORG, action: 'rename', valueId: 'apollo', label: 'website form' })
    expect(out).toEqual({ status: 400, payload: { error: '“Website form” is already in the list.' } })
    expect(writes).toEqual([])
  })

  it('deletes a value onto an active replacement, or clears its records', async () => {
    const moved = await call({
      orgId: ORG,
      action: 'delete',
      valueId: 'site',
      replaceWith: 'outbound · apollo',
    })
    expect(moved.payload).toEqual({ ok: true, updated: { lead: 1, contact: 1, company: 0, deal: 0 } })
    expect(store[`orgs/${ORG}/leads/l3`]['leadSource']).toBe('Outbound · Apollo')
    expect(read(store[`orgs/${ORG}/contacts/c1`], ['facets', 'site-b', 'leadSource'])).toBe(
      'Outbound · Apollo',
    )
    const cleared = await call({ orgId: ORG, action: 'delete', valueId: 'apollo', replaceWith: null })
    // Both of c1's holders held it by now, and each facet is its own write.
    expect(cleared.payload).toEqual({ ok: true, updated: { lead: 3, contact: 2, company: 0, deal: 1 } })
    expect(store[`orgs/${ORG}/leads/l1`]).not.toHaveProperty('leadSource')
    expect(store[`orgs/${ORG}/deals/d1`]).toMatchObject({ leadSourceKey: null })
    expect(store[`orgs/${ORG}/deals/d1`]).not.toHaveProperty('leadSource')
    expect(store[`orgs/${ORG}/leads/l1`]).toMatchObject({ leadSourceKey: null })
    // The stored values left, then every standard value written down beside them.
    const ids = (store[LIST]['values'] as { id: string }[]).map((value) => value.id)
    expect(ids.slice(0, 2)).toEqual(['test', 'web'])
    expect(ids).toContain('purchased-list')
    expect(ids).not.toContain('apollo')
    expect(store[LIST]['defaultValueId']).toBe('test')
  })

  it('writes the standard values down as the org’s own on a first move, stamped org-wide', async () => {
    delete store[LIST]
    const out = await call({ hostId: 'site-a', action: 'rename', valueId: 'web', label: 'Website' })
    expect(out.status).toBe(200)
    expect(store[LIST]).toMatchObject({ hostId: 'site-a', visibleTo: ['org'] })
    expect((store[LIST]['values'] as { label: string; group: string }[])[0]).toEqual({
      id: 'web',
      label: 'Website',
      active: true,
      group: 'inbound',
    })
  })

  it('refuses to delete a standard value, and writes nothing', async () => {
    const out = await call({ orgId: ORG, action: 'delete', valueId: 'web', replaceWith: null })
    expect(out).toEqual({
      status: 400,
      payload: { error: '“Web” is a standard value and cannot be deleted. Deactivate it instead.' },
    })
    expect(writes).toEqual([])
  })

  it('takes the picklist by id on the shared route, and refuses one the registry does not hold', async () => {
    const out = await call(
      { orgId: ORG, picklistId: 'leadSource', action: 'rename', valueId: 'apollo', label: 'Apollo' },
      crmPicklistValuesHandler,
    )
    expect(out.payload).toEqual({ ok: true, updated: { lead: 2, contact: 1, company: 0, deal: 1 } })
    const unknown = await call(
      { orgId: ORG, picklistId: 'nope', action: 'rename', valueId: 'x', label: 'Y' },
      crmPicklistValuesHandler,
    )
    expect(unknown.status).toBe(400)
    const missing = await call(
      { orgId: ORG, action: 'rename', valueId: 'apollo', label: 'Apollo' },
      crmPicklistValuesHandler,
    )
    expect(missing.status).toBe(400)
  })
})
