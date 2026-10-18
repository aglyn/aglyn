/**
 * @jest-environment node
 */
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

import type { RegisteredPluginSearchSource } from '@aglyn/aglyn/plugin-manager/plugin-search-sources'
import type { ListQueryPlan } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  ONE_BOX_WINDOW,
  runOneBoxSearch,
  type OneBoxDoc,
  type OneBoxSearchInput,
  type OneBoxStore,
} from './one-box-search'

/**
 * The one box's server (AGL-3943). The Admin SDK reads past the rules, so
 * the engine IS the access control here: these cases pin that a member of
 * workspace A never sees workspace B — not its name in the switcher, not
 * its sites, not its records, not by naming it — and that every gate the
 * palette applies (plugin on, plan flag, permission, site role, visibleTo)
 * holds on the server too.
 */

type Docs = Record<string, Record<string, unknown>>

/** An in-memory Firestore over full document paths. */
function memoryStore(docs: Docs): OneBoxStore & { reads: string[] } {
  const reads: string[] = []
  const inCollection = (path: string): OneBoxDoc[] =>
    Object.keys(docs)
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .sort()
      .map((key) => ({ id: key.slice(path.length + 1), data: docs[key] }))
  const holds = (data: Record<string, unknown>, filter: { path: string; op: string; value: unknown }) => {
    const field = data[filter.path]
    if (filter.op === '==') return field === filter.value
    if (filter.op === 'array-contains') return Array.isArray(field) && field.includes(filter.value)
    if (filter.op === 'array-contains-any') {
      return Array.isArray(field) && (filter.value as unknown[]).some((entry) => field.includes(entry))
    }
    throw new Error(`unsupported ${filter.op}`)
  }
  return {
    reads,
    async get(path) {
      reads.push(path)
      return docs[path] ?? null
    },
    async window(path, { where, limit, startAfterId }) {
      reads.push(path)
      let rows = inCollection(path)
      if (where) rows = rows.filter((row) => holds(row.data, { path: where.field, op: where.op, value: where.value }))
      if (startAfterId) rows = rows.filter((row) => row.id > startAfterId)
      return rows.slice(0, limit)
    },
    async planned(path, plan: ListQueryPlan, limit) {
      reads.push(path)
      const { path: by, direction } = plan.orderBy
      return inCollection(path)
        .filter((row) => plan.filters.every((filter) => holds(row.data, filter as never)))
        .sort((a, b) => {
          const delta = Number(a.data[by] ?? 0) - Number(b.data[by] ?? 0)
          return direction === 'desc' ? -delta : delta
        })
        .slice(0, limit)
    },
  }
}

const CONTACTS: RegisteredPluginSearchSource = {
  pluginId: 'crm',
  gates: { featureFlag: 'crm', permission: 'data.manage' },
  source: {
    id: 'contacts',
    group: 'Contacts',
    noun: 'contacts',
    scope: 'orgData',
    collection: 'contacts',
    nameField: 'name',
    fallbackNameField: 'email',
    extraFields: ['email'],
    order: 40,
    href: (row, { orgSlug }) => `/${orgSlug}/crm/contacts/${String(row['$id'])}`,
  },
}

const ORDERS: RegisteredPluginSearchSource = {
  pluginId: 'commerce',
  gates: {},
  source: {
    id: 'orders',
    group: 'Orders',
    noun: 'orders',
    scope: 'host',
    collection: 'orders',
    nameField: 'number',
    featureFlag: 'commerce',
    hostAccess: 'sensitive',
    listQuery: {
      fields: [],
      sorts: [{ path: 'createdAtMs', direction: 'desc' }],
      search: { tokensPath: 'searchTokens' },
    },
    order: 50,
    label: (row) => `#${String(row['number'])}`,
    detail: (row) => (typeof row['customerEmail'] === 'string' ? row['customerEmail'] : null),
    href: (row, { orgSlug, host }) =>
      host ? `/${orgSlug}/hosts/${host}/products/orders?order=${String(row['$id'])}` : null,
  },
}

