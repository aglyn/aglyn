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

/**
 * AGL-2662 — every CRM export wrote the LOADED WINDOW and called the file
 * `contacts.csv`.
 *
 * The assertion that must not be written here is "rows were written": that
 * passes against a truncated file, which is the whole defect. What is
 * asserted instead is that the row count equals the SOURCE count over a
 * collection deliberately larger than the page size, that the header states
 * the same number the body delivers, that the columns are the ones the
 * client's own writer produces, and that a scoped collaborator's file is
 * their scope rather than the org's.
 */
export {}

/** `orgs/org-1/<collection>` — collection → (id → doc data). */
const mockCollections = new Map<string, Map<string, Record<string, unknown>>>()
/** `hosts/<hostId>/leads` — hostId → (id → doc data). */
const mockLeads = new Map<string, Map<string, Record<string, unknown>>>()
let mockOrg: Record<string, unknown> | null = null
let mockMember: Record<string, unknown> | null = null
let mockDecoded: Record<string, unknown> = { uid: 'user-1', email_verified: true }
let mockReleaseFlag = true
let mockPermission = true
let mockLocked: Response | null = null
const mockAuditAdd = jest.fn(async () => undefined)
/** Every `where` a page carried, so the scope clause can be asserted. */
const mockWheres: Array<[string, string, unknown]> = []

/**
 * A faithful-enough collection query: `startAfter` is evaluated on the
 * ordered field's value, which under `orderBy(__name__)` is the id.
 */
function mockCollectionQuery(
  rows: Map<string, Record<string, unknown>>,
  take: number | null,
  after: string | null,
  filter: ((row: Record<string, unknown>) => boolean) | null,
) {
  const matching = () =>
    [...rows.entries()]
      .filter(([, value]) => (filter ? filter(value) : true))
      .map(([id]) => id)
      .sort()
  return {
    where: (field: string, op: string, value: unknown) => {
      mockWheres.push([field, op, value])
      return mockCollectionQuery(rows, take, after, (row) => {
        const held = (row['visibleTo'] ?? []) as string[]
        return (value as string[]).some((token) => held.includes(token))
      })
    },
    orderBy: () => mockCollectionQuery(rows, take, after, filter),
    limit: (count: number) => mockCollectionQuery(rows, count, after, filter),
    startAfter: (snapshot: { id: string }) =>
      mockCollectionQuery(rows, take, snapshot.id, filter),
    get: async () => {
      let ids = matching()
      if (after !== null) ids = ids.filter((id) => id > after)
      const page = take === null ? ids : ids.slice(0, take)
      return {
        empty: page.length === 0,
        docs: page.map((id) => ({ id, data: () => rows.get(id) })),
      }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
  }
}

const mockEmptyRows = new Map<string, Record<string, unknown>>()

const mockOrgRef = () => ({
  get: async () => ({ exists: mockOrg !== null, data: () => mockOrg }),
  collection: (name: string) =>
    mockCollectionQuery(mockCollections.get(name) ?? mockEmptyRows, null, null, null),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'orgs') return { doc: () => mockOrgRef() }
          if (name === 'adminAudit') return { add: mockAuditAdd }
          if (name === 'hosts') {
            return {
              doc: (hostId: string) => ({
                collection: () =>
                  mockCollectionQuery(
                    mockLeads.get(hostId) ?? mockEmptyRows,
                    null,
                    null,
                    null,
                  ),
              }),
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    get: async () => ({
                      docs: [...mockLeads.keys()].sort().map((id) => ({
                        id,
                        data: () => ({ displayName: `Site ${id}` }),
                      })),
                    }),
                    startAfter: () => ({ get: async () => ({ docs: [] }) }),
                  }),
                }),
              }),
            }
          }
          throw new Error(`unexpected collection ${name}`)
        },
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => mockReleaseFlag,
  lockdownRefusal: async () => mockLocked,
  memberHasOrgPermission: async () => mockPermission,
  resolveOrgMembership: async () =>
    mockMember ? { orgId: 'org-1', member: mockMember } : null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL scope predicate, the REAL consent-group resolver and the REAL
  // CSV writers — the three pieces of product logic this route leans on.
  // Stubbing any of them would leave the authorization or the column set
  // asserted against fiction.
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contact-holder'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/csv-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-csv'),
  // The REAL plan tables, so the CRM's plan gate answers as it does live.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: {},
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }
  },
}))

