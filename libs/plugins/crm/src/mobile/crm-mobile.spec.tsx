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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Linking } from 'react-native'

/*
 * The CRM's native screens (AGL-3622). The data layer is mocked at its two
 * edges: `@aglyn/mobile-core` (the list hook records what it was asked to
 * plan; documents come from a table) and `firebase/firestore` (every write
 * and listener is recorded), so a spec holds the query, the write's path
 * and fields, and the route each change calls.
 */

const mockListCalls: Array<Record<string, any>> = []
let mockListResult: Record<string, any> = {}
let mockDocs: Record<string, Record<string, unknown> | null> = {}
let mockAccess: Record<string, unknown> = {}
let mockWindowSize = { width: 390, height: 844 }
const mockWrites: Array<{ op: string; path: string; data: any }> = []
const mockSnapshots: Record<string, Array<Record<string, unknown>>> = {}
let mockCount = 0

jest.mock('firebase/firestore', () => {
  const pathOf = (ref: any) => ref.path
  return {
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    query: (ref: any, ...constraints: any[]) => ({ path: pathOf(ref), constraints }),
    where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
    orderBy: (field: unknown, direction?: string) => ({ type: 'orderBy', field, direction }),
    limit: (count: number) => ({ type: 'limit', count }),
    documentId: () => '__name__',
    serverTimestamp: () => 'SERVER_TIME',
    deleteField: () => 'DELETE_FIELD',
    updateDoc: jest.fn(async (ref: any, data: any) => {
      mockWrites.push({ op: 'update', path: ref.path, data })
    }),
    addDoc: jest.fn(async (ref: any, data: any) => {
      mockWrites.push({ op: 'add', path: ref.path, data })
      return { id: 'new' }
    }),
    getCountFromServer: jest.fn(async (q: any) => {
      mockWrites.push({ op: 'count', path: q.path, data: q.constraints })
      return { data: () => ({ count: mockCount }) }
    }),
    onSnapshot: (q: any, next: (snapshot: any) => void) => {
      const rows = mockSnapshots[q.path] ?? []
      next({ docs: rows.map((row) => ({ id: String(row['$id']), data: () => row })) })
      return () => undefined
    },
  }
})
// RN 0.86's ScrollView loads codegen specs this jest does not transform; a plain
// container stands in for it (FlatList and Screen render through it).
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = jest.requireActual('react')
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default
  const MockScrollView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: () => undefined, scrollToEnd: () => undefined, getScrollableNode: () => null, getScrollResponder: () => null, getNativeScrollRef: () => null, flashScrollIndicators: () => undefined }))
    const { children, refreshControl: _refresh, contentContainerStyle, ...rest } = props
    return React.createElement(View, rest, React.createElement(View, { style: contentContainerStyle }, children))
  })
  MockScrollView.Context = React.createContext(null)
  return { __esModule: true, default: MockScrollView }
})
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = jest.requireActual('react')
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default
  const MockModal = (props: Record<string, any>) => (props.visible ? React.createElement(View, null, props.children) : null)
  return { __esModule: true, default: MockModal }
})
// The same for the spinner a busy Button shows.
jest.mock('react-native/Libraries/Components/ActivityIndicator/ActivityIndicator', () => {
  const React = jest.requireActual('react')
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default
  const MockActivityIndicator = (props: Record<string, any>) => React.createElement(View, { testID: props.testID })
  return { __esModule: true, default: MockActivityIndicator }
})
jest.mock('@expo/vector-icons/Ionicons',() => ({ __esModule: true, default: () => null }))
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindowSize, scale: 2, fontScale: 1 }),
}))
jest.mock('@aglyn/mobile-core', () => ({
  searchWords: (text: string) => text.split(/\s+/).filter(Boolean),
  listQueryConstraints: () => [],
  useMobileListQuery: (options: Record<string, any>) => {
    mockListCalls.push(options)
    return {
      rows: [],
      ready: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      plan: { filters: [], orderBy: { path: 'updatedAt', direction: 'desc' }, served: [], refused: [], notices: [], searched: false },
      ...mockListResult,
    }
  },
  useLiveDoc: (_firestore: unknown, path: readonly (string | null)[] | null) => {
    if (!path || !path.every(Boolean)) return { data: null, ready: false, error: null }
    const key = path.join('/')
    const data = mockDocs[key]
    return { data: data ? { $id: path[path.length - 1], ...data } : null, ready: true, error: null }
  },
  useOrgAccess: () => mockAccess,
}))

