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
 * AGL-3761 · "Create site" asks how the site starts BEFORE it creates it.
 *
 * It used to create the site from its name and only then open the start, so
 * every start closed unanswered left an empty site behind. Pinned here:
 *
 * - the dialog opens on the start zone with no site, and creates nothing on
 *   opening, closing or leaving;
 * - the starter (and Skip) creates the site WITH the starter, in one request,
 *   and lands on it with "Your site is live";
 * - a start the widget begins creates the site empty, once, and leaves the
 *   navigation to the widget;
 * - refusals the console can see coming — a role without `hosts.create`, a
 *   plan with no site left, a taken address — are said before anything is
 *   created;
 * - a site created for a start that then could not begin is given the
 *   starter on the way out, so none is left empty;
 * - a workspace with no start to offer gets the plain dialog, unchanged.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockHardNavigate = jest.fn()
const mockTrack = jest.fn()
const mockSnackbar = jest.fn()
const mockStarter = jest.fn(async () => true)
let mockLanding: (url: string) => string = (url) => url

jest.mock('next/navigation', () => {
  const router = {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }
  return {
    useRouter: () => router,
    usePathname: () => '/acme/hosts',
    useSearchParams: () => new URLSearchParams(),
  }
})
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))

type FetchAnswer = { status: number; body: Record<string, unknown> }
let mockCreateAnswer: FetchAnswer
let mockValidateAnswer: Record<string, unknown>
// Holds the create's answer back, so the workspace's own read can land first.
let mockCreateGate: Promise<void> | null
const mockFetch = jest.fn(async (_user: unknown, url: string, _init?: { body?: string }) => {
  if (url === '/api/hosts/create' && mockCreateGate) await mockCreateGate
  const answer: FetchAnswer =
    url === '/api/hosts/validate-name'
      ? { status: 200, body: mockValidateAnswer }
      : mockCreateAnswer
  return {
    ok: answer.status < 400,
    status: answer.status,
    json: async () => answer.body,
  }
})
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: [unknown, string, { body?: string }?]) => mockFetch(...args),
}))

let mockOrg: Record<string, unknown> | null
let mockCan = true
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ can: () => mockCan, loaded: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', slug: 'acme' } }),
}))
const mockDequeueLoading = jest.fn()
const mockQueueLoading = jest.fn(() => mockDequeueLoading)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: mockQueueLoading }),
}))
jest.mock('../utils/account-acquisition', () => ({ firstTouchField: () => ({}) }))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockHardNavigate(url),
}))
jest.mock('../utils/console-landing', () => ({
  currentConsoleLandingHref: (url: string) => mockLanding(url),
}))
jest.mock('../utils/host-first-run', () => ({
  requestStarterSite: (...args: unknown[]) => mockStarter(...(args as [])),
}))
jest.mock('../components/host-first-run-gate.component', () => ({
  SITE_START_PARAM: 'start',
  SITE_START_VALUE: 'site',
  SITE_START_LIVE_VALUE: 'live',
}))

/** What the start zone was handed, as its one widget would receive it. */
type ZoneProps = {
  hostId: string | null
  startBlank: () => void | Promise<boolean>
  leave: () => void
  pendingSite: {
    fields: React.ReactNode
    check: () => boolean
    dirty: boolean
    create: () => Promise<Record<string, unknown>>
    created: Record<string, unknown> | null
    ready: (shown: boolean) => void
  }
}
let mockZone: ZoneProps | null = null
let mockWidgets: unknown[] = [{ widgetId: 'ai-site-start' }]
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  useSlotWidgets: () => ({ widgets: mockWidgets, ready: true }),
  // The widget, as a probe: it draws the shell's fields where a real one
  // would, on its first step.
  default: (props: ZoneProps) => {
    mockZone = props
    return <div data-testid="start-zone">{props.pendingSite?.fields}</div>
  },
}))

const { CreateHostDialog } = jest.requireActual(
  '../components/create-host-dialog.component',
) as typeof import('../components/create-host-dialog.component')

const createCalls = () =>
  mockFetch.mock.calls.filter(([, url]) => url === '/api/hosts/create')
const createBody = (index = 0) =>
  JSON.parse(String(createCalls()[index]?.[2]?.body ?? '{}')) as Record<string, unknown>

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Opens the dialog and lets the start's widget say it draws. */
const openStart = async (onClose = jest.fn()) => {
  const view = render(<CreateHostDialog open onClose={onClose} />)
  await flush()
  act(() => mockZone?.pendingSite.ready(true))
  return { ...view, onClose }
}

const typeName = (name = 'Royal Styles') =>
  fireEvent.change(screen.getByLabelText('Site name'), { target: { value: name } })