const route = require('../app/api/crm/export/route')
const { COMPANY_CSV_COLUMNS, LEAD_CSV_COLUMNS } = jest.requireActual(
  '@aglyn/aglyn/app-utils/crm-csv',
)

/** `count` companies with deliberately non-sequential ids, as auto-ids are. */
const seedCompanies = (count: number, visibleTo: string[] = ['org']) => {
  const rows = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < count; index += 1) {
    const id = `co-${String((index * 7919) % 100000).padStart(6, '0')}-${index}`
    rows.set(id, {
      name: `Company ${index}`,
      domain: `c${index}.test`,
      visibleTo,
      ownerUid: index % 2 ? 'user-2' : '',
    })
  }
  mockCollections.set('companies', rows)
  return rows
}

const callExport = (
  params: Record<string, string> = {},
  headers: Record<string, string> = { Authorization: 'Bearer tok' },
) => {
  const search = new URLSearchParams({ orgId: 'org-1', ...params })
  return route.GET(
    new Request(`https://console.aglyn.com/api/crm/export?${search}`, { headers }),
  )
}

beforeEach(() => {
  mockCollections.clear()
  mockLeads.clear()
  mockCollections.set(
    'members',
    new Map([['user-2', { email: 'rep@example.test' }]]),
  )
  mockOrg = { plan: 'agency' }
  mockMember = { $id: 'user-1', role: 'admin' }
  mockDecoded = { uid: 'user-1', email_verified: true }
  mockReleaseFlag = true
  mockPermission = true
  mockLocked = null
  mockAuditAdd.mockClear()
  mockWheres.length = 0
})

describe('the CRM export is the whole collection (AGL-2662)', () => {
  it('REGRESSION — writes every row, not the page the list had loaded', async () => {
    seedCompanies(1200)
    const response = await callExport({ resource: 'companies' })
    expect(response.status).toBe(200)
    const lines = (await response.text()).trim().split('\n')
    // 1,200 is deliberately past the 500-row page size, so a fix that pages
    // once fails here as loudly as the original truncation does.
    expect(lines).toHaveLength(1 + 1200)
    // The header states the same number the body delivers. Asserting only
    // one of the two lets a stream that dies mid-flight pass.
    expect(response.headers.get('X-Aglyn-Export-Rows')).toBe('1200')
  })

  it('writes the columns the section’s own Export button writes', async () => {
    seedCompanies(2)
    const lines = (await (await callExport({ resource: 'companies' })).text())
      .trim()
      .split('\n')
    expect(lines[0]).toBe(COMPANY_CSV_COLUMNS.join(','))
    // And the resolvers the file promises: an owner by ADDRESS, not a uid.
    expect(lines.slice(1).some((line) => line.includes('rep@example.test'))).toBe(
      true,
    )
  })

  it('orders by document id, which no document can be missing', async () => {
    const rows = seedCompanies(30)
    const lines = (await (await callExport({ resource: 'companies' })).text())
      .trim()
      .split('\n')
    const expected = [...rows.keys()]
      .sort()
      .map((id) => String(rows.get(id)?.['name']))
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(expected)
  })
})