import {
  getMobileDashboardWidgets,
  getMobileDeepLinks,
  getMobileQuickActions,
  getMobileTabs,
  registeredBy,
  resetMobileRegistry,
  resolveMobileLink,
  type MobilePluginContext,
} from '@aglyn/mobile-plugin-host'
import { LEAD_LIST_DECLARATION } from '../lib/model/lead-filters'
import { CrmHome } from './crm-home-screen'
import CrmOpenLeadsWidget from './crm-open-leads-widget'
import { crmListSpec } from './crm-lists'
import { crmMobileScope, isCrmMobileScope } from './crm-mobile-scope'
import { CrmRecordDetail } from './crm-record-detail'
import { linkedCrmSite } from './crm-record-screen'
import { registerCrmMobile } from './index'

const ORG = 'org-1'
const HOST = 'site-1'
const UID = 'u-1'
const SITE_TOKENS = ['org', `host:${HOST}`]

function makeContext(overrides: Partial<MobilePluginContext> = {}) {
  const request = jest.fn(async (_path: string, _init?: Record<string, any>): Promise<any> => ({ ok: true, members: [] }))
  return {
    uid: UID,
    orgId: ORG,
    hostId: HOST,
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: {},
    api: { request },
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    ...overrides,
  } as unknown as MobilePluginContext & { api: { request: typeof request }; navigate: jest.Mock }
}

const lastList = () => mockListCalls[mockListCalls.length - 1]

beforeEach(() => {
  mockListCalls.length = 0
  mockListResult = {}
  mockWrites.length = 0
  for (const key of Object.keys(mockSnapshots)) delete mockSnapshots[key]
  mockCount = 0
  mockDocs = { [`orgs/${ORG}`]: { name: 'Acme', plan: 'pro' } }
  mockAccess = { loaded: true, orgWide: true, role: 'owner', tokens: ['org'], member: null, hostAccess: {} }
  mockWindowSize = { width: 390, height: 844 }
  jest.restoreAllMocks()
})

describe('the CRM mobile registration', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerCrmMobile()
  })

  it('registers exactly what plugins.config.json declares', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../../../../../plugins.config.json'), 'utf8')) as {
      plugins: Array<{ id: string; mobile?: { contributes: Record<string, string[]> } }>
    }
    const declared = config.plugins.find((plugin) => plugin.id === 'crm')?.mobile?.contributes ?? {}
    const registered = registeredBy('crm')
    for (const kind of ['screens', 'tabs', 'widgets', 'quickActions', 'deepLinks'] as const) {
      expect([...registered[kind]].sort()).toEqual([...(declared[kind] ?? [])].sort())
    }
  })

  it('adds a CRM tab, an Open leads widget and the Leads and Deals actions', () => {
    expect(getMobileTabs().find((tab) => tab.id === 'crm.tab')).toMatchObject({ order: 20, icon: 'people-outline', screen: 'crm.home' })
    expect(getMobileDashboardWidgets().map((widget) => widget.id)).toEqual(['crm.openLeads'])
    expect(getMobileQuickActions().map((action) => [action.id, action.screen])).toEqual([
      ['crm.leadsAction', 'crm.leads'],
      ['crm.dealsAction', 'crm.deals'],
    ])
  })

  it.each([
    ['https://app.aglyn.com/acme/hosts/shop/crm', 'crm.home', {}],
    ['https://app.aglyn.com/acme/hosts/shop/crm/leads', 'crm.leads', {}],
    ['https://app.aglyn.com/acme/crm/deals', 'crm.deals', {}],
    ['https://app.aglyn.com/acme/hosts/shop/crm/leads/lead%20one', 'crm.lead', { recordId: 'lead one' }],
    ['https://app.aglyn.com/acme/crm/companies/co-1', 'crm.company', { recordId: 'co-1' }],
    // The links CRM notifications carry: an assignment, a task, the digest.
    ['/site-1/crm/leads/L1', 'crm.lead', { recordId: 'L1', orgSlug: 'site-1' }],
    ['/site-a/crm/contacts/c-1', 'crm.contact', { recordId: 'c-1' }],
    ['/org/crm/contacts/c-1', 'crm.contact', { recordId: 'c-1' }],
    ['/site-b/crm/deals/d-7', 'crm.deal', { recordId: 'd-7' }],
    ['/site-1/crm/leads', 'crm.leads', {}],
  ])('opens %s natively', (link, screenId, params) => {
    expect(resolveMobileLink(link, getMobileDeepLinks())).toMatchObject({ kind: 'screen', screen: screenId, params })
  })

  it('leaves tasks to the console', () => {
    expect(resolveMobileLink('/org/crm/tasks', getMobileDeepLinks())).toEqual({ kind: 'console', path: '/org/crm/tasks' })
  })

  it('reads a notification host-link as the record’s site', () => {
    expect(linkedCrmSite({ orgSlug: 'site-9' }, { orgSlug: 'acme' })).toBe('site-9')
    expect(linkedCrmSite({ orgSlug: 'acme', hostSlug: 'shop' }, { orgSlug: 'acme' })).toBeNull()
    expect(linkedCrmSite({ orgSlug: 'org' }, { orgSlug: 'acme' })).toBeNull()
  })
})