beforeEach(() => {
  jest.clearAllMocks()
  mockZone = null
  mockWidgets = [{ widgetId: 'ai-site-start' }]
  mockOrg = { plan: 'business', slug: 'acme' }
  mockCan = true
  mockLanding = (url) => url
  mockCreateGate = null
  mockValidateAnswer ={ subdomainValid: true, subdomainTaken: false, suggestions: [] }
  mockCreateAnswer = {
    status: 200,
    body: {
      hostId: 'host-1',
      subdomain: 'royal-styles',
      orgId: 'org-1',
      orgSlug: 'acme',
      guidedStart: true,
      orgCreated: false,
    },
  }
})

describe('Create site waits under the console loading overlay', () => {
  it('queues the overlay while the start decides, with no dialog of its own, and clears it after', async () => {
    render(<CreateHostDialog open onClose={jest.fn()} />)
    await flush()
    // Red before the fix: a dialog around a spinner, and no overlay queued.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(mockQueueLoading).toHaveBeenCalledTimes(1)
    expect(mockDequeueLoading).not.toHaveBeenCalled()

    act(() => mockZone?.pendingSite.ready(true))
    expect(mockDequeueLoading).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('start-zone')).toBeTruthy()
  })
})

describe('AGL-3761 · Create site opens on the start, with nothing created', () => {
  it('draws the start zone with no site, and the name and address inside it', async () => {
    await openStart()
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    expect(mockZone?.hostId).toBeNull()
    expect(mockZone?.pendingSite.created).toBeNull()
    expect(screen.getByLabelText('Site name')).toBeTruthy()
    expect(screen.getByLabelText('Subdomain')).toBeTruthy()
    // Red before the fix: the create was the dialog's first act.
    expect(createCalls()).toHaveLength(0)
    expect(mockTrack).not.toHaveBeenCalledWith('host_created', {})
  })

  it('creates nothing when the start is closed, with or without a name typed', async () => {
    const { onClose } = await openStart()
    typeName()
    act(() => mockZone?.leave())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createCalls()).toHaveLength(0)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('AGL-3761 · the starter creates the site with the starter', () => {
  it('creates it once, with the starter, and lands on it saying it is live', async () => {
    const { onClose } = await openStart()
    typeName()
    let done: boolean | void = undefined
    await act(async () => {
      done = await mockZone?.startBlank()
    })
    expect(done).toBe(true)
    expect(createCalls()).toHaveLength(1)
    expect(createBody()).toMatchObject({
      displayName: 'Royal Styles',
      subdomain: 'royal-styles',
      orgId: 'org-1',
      start: 'starter',
    })
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(1)
    expect(mockTrack).toHaveBeenCalledWith('site_published', { first_publish: true })
    expect(onClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles?start=live')
  })

  it('creates nothing without a name, and says what is missing', async () => {
    await openStart()
    let done: boolean | void = undefined
    await act(async () => {
      done = await mockZone?.startBlank()
    })
    expect(done).toBe(false)
    expect(createCalls()).toHaveLength(0)
    expect(screen.getByText('Name your site')).toBeTruthy()
  })

  it('says the create’s own refusal, such as the site limit, and stays', async () => {
    mockCreateAnswer = {
      status: 403,
      body: { error: 'Site limit reached (1) — upgrade or add extra sites from Billing' },
    }
    const { onClose } = await openStart()
    typeName()
    await act(async () => {
      await mockZone?.startBlank()
    })
    expect(mockSnackbar).toHaveBeenCalledWith(
      'Site limit reached (1) — upgrade or add extra sites from Billing',
      expect.objectContaining({ variant: 'error' }),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(mockTrack).not.toHaveBeenCalledWith('host_created', {})
  })
})

describe('AGL-3761 · a start the widget begins creates the site, empty, once', () => {
  it('creates it without the starter and leaves the landing to the widget', async () => {
    await openStart()
    typeName()
    let site: Record<string, unknown> | undefined
    await act(async () => {
      site = await mockZone?.pendingSite.create()
    })
    expect(site).toEqual({ hostId: 'host-1', host: 'royal-styles', orgSlug: 'acme' })
    expect(createBody()).not.toHaveProperty('start')
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockZone?.pendingSite.created).toEqual(site)
    // Asked again — a job that could not start, retried — it is the same site.
    await act(async () => {
      await mockZone?.pendingSite.create()
    })
    expect(createCalls()).toHaveLength(1)
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(1)
  })

  it('reports a workspace the create made on its way, before the site', async () => {
    mockCreateAnswer.body.orgCreated = true
    await openStart()
    typeName()
    await act(async () => {
      await mockZone?.pendingSite.create()
    })
    const order = mockTrack.mock.calls.map(([name]) => name)
    expect(order.indexOf('org_created')).toBeLessThan(order.indexOf('host_created'))
  })

  it('hands a taken address back to the fields, with what is available', async () => {
    mockCreateAnswer = {
      status: 409,
      body: { error: 'That subdomain is taken', suggestions: ['royal-styles-2'] },
    }
    await openStart()
    typeName()
    let outcome: Record<string, unknown> | undefined
    await act(async () => {
      outcome = await mockZone?.pendingSite.create()
    })
    expect(outcome).toEqual({ error: 'That subdomain is taken', address: true })
    expect(screen.getByText('royal-styles-2')).toBeTruthy()
    expect(mockZone?.pendingSite.created).toBeNull()
  })

  it('gives a site whose start could not begin the starter on the way out', async () => {
    const { onClose } = await openStart()
    typeName()
    await act(async () => {
      await mockZone?.pendingSite.create()
    })
    await act(async () => {
      await mockZone?.startBlank()
    })
    expect(mockStarter).toHaveBeenCalledWith({ uid: 'u-1' }, 'host-1')
    expect(createCalls()).toHaveLength(1)
    expect(onClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles?start=live')
  })
})

describe('AGL-3761 · what the create would refuse is said first', () => {
  it('tells a role without hosts.create, and draws no start', async () => {
    mockCan = false
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    expect(screen.getByText(/does not allow creating sites/)).toBeTruthy()
    expect(screen.queryByTestId('start-zone')).toBeNull()
    expect(screen.queryByLabelText('Site name')).toBeNull()
  })

  it('tells a workspace with no site left on its plan, with the way to Billing', async () => {
    mockOrg = { plan: 'free', slug: 'acme', hosts: { 'host-0': true } }
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    expect(screen.getByText(/using all of them/)).toBeTruthy()
    expect(screen.getByText('Go to Billing').closest('a')?.getAttribute('href')).toBe(
      '/acme/billing',
    )
    expect(screen.queryByTestId('start-zone')).toBeNull()
  })

  it('keeps the start when its own new site uses a one-site plan, before or after the answer (AGL-4017)', async () => {
    mockOrg = { plan: 'free', slug: 'acme' }
    const { rerender, onClose } = await openStart()
    typeName()
    let release: () => void = () => undefined
    mockCreateGate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pending: Promise<Record<string, unknown>> | undefined
    act(() => {
      pending = mockZone?.pendingSite.create()
    })
    // The workspace's read counts the new site before the create answers.
    mockOrg = { plan: 'free', slug: 'acme', hosts: { 'host-1': true } }
    rerender(<CreateHostDialog open onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    expect(screen.queryByText(/using all of them/)).toBeNull()
    await act(async () => {
      release()
      await pending
    })
    rerender(<CreateHostDialog open onClose={onClose} />)
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    expect(screen.queryByText(/using all of them/)).toBeNull()
    expect(mockZone?.pendingSite.created).toEqual({
      hostId: 'host-1',
      host: 'royal-styles',
      orgSlug: 'acme',
    })
  })

  it('says a taken address as it is typed, before anything is created', async () => {
    mockValidateAnswer = {
      subdomainValid: true,
      subdomainTaken: true,
      suggestions: ['royal-styles-2026'],
    }
    await openStart()
    typeName()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450))
    })
    expect(screen.getByText('That address is taken')).toBeTruthy()
    expect(screen.getByText('royal-styles-2026')).toBeTruthy()
    let usable: boolean | undefined
    act(() => {
      usable = mockZone?.pendingSite.check()
    })
    expect(usable).toBe(false)
    expect(createCalls()).toHaveLength(0)
  })
})

describe('AGL-3761 · a workspace with no start to offer gets the plain dialog', () => {
  const submit = async () => {
    typeName()
    await act(async () => {
      fireEvent.click(screen.getByText('Create site'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('creates the site with the starter on Create site, and lands on it', async () => {
    mockWidgets = []
    mockCreateAnswer.body.guidedStart = false
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    expect(screen.getByText('Create a new site')).toBeTruthy()
    await submit()
    // Never empty for a start this dialog did not offer (AGL-3859).
    expect(createBody()).toMatchObject({ start: 'starter' })
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles')
  })

  it('is what a widget that will not draw falls back to', async () => {
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    act(() => mockZone?.pendingSite.ready(false))
    expect(screen.getByText('Create a new site')).toBeTruthy()
    await submit()
    // With the starter (AGL-3859): the site is offered the start on its own
    // page, and has its starter until that is answered.
    expect(createBody()).toMatchObject({ start: 'starter' })
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles')
  })

  it('hard-navigates to the console host when it runs on the auth host (AGL-3742)', async () => {
    mockWidgets = []
    mockLanding = (url) => `https://app.aglyn.com${url}`
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    await submit()
    expect(mockHardNavigate).toHaveBeenCalledWith(
      'https://app.aglyn.com/acme/hosts/royal-styles',
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders nothing at all while closed', () => {
    const { container } = render(<CreateHostDialog open={false} onClose={() => undefined} />)
    expect(container.innerHTML).toBe('')
    expect(mockZone).toBeNull()
  })
})