describe('what the export refuses', () => {
  it('refuses an unauthenticated caller', async () => {
    seedCompanies(1)
    expect((await callExport({ resource: 'companies' }, {})).status).toBe(401)
  })

  it('refuses a resource it does not write', async () => {
    expect((await callExport({ resource: 'pipelines' })).status).toBe(400)
  })

  it('refuses a caller who is not a member', async () => {
    mockMember = null
    expect((await callExport({ resource: 'companies' })).status).toBe(404)
  })

  it('refuses when the surface is not released for the org', async () => {
    mockReleaseFlag = false
    expect((await callExport({ resource: 'companies' })).status).toBe(404)
  })

  /**
   * The permission the CRM's own rules read for. These records ARE the
   * audience, and `data.manage` is what admits a person to the list this
   * file copies.
   */
  it('refuses a member without data.manage', async () => {
    mockPermission = false
    expect((await callExport({ resource: 'companies' })).status).toBe(404)
  })

  it('honors a lockdown refusal', async () => {
    mockLocked = Response.json({ error: 'Locked' }, { status: 423 })
    expect((await callExport({ resource: 'companies' })).status).toBe(423)
  })
})

/**
 * THE PEOPLE FILES ON EVERY PLAN, THE CRM'S RECORDS FROM STARTER
 * (AGL-2839, AGL-2851).
 *
 * Exporting the contacts and leads a workspace holds is an obligation, so a
 * Free workspace takes both, and neither asks the release flag. Companies,
 * deals and tasks are the CRM's: refused `plan_required` / `crm` on a plan
 * without it, staff included, after the caller is known.
 */
describe('the plan and the people files', () => {
  const refusedForPlan = async (response: Response) =>
    response.status === 403 &&
    (await response.json().then((body: any) => body.reason === 'plan_required' && body.code === 'crm'))

  it('refuses the CRM’s own records on Free, staff included', async () => {
    mockOrg = { plan: 'free' }
    seedCompanies(2)
    for (const resource of ['companies', 'deals', 'tasks']) {
      expect([resource, await refusedForPlan(await callExport({ resource }))]).toEqual([resource, true])
    }
    mockDecoded = { uid: 'staff-1', email_verified: true, staff: true }
    expect(await refusedForPlan(await callExport({ resource: 'companies' }))).toBe(true)
  })

  it('writes the contacts and leads files on Free', async () => {
    mockOrg = { plan: 'free' }
    expect((await callExport({ resource: 'contacts' })).status).toBe(200)
    expect((await callExport({ resource: 'leads' })).status).toBe(200)
  })

  it('writes the people files whatever the release flag says, and keeps the flag on the rest', async () => {
    mockReleaseFlag = false
    expect((await callExport({ resource: 'contacts' })).status).toBe(200)
    expect((await callExport({ resource: 'leads' })).status).toBe(200)
    expect((await callExport({ resource: 'companies' })).status).toBe(404)
  })

  it('answers authorization before the plan', async () => {
    mockOrg = { plan: 'free' }
    mockPermission = false
    expect((await callExport({ resource: 'companies' })).status).toBe(404)
  })

  it('CONTROL: admits the CRM’s records on Starter', async () => {
    mockOrg = { plan: 'starter', subscription: { status: 'active' } }
    seedCompanies(2)
    expect((await callExport({ resource: 'companies' })).status).toBe(200)
  })
})

/**
 * The Admin SDK bypasses the rules, so the scope clause here IS the
 * enforcement rather than a second opinion about it. A collaborator scoped
 * to one site must get their site's rows and nothing else — the failure
 * mode is a whole org's audience in one file.
 */
describe('scope, which nothing else can enforce', () => {
  it('carries a scoped collaborator’s own tokens, and returns only their rows', async () => {
    const rows = new Map<string, Record<string, unknown>>([
      ['a', { name: 'Theirs', visibleTo: ['host:host-1'] }],
      ['b', { name: 'Someone else', visibleTo: ['host:host-2'] }],
      ['c', { name: 'Org wide', visibleTo: ['org'] }],
    ])
    mockCollections.set('companies', rows)
    mockMember = {
      $id: 'user-1',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      scopeTokens: ['host:host-1'],
    }
    const body = await (await callExport({ resource: 'companies' })).text()
    expect(body).toContain('Theirs')
    expect(body).not.toContain('Someone else')
    expect(mockWheres).toContainEqual([
      'visibleTo',
      'array-contains-any',
      ['host:host-1'],
    ])
  })

  it('does not clause an org-wide member, whom the rules already admit', async () => {
    seedCompanies(3)
    await (await callExport({ resource: 'companies' })).text()
    expect(mockWheres).toHaveLength(0)
  })
})