describe('the CRM scope', () => {
  const reach = { loaded: true, orgWide: false, tokens: ['org', 'host:a'] }
  const declared = {
    consentGroups: { g1: { name: 'Brands', hostIds: ['a', 'b'] } },
  }

  it('reads the organization level only for an org-wide member', () => {
    expect(crmMobileScope({ orgId: ORG, hostId: null, org: {}, reach: { ...reach, orgWide: true } })).toMatchObject({
      level: 'org',
      visibleTo: null,
      foldsScope: true,
    })
    expect(crmMobileScope({ orgId: ORG, hostId: null, org: {}, reach })).toBe('pick-site')
    expect(crmMobileScope({ orgId: null, hostId: null, org: {}, reach })).toBe('no-org')
  })

  it('waits for the org document under a site, then lists the site’s tokens', () => {
    expect(crmMobileScope({ orgId: ORG, hostId: HOST, org: null, reach })).toBe('loading')
    const scope = crmMobileScope({ orgId: ORG, hostId: HOST, org: {}, reach })
    expect(isCrmMobileScope(scope) && scope.visibleTo).toEqual(SITE_TOKENS)
    expect(isCrmMobileScope(scope) && scope.foldsScope).toBe(false)
  })

  it('narrows a declared group to the member’s own reach', () => {
    const scope = crmMobileScope({ orgId: ORG, hostId: 'a', org: declared, reach })
    expect(isCrmMobileScope(scope) && scope.visibleTo).toEqual(['org', 'host:a'])
    const wide = crmMobileScope({ orgId: ORG, hostId: 'a', org: declared, reach: { ...reach, orgWide: true } })
    expect(isCrmMobileScope(wide) && wide.visibleTo).toEqual(['org', 'host:a', 'host:b'])
  })
})

describe('the CRM list queries', () => {
  const siteScope = () => {
    const scope = crmMobileScope({ orgId: ORG, hostId: HOST, org: {}, reach: { loaded: true, orgWide: true, tokens: ['org'] } })
    if (!isCrmMobileScope(scope)) throw new Error('no scope')
    return scope
  }

  it('asks the Leads query: Open by default, the owner, the scope clause and the search folded in', () => {
    const spec = crmListSpec({ kind: 'leads', scope: siteScope(), uid: UID, filters: { status: 'open', mine: true }, search: ['ada'] })
    expect(spec.path).toEqual(['orgs', ORG, 'leads'])
    expect(spec.ask.request.clauses).toEqual([
      { field: 'status', op: 'isAnyOf', value: 'new,nurturing,working' },
      { field: 'ownerUid', op: 'equals', value: UID },
    ])
    expect(spec.ask.request.base).toEqual([{ path: 'visibleTo', op: 'array-contains-any', value: SITE_TOKENS }])
    expect(spec.ask.request.search).toEqual(['ada'])
  })

  it('asks a contact’s stage and owner as the viewing holder’s facet keys', () => {
    const spec = crmListSpec({ kind: 'contacts', scope: siteScope(), uid: UID, filters: { status: 'customer', mine: true }, search: [] })
    expect(spec.ask.request.clauses.map((clause) => clause.field)).toEqual(['facetKeys', 'facetKeys'])
  })

  it('reads one pipeline of deals, and nothing without one', () => {
    const scope = siteScope()
    expect(crmListSpec({ kind: 'deals', scope, uid: UID, filters: { status: 'open', mine: false }, search: [] }).enabled).toBe(false)
    const spec = crmListSpec({ kind: 'deals', scope, uid: UID, filters: { status: 'won', mine: false, pipelineId: 'p1' }, search: [] })
    expect(spec.enabled).toBe(true)
    expect(spec.ask.request.base).toContainEqual({ path: 'pipelineId', op: '==', value: 'p1' })
    expect(spec.ask.request.clauses).toEqual([{ field: 'status', op: 'equals', value: 'won' }])
  })
})

