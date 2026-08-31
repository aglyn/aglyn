/**
 * @jest-environment jsdom
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
 * WHAT THE FORMS SURFACE PUTS IN THE PAGE HEADER, AND ON WHICH ROUTE.
 *
 * Forms declares no sections, so its quota readout and create button belong
 * in the page header beside the title — where Screens, Layouts, Components
 * and Templates put theirs — rather than in the card header, which is where a
 * surface with a vertical section rail keeps them.
 *
 * The header slot itself is the console layout's, and its wiring is asserted
 * against the real `DashboardLayout` in
 * `apps/console/specs/page-header-actions-seam.spec.tsx`. A plugin lib may
 * not import console-app code, so the provider here is a stand-in of the same
 * shape: it holds one slot and renders what the surface publishes. What is
 * under test is what FORMS publishes — on the catalog, on one form, and
 * against which number.
 */

import { render, screen, within } from '@testing-library/react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeaderActionsContext } from '@aglyn/aglyn'

/** The rows the mocked page query hands the card. */
const mockRows: any[] = []
/** What the server aggregate answers for the quota readout. */
let mockLiveCount: number | null = 0

/** Every call the card makes to the two hooks its count comes from. */
const mockCountCalls: string[] = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  documentId: () => '__name__',
  orderBy: (field: string) => ({ type: 'orderBy', field }),
  limit: (value: number) => ({ type: 'limit', value }),
  query: (source: any) => source,
  doc: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/demo',
    orgSlug: 'acme',
    subdomain: 'demo',
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue(undefined),
  useLiveArtifactCount: (hostId: string, kind: string) => {
    mockCountCalls.push(`useLiveArtifactCount:${hostId}/${kind}`)
    return mockLiveCount
  },
  usePagedCollection: () => {
    mockCountCalls.push('usePagedCollection')
    return {
      status: 'success',
      fromCache: false,
      rows: mockRows,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
    }
  },
}))

/** What `CardDisplay` was handed, so the card header can be checked as empty. */
let mockCardProps: any = {}

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: any) => <a href={href}>{children}</a>,
  CardDisplay: (props: any) => {
    mockCardProps = props
    return (
      <section aria-label="card">
        {props.header ? <h2>{props.header}</h2> : null}
        {props.HeaderProps?.action ?? null}
        {props.children}
      </section>
    )
  },
  MdiIcon: () => null,
}))

/*
 * The grid and its footer stand in as stubs. This file is about the header,
 * and the table's own promises are asserted in `forms-surface-parity.spec.tsx`
 * against the real one — mounting a second copy of MUI's data grid here buys
 * nothing and costs the suite a minute.
 */
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  __esModule: true,
  default: () => <div>{'table'}</div>,
  ListRowActions: () => null,
  listActionsColumn: () => ({ field: 'actions' }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  __esModule: true,
  ListPagination: () => null,
}))

jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  __esModule: true,
  CreateArtifactDrawer: ({ open, title }: any) => (open ? <div>{title}</div> : null),
}))

/*
 * One form's own surface, stubbed.
 *
 * The routing decision is `forms-console-page.tsx`'s and is exercised for
 * real; what the detail card renders is not this file's subject, and it has
 * its own header assertions in `form-detail-page-chrome.spec.tsx`. Stubbed
 * to publish NOTHING so the assertion below is about the LIST card
 * unmounting and taking its create button with it — the mechanism that has
 * to hold. The real detail card publishes a besigner button of its own,
 * which would satisfy an "the header changed" assertion without the list
 * card ever having let go of its own controls.
 */
jest.mock('./form-detail-card', () => ({
  __esModule: true,
  default: ({ formId }: any) => <div>{`detail of ${formId}`}</div>,
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
}))

const FormsConsolePage = require('./forms-console-page')
  .default as typeof import('./forms-console-page').default

/**
 * A page header of one slot, the shape `DashboardLayout` provides.
 *
 * The context value is built once so a publish never re-renders the surface
 * that published it, which is the property that keeps a surface publishing on
 * every render out of a render loop.
 */
function HeaderHarness(props: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  const value = useMemo(() => ({ setHeaderActions: setActions }), [])
  return (
    <PageHeaderActionsContext.Provider value={value}>
      <header>{actions}</header>
      {props.children}
    </PageHeaderActionsContext.Provider>
  )
}

/** The page header, by its landmark role. */
const pageHeader = () => screen.getByRole('banner')

/**
 * The quota readout's own text, found by the tail every one of them carries —
 * so the assertion is about the readout rather than about whatever else the
 * header happens to hold beside it.
 */
