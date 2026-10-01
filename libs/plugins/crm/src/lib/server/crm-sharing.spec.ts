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
 * `crm/sharing` and the rules' evaluation (AGL-3336), on an in-memory
 * database, against the acceptance of the issue on a two-site org:
 *
 * - a lead captured on site A is invisible to site B;
 * - a manager's share makes it visible to B, with who shared it; unsharing
 *   hides it again; a non-manager's share is refused and writes nothing;
 * - a rule "leads captured on A → all sites" shares the existing A leads
 *   when it is saved, and every lead captured later through the core's
 *   record-written seam — with `org`, which a site created later reads too;
 * - deleting the rule removes only what it granted;
 * - a stale cached rule list never takes a rule's grant away.
 */

import { crmReadTokens, soloConsentGroup, visibleToTokens } from '@aglyn/aglyn'

const authorizeOrgCaller = jest.fn()
const authorizeCrmWriter = jest.fn()
const logOrgActivity = jest.fn(async () => undefined)
const crmSuiteRefusal = jest.fn((): unknown => null)

/** The documents, by path. */
let store: Record<string, Record<string, unknown>> = {}

const DELETE = Symbol('delete')
const clone = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
const DOCUMENT_ID = Symbol('documentId')

class FakeFieldPath {
  segments: string[]
  constructor(...segments: string[]) {
    this.segments = segments
  }
  static documentId() {
    return DOCUMENT_ID
  }
}

const read = (data: Record<string, unknown> | undefined, path: readonly string[]) =>
  path.reduce<unknown>(
    (value, key) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
    data,
  )

function writeField(path: string, segments: string[], value: unknown) {
  const target = clone(store[path] ?? {}) as Record<string, unknown>
  let node = target
  for (const key of segments.slice(0, -1)) {
    node[key] = { ...((node[key] as Record<string, unknown>) ?? {}) }
    node = node[key] as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (value === DELETE) delete node[last]
  else if (value !== '__serverTimestamp') node[last] = clone(value)
  store[path] = target
}

function update(path: string, fieldOrPatch: unknown, value?: unknown) {
  if (fieldOrPatch instanceof FakeFieldPath) {
    writeField(path, fieldOrPatch.segments, value)
    return
  }
  for (const [key, entry] of Object.entries(fieldOrPatch as Record<string, unknown>)) {
    writeField(path, key.split('.'), entry)
  }
}

function snapshotOf(path: string) {
  return {
    exists: path in store,
    id: path.split('/').pop() as string,
    ref: docRef(path),
    data: () => (path in store ? clone(store[path]) : undefined),
    get: (field: string) => store[path]?.[field],
  }
}

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
    create: async (value: Record<string, unknown>) => {
      if (path in store) throw Object.assign(new Error('exists'), { code: 6 })
      store[path] = clone(value)
    },
  }
}

type Filter = { field: string; op: string; value: unknown }