describe('the CRM home', () => {
  it('opens on Contacts, the section a bare /crm lands on in the console', async () => {
    await render(<CrmHome context={makeContext()} params={{}} />)
    expect(lastList().path).toEqual(['orgs', ORG, 'contacts'])
  })

  it('opens none of the CRM on a plan without it, as the console locks the hub', async () => {
    mockDocs[`orgs/${ORG}`] = { name: 'Acme', plan: 'free' }
    const context = makeContext()
    await render(<CrmHome context={context} params={{}} />)
    expect(screen.getByText('Your plan does not include the CRM')).toBeTruthy()
    expect(mockListCalls.every((call) => !call.enabled)).toBe(true)
    await fireEvent.press(screen.getByText('View plans'))
    expect(context.openConsolePath).toHaveBeenCalledWith('/billing', 'org')
  })

  it('plans the console Leads query under the site, then follows the chips and the search', async () => {
    await render(<CrmHome context={makeContext()} params={{ list: 'leads' }} />)
    expect(screen.getByTestId('crm-list-loading')).toBeTruthy()
    let last = lastList()
    expect(last.path).toEqual(['orgs', ORG, 'leads'])
    expect(last.declaration).toEqual(LEAD_LIST_DECLARATION)
    expect(last.enabled).toBe(true)

    mockListResult = { ready: true }
    await fireEvent.press(screen.getByTestId('crm-status-qualified'))
    await fireEvent.press(screen.getByTestId('crm-mine'))
    last = lastList()
    expect(last.request.clauses).toEqual([
      { field: 'status', op: 'equals', value: 'qualified' },
      { field: 'ownerUid', op: 'equals', value: UID },
    ])
    await fireEvent.changeText(screen.getByTestId('crm-search'), 'ada lovelace')
    await waitFor(() => expect(lastList().request.search).toEqual(['ada', 'lovelace']))
    expect(screen.getByText('No leads match these filters')).toBeTruthy()
  })

  it('asks a member whose reach is some sites to pick one at the organization level', async () => {
    mockAccess = { ...mockAccess, orgWide: false, role: 'editor', tokens: ['org', 'host:x'] }
    await render(<CrmHome context={makeContext({ hostId: null })} params={{}} />)
    expect(screen.getByText('Pick a site to see its CRM')).toBeTruthy()
  })

  it('says when the read failed, and lists rows that push their record on a phone', async () => {
    mockListResult = { ready: true, error: new Error('Missing index') }
    const first = await render(<CrmHome context={makeContext()} params={{ list: 'leads' }} />)
    expect(screen.getByText('Could not load leads')).toBeTruthy()
    await first.unmount()
    mockListResult = { ready: true, rows: [{ $id: 'L1', name: 'Ada Lovelace', email: 'ada@example.com', status: 'working', company: 'Engines' }] }
    const context = makeContext()
    await render(<CrmHome context={context} params={{ list: 'leads' }} />)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Working · Engines · ada@example.com')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('crm-row-L1'))
    expect(context.navigate).toHaveBeenCalledWith('crm.lead', { recordId: 'L1' })
  })

  it('switches lists, and shows the record beside the list on a tablet', async () => {
    mockWindowSize = { width: 1180, height: 820 }
    mockListResult = { ready: true, rows: [{ $id: 'c-1', email: 'grace@example.com', name: 'Grace' }] }
    mockDocs[`orgs/${ORG}/contacts/c-1`] = { email: 'grace@example.com', name: 'Grace', visibleTo: SITE_TOKENS }
    const context = makeContext()
    await render(<CrmHome context={context} params={{ list: 'contacts' }} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    expect(lastList().path).toEqual(['orgs', ORG, 'contacts'])
    await fireEvent.press(screen.getByTestId('crm-row-c-1'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('crm-email')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('crm-lists-companies'))
    expect(lastList().path).toEqual(['orgs', ORG, 'companies'])
  })
})

describe('a lead’s page', () => {
  const leadPath = `orgs/${ORG}/leads/L1`
  beforeEach(() => {
    mockDocs[leadPath] = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+1 (555) 010-2000',
      status: 'unqualified',
      unqualifiedReason: 'No budget',
      hostId: HOST,
      visibleTo: SITE_TOKENS,
    }
    mockSnapshots[`orgs/${ORG}/crmActivities`] = [{ $id: 'a1', kind: 'call', body: 'Left a voicemail', atMs: 1_780_000_000_000, byName: 'Sam' }]
  })

  it('shows what the console heads with, the activity log, and reaches the person', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    await render(<CrmRecordDetail kind="leads" id="L1" context={makeContext()} />)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByTestId('crm-fact-Reason')).toBeTruthy()
    expect(screen.getByText('Left a voicemail')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('crm-call'))
    expect(openURL).toHaveBeenCalledWith('tel:+15550102000')
    await fireEvent.press(screen.getByTestId('crm-text'))
    expect(openURL).toHaveBeenCalledWith('sms:+15550102000')
    await fireEvent.press(screen.getByTestId('crm-email'))
    expect(openURL).toHaveBeenCalledWith('mailto:ada@example.com')
  })

  it('reopens a lead as the console does: status and label, the reason dropped, then the sharing rules', async () => {
    const context = makeContext()
    await render(<CrmRecordDetail kind="leads" id="L1" context={context} />)
    await fireEvent.press(screen.getByTestId('crm-change-status'))
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-status-Working'))
    })
    await waitFor(() => expect(mockWrites.find((write) => write.op === 'update')).toBeTruthy())
    expect(mockWrites.find((write) => write.op === 'update')).toEqual({
      op: 'update',
      path: leadPath,
      data: { status: 'working', statusLabel: 'Working', unqualifiedReason: 'DELETE_FIELD', updatedAt: 'SERVER_TIME' },
    })
    await waitFor(() =>
      expect(context.api.request).toHaveBeenCalledWith('/api/crm/sharing', {
        method: 'POST',
        body: { hostId: HOST, object: 'leads', ids: ['L1'], action: 'evaluate' },
      }),
    )
  })

  it('asks the reason before it unqualifies, and writes nothing until it is given', async () => {
    mockDocs[leadPath] = { ...mockDocs[leadPath], status: 'working', unqualifiedReason: undefined }
    await render(<CrmRecordDetail kind="leads" id="L1" context={makeContext()} />)
    await fireEvent.press(screen.getByTestId('crm-change-status'))
    await fireEvent.press(screen.getByTestId('lead-status-Unqualified'))
    expect(screen.getByText('Unqualify Ada Lovelace?')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('unqualify-confirm'))
    expect(mockWrites).toHaveLength(0)
    await fireEvent.changeText(screen.getByTestId('unqualify-reason'), '  Went with a competitor ')
    await act(async () => {
      fireEvent.press(screen.getByTestId('unqualify-confirm'))
    })
    await waitFor(() => expect(mockWrites).toHaveLength(1))
    expect(mockWrites[0]).toEqual({
      op: 'update',
      path: leadPath,
      data: {
        status: 'unqualified',
        statusLabel: 'Unqualified',
        unqualifiedReason: 'Went with a competitor',
        updatedAt: 'SERVER_TIME',
      },
    })
  })

  it('offers no status change to a viewer', async () => {
    mockAccess = { ...mockAccess, role: 'viewer' }
    await render(<CrmRecordDetail kind="leads" id="L1" context={makeContext()} />)
    expect(screen.queryByTestId('crm-change-status')).toBeNull()
    expect(screen.queryByTestId('crm-add-note')).toBeNull()
  })

  it('logs a note with the record’s stamp after counting its log', async () => {
    mockCount = 3
    await render(<CrmRecordDetail kind="leads" id="L1" context={makeContext()} />)
    await fireEvent.press(screen.getByTestId('crm-add-note'))
    await fireEvent.changeText(screen.getByTestId('crm-note-body'), 'Call back Tuesday')
    await act(async () => {
      fireEvent.press(screen.getByTestId('crm-note-save'))
    })
    await waitFor(() => expect(mockWrites.find((write) => write.op === 'add')).toBeTruthy())
    expect(mockWrites[0]).toMatchObject({ op: 'count', path: `orgs/${ORG}/crmActivities` })
    expect(mockWrites[0].data).toContainEqual({ type: 'where', field: 'leadId', op: '==', value: 'L1' })
    const added = mockWrites.find((write) => write.op === 'add')
    expect(added?.data).toMatchObject({
      kind: 'note',
      body: 'Call back Tuesday',
      leadId: 'L1',
      hostId: HOST,
      visibleTo: [`host:${HOST}`],
      byUid: UID,
    })
  })
})