const quotaReadout = () =>
  within(pageHeader()).getByText(/your plan/).textContent

function renderForms(options: {
  org?: Record<string, unknown>
  segments?: string[]
  used?: number
}) {
  mockCountCalls.length = 0
  mockCardProps = {}
  mockLiveCount = options.used ?? 0
  return render(
    (
      <HeaderHarness>
        <FormsConsolePage
          hostId="host-1"
          entitled
          org={options.org as never}
          basePath="/acme/hosts/demo/forms"
          segments={options.segments ?? []}
          hostRole={{ canPublish: true, loaded: true }}
        />
      </HeaderHarness>
    ) as any,
  )
}

describe('the forms catalog publishes its controls to the page header', () => {
  it('CONTROL: the readout leads the create button, in the header', () => {
    renderForms({ org: { plan: 'pro' }, used: 3 })
    const header = within(pageHeader())
    expect(header.getByRole('button', { name: 'Create Form' })).toBeTruthy()
    // The order is the convention: the number the reader is measured against
    // comes before the control that spends it.
    expect(pageHeader().textContent).toMatch(/forms on your plan.*Create Form/s)
  })

  it('leaves the card header empty, so the two are not both offered', () => {
    renderForms({ org: { plan: 'pro' }, used: 3 })
    // The card still names itself; what it no longer carries is the action
    // cluster. Both would put two create buttons on one screen.
    expect(mockCardProps.header).toBe('Forms')
    expect(mockCardProps.HeaderProps?.action).toBeUndefined()
    expect(
      within(screen.getByRole('region', { name: 'card' })).queryByRole(
        'button',
        { name: 'Create Form' },
      ),
    ).toBeNull()
  })

  it('lets go of the catalog’s controls on a form’s own route', () => {
    renderForms({ org: { plan: 'pro' }, segments: ['form-abc'] })
    // The detail surface is a different component, so the list card unmounts
    // and takes its create button with it. A create button here would offer a
    // catalog action from inside one of its rows.
    expect(pageHeader().querySelectorAll('button')).toHaveLength(0)
    expect(pageHeader().textContent).toBe('')
    expect(screen.getByText('detail of form-abc')).toBeTruthy()
  })

  it('counts from the listener the card already holds', () => {
    renderForms({ org: { plan: 'pro' }, used: 3 })
    // The readout in the header and the table in the body are one read. A
    // header that asked for the count itself would open a second aggregate
    // over the collection the card is already counting.
    expect(
      mockCountCalls.filter((call) => call.startsWith('useLiveArtifactCount')),
    ).toEqual(['useLiveArtifactCount:host-1/forms'])
    expect(mockCountCalls.filter((call) => call === 'usePagedCollection')).toEqual(
      ['usePagedCollection'],
    )
  })
})

describe('the readout names the plan’s allowance', () => {
  it('reads the ceiling the server enforces, not the listing window', () => {
    renderForms({ org: { plan: 'pro' }, used: 3 })
    // 500 is `formsPerHost` on every plan that carries it, and it is what
    // `/api/hosts/resources` refuses at. 1000 is `FORMS_MAX_PER_HOST`, which
    // bounds a READ — quoting it would promise twice the room the plan has
    // and send a customer into a refusal the page called impossible.
    expect(quotaReadout()).toBe('3/500 forms on your plan')
  })

  it('does not invent room on a plan that carries no forms', () => {
    // Free's allowance is 0 — the one plan where forms are not included.
    renderForms({ org: { plan: 'free' }, used: 0 })
    expect(quotaReadout()).toBe('0/0 forms on your plan')
    expect(quotaReadout()).not.toContain('1000')
    expect(quotaReadout()).not.toContain('∞')
  })

  it('honors a raised per-org allowance', () => {
    // A staff-set override resolves ahead of the plan's number, and the
    // readout follows it — the same resolution the create is refused by.
    renderForms({
      org: { plan: 'starter', entitlements: { formsPerHost: 25 } },
      used: 4,
    })
    expect(quotaReadout()).toBe('4/25 forms on your plan')
  })

  it('names no cap at all until the plan has resolved', () => {
    // `resolveOrgEntitlements(undefined)` answers the FREE tier rather than
    // "unknown", so a denominator rendered without an org tells a paying
    // customer they are on 0. The count it does know is still shown.
    renderForms({ org: undefined, used: 3 })
    expect(quotaReadout()).toBe('3 forms · checking your plan…')
  })
})