/** Two workspaces. Ana belongs to A only; Bo owns B. */
function world(): Docs {
  return {
    'users/ana/orgs/org-a': { orgName: 'Acme Bakery', slug: 'acme' },
    'users/ana/hostMemberships/site-a': { orgId: 'org-a', displayName: 'Acme Shop', subdomain: 'acme-shop' },
    'users/bo/orgs/org-b': { orgName: 'Acme Rival', slug: 'rival' },
    'users/bo/hostMemberships/site-b': { orgId: 'org-b', displayName: 'Acme Rival Shop', subdomain: 'rival-shop' },
    'orgs/org-a': { slug: 'acme', plan: 'business' },
    'orgs/org-b': { slug: 'rival', plan: 'business' },
    'orgs/org-a/members/ana': { role: 'owner' },
    'orgs/org-b/members/bo': { role: 'owner' },
    'hosts/site-a': { orgId: 'org-a', subdomain: 'acme-shop', memberRoles: { ana: 'admin' } },
    'hosts/site-b': { orgId: 'org-b', subdomain: 'rival-shop', memberRoles: { bo: 'admin' } },
    'hosts/site-a/screens/s1': { displayName: 'Acme home', versionId: 'v1' },
    'hosts/site-b/screens/s9': { displayName: 'Acme secret plans', versionId: 'v9' },
    'orgs/org-a/contacts/c1': { name: 'Acme buyer', visibleTo: ['org'] },
    'orgs/org-b/contacts/c9': { name: 'Acme rival buyer', visibleTo: ['org'] },
    'hosts/site-a/orders/o1': { number: 1042, customerEmail: 'maya@example.com', searchTokens: ['maya'], createdAtMs: 2 },
    'hosts/site-a/orders/o2': { number: 1043, customerEmail: 'maya@example.com', searchTokens: ['maya'], createdAtMs: 3 },
  }
}

function input(overrides: Partial<OneBoxSearchInput> & { docs?: Docs } = {}): OneBoxSearchInput {
  const { docs = world(), ...rest } = overrides
  return {
    store: memoryStore(docs),
    uid: 'ana',
    text: 'acme',
    limit: 5,
    sources: [CONTACTS, ORDERS],
    permissions: async () => ({ 'data.manage': true }),
    releaseFilter: async (ids) => [...ids],
    ...rest,
  }
}

const labels = (body: { groups: Array<{ group: string; rows: Array<{ label: string }> }> }, group: string) =>
  body.groups.find((entry) => entry.group === group)?.rows.map((row) => row.label) ?? []