describe('a deal’s page', () => {
  const dealPath = `orgs/${ORG}/deals/d-1`
  beforeEach(() => {
    mockDocs[dealPath] = {
      title: 'Engines renewal',
      amountCents: 1_250_000,
      currency: 'usd',
      status: 'open',
      pipelineId: 'p1',
      stageId: 'qualification',
      hostId: HOST,
      visibleTo: SITE_TOKENS,
    }
    mockSnapshots[`orgs/${ORG}/pipelines`] = [
      {
        $id: 'p1',
        name: 'Sales',
        isDefault: true,
        stages: [
          { id: 'qualification', name: 'Qualification', order: 0, probability: 10, kind: 'open' },
          { id: 'proposal', name: 'Proposal', order: 1, probability: 50, kind: 'open' },
          { id: 'won', name: 'Closed Won', order: 2, probability: 100, kind: 'won' },
        ],
      },
    ]
  })

  it('moves the stage and wins through the stage route', async () => {
    const context = makeContext()
    await render(<CrmRecordDetail kind="deals" id="d-1" context={context} />)
    expect(screen.getByText('$12,500.00')).toBeTruthy()
    await act(async () => {
      fireEvent.press(screen.getByTestId('deal-stage-proposal'))
    })
    expect(context.api.request).toHaveBeenCalledWith('/api/crm/deal-stage', {
      method: 'POST',
      body: { hostId: HOST, dealId: 'd-1', stageId: 'proposal' },
    })
    await act(async () => {
      fireEvent.press(screen.getByTestId('deal-won'))
    })
    expect(context.api.request).toHaveBeenCalledWith('/api/crm/deal-stage', {
      method: 'POST',
      body: { hostId: HOST, dealId: 'd-1', status: 'won' },
    })
  })

  it('asks before it marks a deal lost, with the optional reason', async () => {
    const context = makeContext()
    await render(<CrmRecordDetail kind="deals" id="d-1" context={context} />)
    await fireEvent.press(screen.getByTestId('deal-lost'))
    expect(screen.getByText('Mark this deal lost?')).toBeTruthy()
    expect(context.api.request).not.toHaveBeenCalledWith('/api/crm/deal-stage', expect.anything())
    await fireEvent.changeText(screen.getByTestId('deal-lost-reason'), 'Budget cut')
    await act(async () => {
      fireEvent.press(screen.getByTestId('deal-lost-confirm'))
    })
    expect(context.api.request).toHaveBeenCalledWith('/api/crm/deal-stage', {
      method: 'POST',
      body: { hostId: HOST, dealId: 'd-1', status: 'lost', lostReason: 'Budget cut' },
    })
  })

  it('names the deal’s own site and the org at the organization level', async () => {
    const context = makeContext({ hostId: null })
    await render(<CrmRecordDetail kind="deals" id="d-1" context={context} />)
    await act(async () => {
      fireEvent.press(screen.getByTestId('deal-won'))
    })
    expect(context.api.request).toHaveBeenCalledWith('/api/crm/deal-stage', {
      method: 'POST',
      body: { hostId: HOST, orgId: ORG, dealId: 'd-1', status: 'won' },
    })
  })
})

describe('the Open leads widget', () => {
  it('counts the Leads list’s own Open query under the site', async () => {
    mockCount = 7
    const context = makeContext()
    await render(<CrmOpenLeadsWidget context={context} />)
    await waitFor(() => expect(screen.getByTestId('crm-open-leads-count')).toBeTruthy())
    expect(screen.getByText('7')).toBeTruthy()
    expect(mockWrites[0]).toMatchObject({ op: 'count', path: `orgs/${ORG}/leads` })
    await fireEvent.press(screen.getByText('View'))
    expect(context.navigate).toHaveBeenCalledWith('crm.leads')
  })
})
