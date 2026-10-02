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

/**
 * The staff Sites list (AGL-3378) is filtered and searched on its route's
 * query, and each row carries the organization and owner staff act on.
 *
 * Every clause and the search word are planned onto one Firestore query over
 * `hosts` (`STAFF_SITE_LIST_QUERY`); nothing is matched after it runs. The
 * page's organizations are read in one `getAll` and their owners in one
 * resolve, so a row names who to contact without a read per row.
 */

let ordering: Array<[string, string]> = []
let wheres: Array<[string, string, unknown]> = []
let hosts: Array<{ id: string; data: Record<string, unknown> }> = []
let orgs: Record<string, Record<string, unknown>> = {}
let claims: Record<string, unknown> = {}

const snap = (collection: string, id: string, data: Record<string, unknown> | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (key: string) => data?.[key],
  ref: { id, path: `${collection}/${id}` },
})

const pathOf = (field: unknown) => (typeof field === 'string' ? field : '__name__')

function hostQuery(): any {
  return {
    orderBy: (field: unknown, direction = 'asc') => {
      ordering.push([pathOf(field), direction])
      return hostQuery()
    },
    where: (field: unknown, op: string, value: unknown) => {
      wheres.push([pathOf(field), op, value])
      return hostQuery()
    },
    startAfter: () => hostQuery(),
    limit: () => hostQuery(),
    get: async () => ({ docs: hosts.map((h) => snap('hosts', h.id, h.data)) }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => (global as any).__claims() }),
      firestore: () => ({
        collection: (name: string) =>
          name === 'hosts'
            ? (global as any).__hostQuery()
            : { doc: (id: string) => ({ __org: id }) },
        doc: (path: string) => ({ get: async () => snap('x', path, undefined) }),
        getAll: async (...refs: Array<{ __org: string }>) =>
          refs.map((ref) => snap('orgs', ref.__org, (global as any).__orgs()[ref.__org])),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveUidsToPeople: async (uids: string[]) =>
    Object.fromEntries(
      uids
        .filter(Boolean)
        .map((uid) => [uid, { uid, email: `${uid}@example.com`, displayName: null, source: 'auth' }]),
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/server') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))
;(global as any).__hostQuery = () => hostQuery()
;(global as any).__orgs = () => orgs
;(global as any).__claims = () => claims

import { GET } from '../app/api/admin/sites/route'

const get = (params: Record<string, string> = {}) => {
  const url = new URL('https://console.test/api/admin/sites')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(new Request(url.toString(), { headers: { authorization: 'Bearer t' } }))
}

beforeEach(() => {
  ordering = []
  wheres = []
  claims = { uid: 'staff-1', email_verified: true, staff: true }
  orgs = { 'org-1': { name: 'Harbor Co', slug: 'harbor', plan: 'pro', ownerUid: 'owner-1' } }
  hosts = [
    {
      id: 'host-1',
      data: {
        displayName: 'Harbor Bakery',
        subdomain: 'harbor-bakery',
        cname: 'harbor.com',
        orgId: 'org-1',
        screens: { home: '/', about: 'about' },
        suspendedAt: 1,
        suspendedUntilMs: 2,
      },
    },
    { id: 'host-2', data: { displayName: 'Stray', subdomain: 'stray', orgId: 'gone' } },
  ]
})

describe('the staff Sites list', () => {
  it('is staff only', async () => {
    claims = { uid: 'u1', email_verified: true }
    expect((await get()).status).toBe(403)
  })

  it('refuses unreadable filters rather than listing everything', async () => {
    expect((await get({ filters: '{not json' })).status).toBe(400)
  })

  it('walks every site in document-id order, and searches on the query', async () => {
    const response = await get({ search: 'Bakery' })
    expect(response.status).toBe(200)
    expect(ordering).toEqual([['__name__', 'asc']])
    expect(wheres).toEqual([['searchTokens', 'array-contains', 'bakery']])
  })

  it('puts an organization filter on the query', async () => {
    const filters = JSON.stringify([{ field: 'orgId', op: 'equals', value: 'org-1' }])
    expect((await get({ filters })).status).toBe(200)
    expect(wheres).toEqual([['orgId', '==', 'org-1']])
  })

  it('names the organization, its owner, the home page and the live state', async () => {
    const { sites } = await (await get()).json()
    expect(sites[0]).toMatchObject({
      $id: 'host-1',
      org: { $id: 'org-1', name: 'Harbor Co', ownerUid: 'owner-1' },
      owner: { uid: 'owner-1', email: 'owner-1@example.com' },
      publishedPages: 2,
      homeScreenId: 'home',
      // The suspension window closed long ago, with no write.
      suspended: false,
    })
    // The routing map itself is not shipped.
    expect(sites[0]).not.toHaveProperty('screens')
  })

  it('lists a site whose organization is gone, rather than hiding it', async () => {
    const { sites } = await (await get()).json()
    expect(sites[1]).toMatchObject({ $id: 'host-2', orgId: 'gone', org: null, owner: null })
  })

  /*
   * The leaving notice (AGL-3452): the site page says whether this site sends
   * outside links through "You're leaving" and until when, read from the same
   * rule the published site applies.
   */
  it('says until when a young free workspace’s sites carry the leaving notice', async () => {
    const createdAt = Date.now() - 3 * 86_400_000
    orgs = { 'org-1': { name: 'New Co', plan: 'free', ownerUid: 'owner-1', createdAt } }
    const { sites } = await (await get()).json()
    expect(sites[0].org.leavingNoticeUntil).toBe(createdAt + 14 * 86_400_000)
  })

  it('says it is off for a paid workspace, and for an older free one', async () => {
    const createdAt = Date.now() - 3 * 86_400_000
    orgs = {
      'org-1': { name: 'Paid Co', plan: 'pro', billingStatus: 'active', createdAt },
    }
    expect((await (await get()).json()).sites[0].org.leavingNoticeUntil).toBeNull()
    orgs = {
      'org-1': { name: 'Old Co', plan: 'free', createdAt: Date.now() - 40 * 86_400_000 },
    }
    expect((await (await get()).json()).sites[0].org.leavingNoticeUntil).toBeNull()
  })
})