describe('the one box answers only what the caller may open', () => {
  it('CONTROL: a member of A finds A, its site, its pages and its people', async () => {
    const result = await runOneBoxSearch(input({ orgId: 'org-a', hostId: 'site-a' }))
    if (result.status !== 200) throw new Error(result.error)
    expect(labels(result.body, 'workspaces')).toEqual(['Acme Bakery'])
    expect(labels(result.body, 'sites')).toEqual(['Acme Shop'])
    expect(labels(result.body, 'screens')).toEqual(['Acme home'])
    expect(labels(result.body, 'contacts')).toEqual(['Acme buyer'])
    const site = result.body.groups.find((group) => group.group === 'sites')?.rows[0]
    expect(site?.link).toBe('/acme/hosts/acme-shop')
  })

  it('a member of A never sees B: not its workspace, its sites or its records', async () => {
    const result = await runOneBoxSearch(input())
    if (result.status !== 200) throw new Error(result.error)
    const everything = JSON.stringify(result.body)
    expect(everything).not.toContain('Rival')
    expect(everything).not.toContain('org-b')
    expect(labels(result.body, 'workspaces')).toEqual(['Acme Bakery'])
  })

  it('a member of A naming B is refused before any of B is read', async () => {
    const store = memoryStore(world())
    const result = await runOneBoxSearch(input({ store, orgId: 'org-b', hostId: 'site-b' }))
    expect(result).toEqual({ status: 403, error: 'You are not a member of this workspace' })
    expect(store.reads.filter((path) => path.includes('org-b') || path.includes('site-b'))).toEqual([
      'orgs/org-b/members/ana',
    ])
  })

  it('refuses a site of another workspace named under A', async () => {
    const result = await runOneBoxSearch(input({ orgId: 'org-a', hostId: 'site-b' }))
    expect(result).toEqual({ status: 404, error: 'No such site in this workspace' })
  })

  it('refuses a site of A the caller is not on', async () => {
    const docs = world()
    docs['orgs/org-a/members/cy'] = { role: 'editor', allHosts: false, hostAccess: { other: 'editor' } }
    docs['users/cy/orgs/org-a'] = { orgName: 'Acme Bakery', slug: 'acme' }
    const result = await runOneBoxSearch(input({ docs, uid: 'cy', orgId: 'org-a', hostId: 'site-a' }))
    expect(result).toEqual({ status: 403, error: 'You are not a member of this site' })
  })

  it('holds orders to the admin and editor site roles, and reads them on the list query', async () => {
    const asAdmin = await runOneBoxSearch(input({ text: 'maya', orgId: 'org-a', hostId: 'site-a' }))
    if (asAdmin.status !== 200) throw new Error(asAdmin.error)
    const orders = asAdmin.body.groups.find((group) => group.group === 'orders')
    expect(orders?.rows.map((row) => [row.label, row.detail])).toEqual([
      ['#1043', 'maya@example.com'],
      ['#1042', 'maya@example.com'],
    ])
    expect(orders?.rows[0].link).toBe('/acme/hosts/acme-shop/products/orders?order=o2')

    const docs = world()
    ;(docs['hosts/site-a'] as { memberRoles: Record<string, string> }).memberRoles.ana = 'author'
    const asAuthor = await runOneBoxSearch(input({ docs, text: 'maya', orgId: 'org-a', hostId: 'site-a' }))
    if (asAuthor.status !== 200) throw new Error(asAuthor.error)
    expect(asAuthor.body.groups.map((group) => group.group)).not.toContain('orders')
  })

  it('leaves out a group whose plugin is off, whose plan lacks it, or whose permission is not held', async () => {
    const off = await runOneBoxSearch(
      input({ orgId: 'org-a', hostId: 'site-a', releaseFilter: async (ids) => ids.filter((id) => id !== 'crm') }),
    )
    const free = world()
    free['orgs/org-a'] = { slug: 'acme', plan: 'free' }
    const unplanned = await runOneBoxSearch(input({ docs: free, orgId: 'org-a', hostId: 'site-a' }))
    const refused = await runOneBoxSearch(
      input({ orgId: 'org-a', hostId: 'site-a', permissions: async () => ({ 'data.manage': false }) }),
    )
    for (const result of [off, unplanned, refused]) {
      if (result.status !== 200) throw new Error(result.error)
      expect(result.body.groups.map((group) => group.group)).not.toContain('contacts')
    }
  })

  it('holds org-shared rows to the scoped member’s reach', async () => {
    const docs = world()
    docs['orgs/org-a/members/cy'] = { role: 'editor', allHosts: false, hostAccess: { 'site-a': 'editor' }, scopeTokens: ['host:site-a'] }
    docs['users/cy/orgs/org-a'] = { orgName: 'Acme Bakery', slug: 'acme' }
    ;(docs['hosts/site-a'] as { memberRoles: Record<string, string> }).memberRoles.cy = 'editor'
    docs['orgs/org-a/contacts/c2'] = { name: 'Acme other site buyer', visibleTo: ['host:site-z'] }
    docs['orgs/org-a/contacts/c3'] = { name: 'Acme this site buyer', visibleTo: ['host:site-a'] }
    const onSite = await runOneBoxSearch(input({ docs, uid: 'cy', orgId: 'org-a', hostId: 'site-a' }))
    if (onSite.status !== 200) throw new Error(onSite.error)
    expect(labels(onSite.body, 'contacts')).toEqual(['Acme this site buyer'])
    // Off a site, a scoped member is not offered the org's shared records at all.
    const offSite = await runOneBoxSearch(input({ docs, uid: 'cy', orgId: 'org-a' }))
    if (offSite.status !== 200) throw new Error(offSite.error)
    expect(offSite.body.groups.map((group) => group.group)).not.toContain('contacts')
  })

  it('finds screens and settings from the nav manifest, by plugin and role', async () => {
    const result = await runOneBoxSearch(input({ text: 'billing', orgId: 'org-a' }))
    if (result.status !== 200) throw new Error(result.error)
    const screens = result.body.groups.find((group) => group.group === 'appScreens')
    expect(screens?.rows.map((row) => row.label)).toEqual(expect.arrayContaining(['Plan', 'Invoices']))
    expect(screens?.rows.find((row) => row.label === 'Plan')?.screen).toBe('core.billing')
  })

  it('pages one group with a cursor', async () => {
    const docs = world()
    for (let i = 0; i < 12; i += 1) docs[`hosts/site-a/screens/p${String(i).padStart(2, '0')}`] = { displayName: `Acme page ${i}`, versionId: 'v' }
    const first = await runOneBoxSearch(input({ docs, orgId: 'org-a', hostId: 'site-a', group: 'screens', limit: 5 }))
    if (first.status !== 200) throw new Error(first.error)
    expect(first.body.groups.map((group) => group.group)).toEqual(['screens'])
    expect(first.body.groups[0].rows).toHaveLength(5)
    expect(first.body.groups[0].matched).toBe(13)
    expect(first.body.groups[0].nextCursor).toBe(5)
    const last = await runOneBoxSearch(
      input({ docs, orgId: 'org-a', hostId: 'site-a', group: 'screens', limit: 5, cursor: 10 }),
    )
    if (last.status !== 200) throw new Error(last.error)
    expect(last.body.groups[0].rows).toHaveLength(3)
    expect(last.body.groups[0].nextCursor).toBeUndefined()
  })

  it('widens a full window that matched nothing, once', async () => {
    const docs = world()
    for (let i = 0; i < ONE_BOX_WINDOW; i += 1) docs[`hosts/site-a/screens/a${String(i).padStart(3, '0')}`] = { displayName: `Page ${i}` }
    docs['hosts/site-a/screens/zz'] = { displayName: 'Pricing', versionId: 'v' }
    const result = await runOneBoxSearch(input({ docs, text: 'pric', orgId: 'org-a', hostId: 'site-a', group: 'screens' }))
    if (result.status !== 200) throw new Error(result.error)
    expect(labels(result.body, 'screens')).toEqual(['Pricing'])
  })
})