function collectionRef(path: string) {
  const query = (filters: Filter[], after: string | null, max: number) => ({
    where: (field: unknown, op: string, value: unknown) =>
      query([...filters, { field: String(field), op, value }], after, max),
    orderBy: () => query(filters, after, max),
    startAfter: (id: string) => query(filters, id, max),
    limit: (n: number) => query(filters, after, n),
    get: async () => {
      const docs = Object.keys(store)
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .filter((key) => after === null || key.split('/').pop()! > after)
        .filter((key) =>
          filters.every(({ field, op, value }) => {
            const got = read(store[key], field.split('.'))
            return op === 'array-contains'
              ? Array.isArray(got) && got.includes(value)
              : got === value
          }),
        )
        .slice(0, max)
        .map((key) => snapshotOf(key))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  })
  return { ...query([], null, Infinity), doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestoreHandle = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: (ref: { path: string }, fieldOrPatch: unknown, value?: unknown) =>
        update(ref.path, fieldOrPatch, value),
    }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp', delete: () => DELETE },
  // A getter: the mock is hoisted above the class it hands out.
  get FieldPath() {
    return FakeFieldPath
  },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
  getOrgForHost: async () => ({ orgId: ORG, org: {} }),
  logOrgActivity: (...args: unknown[]) => logOrgActivity(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({
  __esModule: true,
  countCrmActivitiesForRecord: async () => 0,
}))
jest.mock('./org-caller', () => ({
  __esModule: true,
  readCrmRouteScope: (body: Record<string, unknown>) =>
    body['orgId']
      ? { level: 'org', hostId: '', orgId: body['orgId'] }
      : body['hostId']
        ? { level: 'site', hostId: body['hostId'], orgId: '' }
        : null,
  authorizeOrgCaller: (...args: unknown[]) => authorizeOrgCaller(...args),
  orgHostIds: async () => ['site-a', 'site-b'],
}))
jest.mock('./task-routes', () => ({
  __esModule: true,
  authorizeCrmWriter: (...args: unknown[]) => authorizeCrmWriter(...args),
}))
jest.mock('./suite-gate', () => ({
  __esModule: true,
  crmSuiteRefusal: () => crmSuiteRefusal(),
}))

import {
  crmSharingHandler,
  crmSharingRecordWritten,
  crmSharingRulesOf,
  forgetCrmSharingRules,
} from './crm-sharing'

const ORG = 'org-1'
const A = 'host:site-a'
const B = 'host:site-b'
const lead = (id: string) => `orgs/${ORG}/leads/${id}`

async function call(body: Record<string, unknown>) {
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
  await crmSharingHandler(
    { method: 'POST', body, headers: { authorization: 'Bearer t' } } as never,
    res as never,
  )
  return { status, payload }
}

/** Whether site `hostId`'s own list query — its `array-contains-any` — returns the lead. */
const listedOn = (id: string, hostId: string) =>
  visibleToTokens(
    store[lead(id)]['visibleTo'] as string[],
    crmReadTokens(soloConsentGroup(hostId)),
  )

const captured = (hostId: string, email: string) => ({
  email,
  hostId,
  capturedByHostIds: [hostId],
  visibleTo: [`host:${hostId}`],
  status: 'new',
})

beforeEach(() => {
  forgetCrmSharingRules()
  authorizeOrgCaller.mockReset()
  authorizeOrgCaller.mockResolvedValue({
    ok: true,
    uid: 'uid-dana',
    email: 'dana@acme.test',
    name: 'Dana',
    staff: false,
    orgId: ORG,
    org: {},
  })
  authorizeCrmWriter.mockReset()
  authorizeCrmWriter.mockResolvedValue({ ok: true, orgId: ORG, org: {}, uid: 'u', staff: false })
  logOrgActivity.mockClear()
  crmSuiteRefusal.mockReset()
  crmSuiteRefusal.mockReturnValue(null)
  store = {
    [`orgs/${ORG}`]: { name: 'Acme' },
    'hosts/site-a': { orgId: ORG, displayName: 'Brand A' },
    'hosts/site-b': { orgId: ORG, displayName: 'Brand B' },
    [lead('l1')]: captured('site-a', 'one@acme.test'),
    [lead('l2')]: captured('site-a', 'two@acme.test'),
    [lead('l3')]: captured('site-b', 'three@acme.test'),
  }
})

describe('a manual share (AGL-3336)', () => {
  it('makes a lead captured on A visible to B, names who shared it, and unsharing hides it again', async () => {
    expect(listedOn('l1', 'site-b')).toBe(false)
    const shared = await call({ hostId: 'site-a', action: 'share', object: 'leads', ids: ['l1'], targets: ['site-b'] })
    expect(shared).toEqual({ status: 200, payload: { ok: true, changed: 1, missing: 0 } })
    expect(listedOn('l1', 'site-b')).toBe(true)
    expect(store[lead('l1')]['writeTo']).toEqual([A])
    expect(read(store[lead('l1')], ['sharing', 'grants', 'manual_site-b'])).toMatchObject({
      source: 'manual',
      access: 'read',
      byName: 'Dana',
      tokens: [B],
    })
    // The record's Activity says who shared it with whom, visible to both sides.
    const activity = Object.entries(store).find(([path]) => path.startsWith(`orgs/${ORG}/crmActivities/`))
    expect(activity?.[1]).toMatchObject({
      kind: 'note',
      body: 'Shared with Brand B (read-only)',
      leadId: 'l1',
      byName: 'Dana',
      visibleTo: [A, B],
    })
    expect(logOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: 'uid-dana', email: 'dana@acme.test' },
      'Shared with Brand B (read-only): one lead',
      { type: 'lead', id: 'l1' },
    )

    const unshared = await call({ hostId: 'site-a', action: 'unshare', object: 'leads', ids: ['l1'], targets: ['site-b'] })
    expect(unshared.payload).toMatchObject({ ok: true, changed: 1 })
    expect(listedOn('l1', 'site-b')).toBe(false)
    expect(store[lead('l1')]['visibleTo']).toEqual([A])
    expect('sharing' in store[lead('l1')]).toBe(false)
    expect('writeTo' in store[lead('l1')]).toBe(false)
  })

  it('is an org manager’s: anyone else is refused and nothing is written', async () => {
    authorizeOrgCaller.mockResolvedValueOnce({ ok: false, status: 403, error: 'No' })
    const before = clone(store)
    const out = await call({ hostId: 'site-b', action: 'share', object: 'leads', ids: ['l1'], targets: 'all' })
    expect(out.status).toBe(403)
    expect(store).toEqual(before)
    expect(authorizeOrgCaller.mock.calls[0][2]).toMatchObject({ needs: 'manage-org' })
  })

  it('asks the CRM’s plan gate', async () => {
    crmSuiteRefusal.mockReturnValueOnce({ status: 403, body: { error: 'plan', reason: 'plan_required' } })
    const out = await call({ orgId: ORG, action: 'share', object: 'leads', ids: ['l1'], targets: 'all' })
    expect(out).toEqual({ status: 403, payload: { error: 'plan', reason: 'plan_required' } })
  })

  it('refuses a target that is not one of the org’s sites', async () => {
    const out = await call({ orgId: ORG, action: 'share', object: 'leads', ids: ['l1'], targets: ['site-elsewhere'] })
    expect(out.status).toBe(400)
    expect(store[lead('l1')]['visibleTo']).toEqual([A])
  })
})

describe('a sharing rule (AGL-3336)', () => {
  const rule = {
    name: 'Brand A leads',
    object: 'leads',
    sourceHostIds: ['site-a'],
    targets: 'all',
    access: 'read',
  }

  it('shares the existing leads captured on A with all sites when it is saved, and reports its run', async () => {
    const out = await call({ orgId: ORG, action: 'rule-save', rule })
    expect(out.status).toBe(200)
    expect(out.payload['more']).toBe(false)
    expect(out.payload['rule']).toMatchObject({
      name: 'Brand A leads',
      targets: ['org'],
      run: { status: 'done', mode: 'apply', processed: 3, changed: 2 },
    })
    expect(store[lead('l1')]['visibleTo']).toEqual([A, 'org'])
    expect(store[lead('l2')]['visibleTo']).toEqual([A, 'org'])
    // Captured on B: untouched.
    expect(store[lead('l3')]['visibleTo']).toEqual([B])
    // B sees them — and so does a site created after the rule.
    expect(listedOn('l1', 'site-b')).toBe(true)
    expect(listedOn('l1', 'site-created-later')).toBe(true)
    // Stored on the org document, beside the org's other CRM settings.
    expect((read(store[`orgs/${ORG}`], ['crm', 'sharingRules']) as unknown[]).length).toBe(1)
  })

  it('shares every lead captured on A afterwards, through the record-written seam', async () => {
    await call({ orgId: ORG, action: 'rule-save', rule })
    store[lead('l4')] = captured('site-a', 'four@acme.test')
    store[lead('l5')] = captured('site-b', 'five@acme.test')
    await crmSharingRecordWritten({ path: lead('l4'), collection: 'leads' })
    await crmSharingRecordWritten({ path: lead('l5'), collection: 'leads' })
    expect(store[lead('l4')]['visibleTo']).toEqual([A, 'org'])
    expect(store[lead('l5')]['visibleTo']).toEqual([B])
    // A collection the sharing does not cover is none of its business.
    await crmSharingRecordWritten({ path: `orgs/${ORG}/crmTasks/t1`, collection: 'crmTasks' })
  })

  it('removes only the visibility it granted when it is deleted', async () => {
    const saved = await call({ orgId: ORG, action: 'rule-save', rule })
    const ruleId = (saved.payload['rule'] as { id: string }).id
    // l1 is ALSO shared with B by hand.
    await call({ orgId: ORG, action: 'share', object: 'leads', ids: ['l1'], targets: ['site-b'] })
    expect(store[lead('l1')]['visibleTo']).toEqual([A, B, 'org'])

    const deleted = await call({ orgId: ORG, action: 'rule-delete', ruleId })
    expect(deleted.payload).toMatchObject({ ok: true, more: false, rule: null })
    expect(store[lead('l1')]['visibleTo']).toEqual([A, B])
    expect(store[lead('l2')]['visibleTo']).toEqual([A])
    expect('sharing' in store[lead('l2')]).toBe(false)
    expect(read(store[`orgs/${ORG}`], ['crm', 'sharingRules'])).toEqual([])
  })

  it('takes its grants away when it is switched off, and keeps the rule', async () => {
    const saved = await call({ orgId: ORG, action: 'rule-save', rule })
    const id = (saved.payload['rule'] as { id: string }).id
    const off = await call({ orgId: ORG, action: 'rule-save', rule: { ...rule, id, enabled: false } })
    expect(off.payload['rule']).toMatchObject({ enabled: false, run: { status: 'done', mode: 'remove', changed: 2 } })
    expect(store[lead('l1')]['visibleTo']).toEqual([A])
  })

  it('never takes a grant away on a stale cached list', async () => {
    await call({ orgId: ORG, action: 'rule-save', rule })
    expect(store[lead('l1')]['visibleTo']).toEqual([A, 'org'])
    // This process cached the org before the rule existed — as a process
    // that is not the one the rule was saved in may have.
    const withRule = store[`orgs/${ORG}`]
    store[`orgs/${ORG}`] = { name: 'Acme' }
    await crmSharingRulesOf(firestoreHandle as never, ORG, { fresh: true })
    store[`orgs/${ORG}`] = withRule
    // A hand act on the lead recomputes it on that stale list: the rule's
    // grant is unknown to it, so the org is read again before anything goes.
    await call({ orgId: ORG, action: 'unshare', object: 'leads', ids: ['l1'], targets: ['site-b'] })
    expect(store[lead('l1')]['visibleTo']).toEqual([A, 'org'])
  })

  it('refuses a rule that names a site outside the org, or no name', async () => {
    expect((await call({ orgId: ORG, action: 'rule-save', rule: { ...rule, sourceHostIds: ['site-x'] } })).status).toBe(400)
    expect((await call({ orgId: ORG, action: 'rule-save', rule: { ...rule, name: ' ' } })).status).toBe(400)
    expect(read(store[`orgs/${ORG}`], ['crm', 'sharingRules'])).toBeUndefined()
  })
})

describe('the follow-up a client-direct write owes (AGL-3336)', () => {
  it('re-evaluates the named records for a CRM writer', async () => {
    await call({ orgId: ORG, action: 'rule-save', rule: { name: 'All', object: 'leads', targets: ['site-a'] } })
    store[lead('l6')] = captured('site-b', 'six@acme.test')
    const out = await call({ hostId: 'site-b', action: 'evaluate', object: 'leads', ids: ['l6'] })
    expect(out).toEqual({ status: 200, payload: { ok: true, changed: 1, missing: 0 } })
    expect(store[lead('l6')]['visibleTo']).toEqual([B, A])
    expect(authorizeCrmWriter).toHaveBeenCalled()
  })
})
