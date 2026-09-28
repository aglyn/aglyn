/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

import { FieldValue } from 'firebase-admin/firestore'

/*
 * Moving a site to another organization (AGL-3381): what moves, what stays,
 * and what refuses — against a store that keeps every collection apart, so a
 * write to the wrong organization shows up as one.
 */

type Doc = Record<string, any>
const store = new Map<string, Doc>()
const calls: string[] = []

const isDelete = (value: unknown) =>
  value !== null && typeof value === 'object' && FieldValue.delete().isEqual(value as never)
const isSentinel = (value: unknown) =>
  value !== null && typeof value === 'object' && typeof (value as any).isEqual === 'function'

/** A merge-set: nested maps merge, `FieldValue.delete()` removes. */
function mergeInto(target: Doc, patch: Doc): Doc {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (isDelete(value)) delete next[key]
    else if (isSentinel(value)) next[key] = '__sentinel__'
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeInto(next[key] && typeof next[key] === 'object' ? next[key] : {}, value)
    } else next[key] = value
  }
  return next
}

/** An update: dotted paths address nested fields. */
function updateInto(target: Doc, patch: Doc): Doc {
  const next = JSON.parse(JSON.stringify(target))
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let at = next
    for (const key of keys.slice(0, -1)) at = at[key] ??= {}
    const last = keys[keys.length - 1]
    if (isDelete(value)) delete at[last]
    else at[last] = isSentinel(value) ? '__sentinel__' : value
  }
  return next
}

