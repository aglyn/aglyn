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

/**
 * THE STAFF AUDIT LOG FOR THE APPS (AGL-3667).
 *
 * `/api/admin/audit-log` reads `adminAudit` with the page's own filters
 * (planned onto one Firestore query), words each row the way the page words
 * it, and builds the compliance export. Staff only.
 */

let ordering: Array<[string, string]> = []
let wheres: Array<[string, string, unknown]> = []
let entries: Array<{ id: string; data: Record<string, unknown> }> = []
let claims: Record<string, unknown> = {}

const snap = (id: string, data: Record<string, unknown>) => ({
  id,
  exists: true,
  data: () => data,
  get: (key: string) => data[key],
  ref: { id, path: `adminAudit/${id}` },
})

const pathOf = (field: unknown) => (typeof field === 'string' ? field : '__name__')

function auditQuery(): any {
  return {
    orderBy: (field: unknown, direction = 'asc') => {
      ordering.push([pathOf(field), direction])
      return auditQuery()
    },
    where: (field: unknown, op: string, value: unknown) => {
      wheres.push([pathOf(field), op, value])
      return auditQuery()
    },
    startAfter: () => auditQuery(),
    limit: (count: number) => ({
      get: async () => ({ docs: entries.slice(0, count).map((entry) => snap(entry.id, entry.data)) }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => (global as any).__claims() }),
      firestore: () => ({
        collection: () => (global as any).__auditQuery(),
        doc: () => ({ get: async () => ({ exists: false }) }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
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
;(global as any).__auditQuery = () => auditQuery()
;(global as any).__claims = () => claims

import { GET } from '../app/api/admin/audit-log/route'

const get = (params: Record<string, string> = {}) => {
  const url = new URL('https://console.test/api/admin/audit-log')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(new Request(url.toString(), { headers: { authorization: 'Bearer t' } }))
}

beforeEach(() => {
  ordering = []
  wheres = []
  claims = { uid: 'staff-1', email_verified: true, staff: true }
  entries = [
    {
      id: 'a1',
      data: {
        action: 'org.override',
        scope: 'org',
        target: 'orgs/org-1',
        actorUid: 'staff-1',
        actorEmail: 'staff@example.test',
        at: { seconds: 1_760_000_000 },
        reason: 'goodwill',
        note: 'a make-good',
        before: { plan: 'free' },
        after: { plan: 'pro' },
      },
    },
    {
      id: 'a2',
      data: { action: 'org.override', scope: 'org', target: 'orgs/org-2', actorUid: 'staff-1', at: { seconds: 1_759_000_000 } },
    },
  ]
})

describe('the staff audit log route', () => {
  it('is staff only', async () => {
    claims = { uid: 'u1', email_verified: true }
    expect((await get()).status).toBe(403)
  })

  it('refuses unreadable filters rather than listing everything', async () => {
    expect((await get({ filters: '{nope' })).status).toBe(400)
  })

  it('reads newest first and words each row the way the page words it', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(ordering).toEqual([['at', 'desc']])
    const { rows } = await response.json()
    expect(rows[0]).toMatchObject({
      $id: 'a1',
      code: 'org.override',
      scope: 'org',
      actorEmail: 'staff@example.test',
      at: '2025-10-09T08:53:20.000Z',
    })
    expect(rows[0].action).not.toBe('org.override')
    expect(rows[0].why).toContain('a make-good')
  })

  it('says when an override predates the required reason', async () => {
    const { rows } = await (await get()).json()
    expect(rows[1]).toMatchObject({ whyMissing: true, why: '' })
  })

  it('puts a date range and a scope on the query', async () => {
    const filters = JSON.stringify([
      { field: 'scope', op: 'equals', value: 'org' },
      { field: 'at', op: 'onOrAfter', value: '2026-10-01' },
    ])
    expect((await get({ filters })).status).toBe(200)
    expect(wheres.map(([path]) => path).sort()).toEqual(expect.arrayContaining(['scope']))
  })

  it('exports the entries the filters reach as a CSV, with before and after', async () => {
    const body = await (await get({ view: 'csv' })).json()
    expect(body.filename).toBe('admin-audit.csv')
    expect(body.capped).toBe(false)
    expect(body.note).toBe('Exported 2 entries.')
    const [header, first] = body.csv.split('\n')
    expect(header).toBe('at,actorUid,actorEmail,action,scope,target,targetTenantId,reason,note,before,after')
    expect(first).toContain('org.override')
    expect(first).toContain('goodwill')
    expect(first).toContain('""plan"":""pro""')
  })
})