describe('leads, which are host data by path', () => {
  const seedLeads = () => {
    mockLeads.set(
      'host-1',
      new Map([['l1', { email: 'one@example.test', name: 'One' }]]),
    )
    mockLeads.set(
      'host-2',
      new Map([['l2', { email: 'two@example.test', name: 'Two' }]]),
    )
  }

  it('writes one site’s leads with no Site column', async () => {
    seedLeads()
    const lines = (
      await (await callExport({ resource: 'leads', hostId: 'host-1' })).text()
    )
      .trim()
      .split('\n')
    expect(lines[0]).toBe(LEAD_CSV_COLUMNS.join(','))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('one@example.test')
  })

  /**
   * At the organization level a row is some site's lead and the file must
   * say which — the same `Site` column the org-level list's own file gains.
   */
  it('spans every site with a Site column for an org-wide member', async () => {
    seedLeads()
    const lines = (await (await callExport({ resource: 'leads' })).text())
      .trim()
      .split('\n')
    expect(lines[0].split(',')).toContain('Site')
    expect(lines).toHaveLength(3)
    expect(lines.join('\n')).toContain('Site host-1')
    expect(lines.join('\n')).toContain('Site host-2')
  })

  it('refuses a scoped collaborator who names no site', async () => {
    seedLeads()
    mockMember = {
      $id: 'user-1',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      scopeTokens: ['host:host-1'],
    }
    expect((await callExport({ resource: 'leads' })).status).toBe(400)
  })

  it('refuses a scoped collaborator a site they do not reach', async () => {
    seedLeads()
    mockMember = {
      $id: 'user-1',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      scopeTokens: ['host:host-1'],
    }
    expect(
      (await callExport({ resource: 'leads', hostId: 'host-2' })).status,
    ).toBe(404)
  })
})

describe('contacts, which are read through one holder’s facet', () => {
  const seedContacts = () => {
    mockCollections.set(
      'contacts',
      new Map([
        [
          'c1',
          {
            email: 'ada@example.test',
            name: 'Ada Canonical',
            visibleTo: ['org'],
            capturedByHostIds: ['host-1'],
            facets: {
              'host-1': {
                name: 'Ada as host-1 knows her',
                sources: { form: true },
                interactions: [],
                notes: 'host-1 notes',
              },
              'host-2': {
                name: 'Ada as host-2 knows her',
                sources: {},
                interactions: [],
                notes: 'host-2 notes',
              },
            },
          },
        ],
      ]),
    )
  }

  /**
   * A file written off the TOP of the document would carry whatever the
   * pre-facet migration left there, which is one holder's fields handed to
   * every other holder in the org.
   */
  it('writes the named site’s facet, not another site’s', async () => {
    seedContacts()
    const body = await (
      await callExport({ resource: 'contacts', hostId: 'host-1' })
    ).text()
    expect(body).toContain('Ada as host-1 knows her')
    expect(body).toContain('host-1 notes')
    expect(body).not.toContain('host-2 notes')
  })

  it('falls back to each row’s primary holder with no site named', async () => {
    seedContacts()
    const body = await (await callExport({ resource: 'contacts' })).text()
    // `capturedByHostIds` names host-1 first, so that is the primary holder.
    expect(body).toContain('host-1 notes')
    expect(body).not.toContain('host-2 notes')
  })

  it('refuses a scoped collaborator who names no site', async () => {
    seedContacts()
    mockMember = {
      $id: 'user-1',
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      scopeTokens: ['host:host-1'],
    }
    expect((await callExport({ resource: 'contacts' })).status).toBe(400)
  })
})