function docRef(path: string): any {
  const id = path.split('/').pop() as string
  const snapshot = () => {
    const data = store.get(path)
    return {
      id,
      ref: docRef(path),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  return {
    id,
    path,
    get: async () => snapshot(),
    set: async (data: Doc, options?: { merge?: boolean }) => {
      store.set(path, options?.merge ? mergeInto(store.get(path) ?? {}, data) : mergeInto({}, data))
    },
    update: async (data: Doc) => {
      if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`)
      store.set(path, updateInto(store.get(path) as Doc, data))
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    __snapshot: snapshot,
  }
}

function collectionRef(path: string, filters: Array<[string, string, any]> = []): any {
  const matches = () =>
    [...store.keys()]
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .filter((key) =>
        filters.every(([field, op, value]) => {
          const stored = store.get(key)?.[field]
          if (op === '==') return stored === value
          if (op === 'in') return (value as unknown[]).includes(stored)
          if (op === 'array-contains') return Array.isArray(stored) && stored.includes(value)
          throw new Error(`op ${op}`)
        }),
      )
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      collectionRef(path, [...filters, [field, op, value]]),
    count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
    get: async () => {
      const docs = matches().map((key) => docRef(key).__snapshot())
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  }
}

const db = {
  collection: (name: string) => collectionRef(name),
  doc: (path: string) => docRef(path),
  batch: () => {
    const ops: Array<() => Promise<void>> = []
    return {
      update: (ref: any, data: Doc) => ops.push(() => ref.update(data)),
      set: (ref: any, data: Doc, options?: any) => ops.push(() => ref.set(data, options)),
      delete: (ref: any) => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op()
      },
    }
  },
  runTransaction: async (body: (tx: any) => Promise<unknown>) => {
    const writes: Array<() => Promise<void>> = []
    const result = await body({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: Doc, options?: any) => writes.push(() => ref.set(data, options)),
      update: (ref: any, data: Doc) => writes.push(() => ref.update(data)),
    })
    for (const write of writes) await write()
    return result
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => db }) },
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))
jest.mock('./organizations', () => ({
  __esModule: true,
  syncOrgAuthProjections: async (orgId: string, hostId?: string) => {
    calls.push(`syncOrgAuthProjections ${orgId}${hostId ? ` ${hostId}` : ''}`)
  },
}))
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteHostProjectionForAllMembers: async (orgId: string, hostId: string) => {
    calls.push(`deleteHostProjectionForAllMembers ${orgId} ${hostId}`)
  },
  syncHostProjectionForMembers: async (orgId: string, hostId: string) => {
    calls.push(`syncHostProjectionForMembers ${orgId} ${hostId}`)
  },
}))
jest.mock('./host-sending-domain', () => ({ __esModule: true, SENDING_LABELS_COLLECTION: 'sendingLabels' }))
jest.mock('./sending-domains', () => ({ __esModule: true, SENDING_DOMAINS_COLLECTION: 'sendingDomains' }))
jest.mock('./tracking-hosts', () => ({ __esModule: true, TRACKING_HOSTS_COLLECTION: 'trackingHosts' }))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-host-collections', () => ({
  __esModule: true,
  listPluginOrgCollections: () => [
    {
      pluginId: 'marketing',
      name: 'campaigns',
      siteField: 'hostId',
      holdsTransferWhile: { field: 'status', values: ['scheduled', 'sending'] },
    },
    { pluginId: 'marketing', name: 'emailCampaigns' },
  ],
}))
// The plan's entitlement gates, reduced to the fields these fixtures set.
jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  __esModule: true,
  checkQuota: (org: any, _quota: string, used: number) => {
    const limit = Number(org?.siteLimitForSpec ?? 10)
    return { allowed: used < limit, limit, remaining: Math.max(0, limit - used) }
  },
}))
jest.mock('@aglyn/aglyn/app-utils/dedicated-sending-domain', () => ({
  __esModule: true,
  holdsDedicatedSendingDomain: (org: any) => org?.dedicatedForSpec === true,
}))

import { HostTransferRefusedError, planHostTransfer, transferHost } from './transfer-host'

const seed = (entries: Record<string, Doc>) => {
  for (const [path, data] of Object.entries(entries)) store.set(path, data)
}

beforeEach(() => {
  store.clear()
  calls.length = 0
  seed({
    'hosts/h1': { displayName: 'Harbor', subdomain: 'harbor', orgId: 'from', screens: { s1: '/' } },
    'hostIndex/h1': { orgId: 'from', subdomain: 'harbor' },
    'orgs/from': {
      name: 'Old Co',
      hosts: { h1: true, h2: true },
      registerAllocations: { h1: 2, h2: 1 },
      collaboratorAllocations: { h1: 3 },
    },
    'orgs/to': { name: 'New Co', hosts: { h9: true } },
    'orgs/from/members/owner': { role: 'owner', allHosts: true },
    'orgs/from/members/collab': {
      role: 'editor',
      allHosts: false,
      hostAccess: { h1: 'editor', h2: 'viewer' },
      hostPermissions: { h1: { ai: true } },
    },
    'orgs/from/media/m1': { visibleTo: ['host:h1'] },
    'orgs/from/media/m2': { visibleTo: ['org'] },
    'orgs/from/campaigns/c1': { hostId: 'h1', status: 'sent' },
  })
})

describe('planning a site transfer', () => {
  it('says what stays with the old organization, and refuses nothing it need not', async () => {
    const plan = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(plan.holds).toEqual([])
    expect(plan.facts.mediaStaying).toBe(1)
    expect(plan.facts.ownedDocumentsStaying).toEqual([{ collection: 'campaigns', count: 1 }])
    expect(plan.facts.collaboratorsLosingAccess).toBe(1)
    expect(plan.fromOrgName).toBe('Old Co')
    expect(plan.toOrgName).toBe('New Co')
  })

  it('refuses a move to the organization the site is already in', async () => {
    const plan = await planHostTransfer({ hostId: 'h1', toOrgId: 'from' })
    expect(plan.holds.map((hold) => hold.code)).toEqual(['same-organization'])
  })

  it('refuses a site in a consent group, whose opt-outs its siblings read', async () => {
    seed({
      'orgs/from': {
        ...store.get('orgs/from'),
        consentGroups: { g1: { name: 'Shops', hostIds: ['h1', 'h2'] } },
      },
    })
    const plan = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(plan.holds.map((hold) => hold.code)).toContain('consent-group')
  })

  it('refuses at the destination site limit, unless staff override it', async () => {
    seed({ 'orgs/to': { name: 'New Co', hosts: { h9: true }, siteLimitForSpec: 1 } })
    const held = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(held.holds.map((hold) => hold.code)).toEqual(['site-limit'])
    const overridden = await planHostTransfer({ hostId: 'h1', toOrgId: 'to', overrideSiteLimit: true })
    expect(overridden.holds).toEqual([])
    expect(overridden.warnings.join(' ')).toMatch(/past it/)
  })

  it('refuses while a send made as the site is still scheduled', async () => {
    seed({ 'orgs/from/campaigns/c2': { hostId: 'h1', status: 'scheduled' } })
    const plan = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(plan.holds.map((hold) => hold.code)).toEqual(['in-flight'])
  })

  it('refuses a dedicated sending domain the destination plan cannot hold', async () => {
    seed({ 'hosts/h1': { ...store.get('hosts/h1'), sendingLabel: 'harbor', sendingDomain: 'harbor.mail.example' } })
    const held = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(held.holds.map((hold) => hold.code)).toEqual(['sending-domain'])
    seed({ 'orgs/to': { ...store.get('orgs/to'), dedicatedForSpec: true } })
    const allowed = await planHostTransfer({ hostId: 'h1', toOrgId: 'to' })
    expect(allowed.holds).toEqual([])
  })
})

describe('transferring a site', () => {
  it('writes nothing when the plan holds', async () => {
    const before = new Map(store)
    await expect(transferHost({ hostId: 'h1', toOrgId: 'from' })).rejects.toBeInstanceOf(
      HostTransferRefusedError,
    )
    expect(store).toEqual(before)
    expect(calls).toEqual([])
  })

  it('moves ownership, releases the old seats, and rebuilds both rosters’ projections', async () => {
    await transferHost({ hostId: 'h1', toOrgId: 'to' })
    expect(store.get('hosts/h1')?.['orgId']).toBe('to')
    expect(store.get('hostIndex/h1')?.['orgId']).toBe('to')
    expect(store.get('orgs/from')?.['hosts']).toEqual({ h2: true })
    expect(store.get('orgs/from')?.['registerAllocations']).toEqual({ h2: 1 })
    expect(store.get('orgs/from')?.['collaboratorAllocations']).toEqual({})
    expect(store.get('orgs/to')?.['hosts']).toEqual({ h9: true, h1: true })
    // The collaborator keeps the OTHER site, and loses this one.
    expect(store.get('orgs/from/members/collab')?.['hostAccess']).toEqual({ h2: 'viewer' })
    expect(store.get('orgs/from/members/collab')?.['hostPermissions']).toEqual({})
    expect(calls).toEqual([
      'deleteHostProjectionForAllMembers from h1',
      'syncOrgAuthProjections from',
      'syncOrgAuthProjections to h1',
      'syncHostProjectionForMembers to h1',
    ])
    // History and media stay where they were.
    expect(store.has('orgs/from/campaigns/c1')).toBe(true)
    expect(store.has('orgs/from/media/m1')).toBe(true)
  })

  it('moves a dedicated sending domain, its tracking host and its claim', async () => {
    seed({
      'hosts/h1': { ...store.get('hosts/h1'), sendingLabel: 'harbor', sendingDomain: 'harbor.mail.example' },
      'orgs/to': { ...store.get('orgs/to'), dedicatedForSpec: true },
      'orgs/from/sendingDomains/harbor.mail.example': { providerDomainId: 'p1' },
      'orgs/from/trackingHosts/harbor.mail.example': { status: 'serving' },
      'sendingLabels/harbor': { orgId: 'from', hostId: 'h1' },
    })
    await transferHost({ hostId: 'h1', toOrgId: 'to' })
    expect(store.has('orgs/from/sendingDomains/harbor.mail.example')).toBe(false)
    expect(store.get('orgs/to/sendingDomains/harbor.mail.example')).toEqual({ providerDomainId: 'p1' })
    expect(store.get('orgs/to/trackingHosts/harbor.mail.example')).toEqual({ status: 'serving' })
    expect(store.get('sendingLabels/harbor')?.['orgId']).toBe('to')
  })
})
