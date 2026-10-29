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
 * - the starter creates the site WITH the starter, in one request, only in a
 *   style the person chose (AGL-4049: nothing is chosen for anyone), and
 *   lands on it with "Your site is live";
 * - a start the widget begins creates the site empty, once, and leaves the
 *   navigation to the widget;
 * - refusals the console can see coming — a role without `hosts.create`, a
 *   plan with no site left, a taken address — are said before anything is
 *   created;
 * - a site created for a start that then could not begin is given the
 *   starter on the way out, so none is left empty;
 * - a workspace with no start to offer gets the plain dialog, which asks the
 *   style too and creates nothing until one is chosen (AGL-4049);
 * - `host_created` carries how the site was started and its style, from the
 *   create's own answer;
 * - with `release_site_starters` visible, the starter path is "Choose your
 *   starter" (AGL-4049 lane 3): nothing chosen, Create waits for a pick it
 *   may create from, a free pick creates from its listing and lands naming
 *   it, a 402 keeps the pick for Buy, a refused pick is cleared in words,
 *   Close creates nothing, and the way back from paying reopens the pick.
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
    useSearchParams: () => mockSearchParams,
  }
})
let mockSearchParams = new URLSearchParams()
let mockStartersVisible = false
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({
    released: false,
    visible: mockStartersVisible,
    staffPreview: mockStartersVisible,
    isStaff: mockStartersVisible,
    ready: true,
  }),
}))
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
  SITE_LIVE_STARTER_PARAM: 'starterName',
}))

/** What the start zone was handed, as its one widget would receive it. */
type ZoneProps = {
  hostId: string | null
  startBlank: (options?: { style?: string }) => void | Promise<boolean>
  leave: () => void
  chooseStarter?: () => void
  pendingSite: {
    fields: React.ReactNode
    check: () => boolean
    dirty: boolean
    create: (options?: { start?: 'import'; style?: string }) => Promise<Record<string, unknown>>
    created: Record<string, unknown> | null
    ready: (shown: boolean) => void
  }
}
/** What the starter picker zone was handed (AGL-4049 lane 3). */
type PickerProps = {
  mode: 'base' | 'ai'
  search: string
  filter: Record<string, string>
  onPick: (pick: Record<string, unknown>) => void
  ready: (shown: boolean) => void
  selected?: { listingId: string; owned?: boolean } | null
}
let mockZone: ZoneProps | null = null
let mockPicker: PickerProps | null = null
let mockWidgets: unknown[] = [{ widgetId: 'ai-site-start' }]
let mockPickerWidgets: unknown[] = []
const mockSlotZones: string[][] = []
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  useSlotWidgets: (zones: string[]) => {
    mockSlotZones.push([...zones])
    return {
      widgets: zones.includes('hostStarterPicker') ? mockPickerWidgets : zones.length ? mockWidgets : [],
      ready: true,
    }
  },
  // The widget, as a probe: it draws the shell's fields where a real one
  // would, on its first step.
  default: (props: ZoneProps & PickerProps & { slot: string }) => {
    if (props.slot === 'hostStarterPicker') {
      mockPicker = props
      return <div data-testid="starter-picker" />
    }
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
  mockPicker = null
  mockWidgets = [{ widgetId: 'ai-site-start' }]
  mockPickerWidgets = []
  mockSlotZones.length = 0
  mockStartersVisible = false
  mockSearchParams = new URLSearchParams()
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
      starterChoice: { listingId: null, version: null, kind: 'trades', mode: 'base', start: 'starter' },
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
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(0)
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
  it('creates it once, with the starter in the style chosen, lands on it live, and reports both (AGL-4049)', async () => {
    const { onClose } = await openStart()
    typeName()
    let done: boolean | void = undefined
    await act(async () => {
      done = await mockZone?.startBlank({ style: 'trades' })
    })
    expect(done).toBe(true)
    expect(createCalls()).toHaveLength(1)
    expect(createBody()).toMatchObject({
      displayName: 'Royal Styles',
      subdomain: 'royal-styles',
      orgId: 'org-1',
      start: 'starter',
      style: 'trades',
    })
    // How it was started and its style, from the create's own answer.
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toEqual([
      ['host_created', { start: 'starter', starter_kind: 'trades', starter_listing: 'none' }],
    ])
    expect(mockTrack).toHaveBeenCalledWith('site_published', { first_publish: true })
    expect(onClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles?start=live')
  })

  it('the starter path asks for a style and creates nothing until one is chosen (AGL-4049)', async () => {
    const { onClose } = await openStart()
    typeName()
    let done: boolean | void = undefined
    await act(async () => {
      done = await mockZone?.startBlank()
    })
    // Red before the fix: the starter was created in the default look.
    expect(done).toBe(false)
    expect(createCalls()).toHaveLength(0)
    expect(mockSnackbar).toHaveBeenCalledWith(
      'Choose a style for your site first.',
      expect.objectContaining({ variant: 'warning' }),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(0)
  })

  it('creates nothing without a name, and says what is missing', async () => {
    await openStart()
    let done: boolean | void = undefined
    await act(async () => {
      done = await mockZone?.startBlank({ style: 'trades' })
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
      await mockZone?.startBlank({ style: 'trades' })
    })
    expect(mockSnackbar).toHaveBeenCalledWith(
      'Site limit reached (1) — upgrade or add extra sites from Billing',
      expect.objectContaining({ variant: 'error' }),
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(0)
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
    expect(createBody()).not.toHaveProperty('style')
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockZone?.pendingSite.created).toEqual(site)
    // Asked again — a job that could not start, retried — it is the same site.
    await act(async () => {
      await mockZone?.pendingSite.create()
    })
    expect(createCalls()).toHaveLength(1)
    expect(mockTrack.mock.calls.filter(([name]) => name === 'host_created')).toHaveLength(1)
  })

  it('posts the style the questions took, for the site to record (AGL-4049)', async () => {
    mockCreateAnswer.body.starterChoice = { listingId: null, version: null, kind: 'auto', mode: 'base', start: 'ai' }
    await openStart()
    typeName()
    await act(async () => {
      await mockZone?.pendingSite.create({ style: 'auto' })
    })
    expect(createBody()).toMatchObject({ style: 'auto' })
    expect(createBody()).not.toHaveProperty('start')
    expect(mockTrack).toHaveBeenCalledWith('host_created', { start: 'ai', starter_kind: 'auto', starter_listing: 'none' })
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
      await mockZone?.startBlank({ style: 'yoga' })
    })
    // In the style its questions took (AGL-4049).
    expect(mockStarter).toHaveBeenCalledWith({ uid: 'u-1' }, 'host-1', { style: 'yoga' })
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
  /** The style card the plain dialog draws (AGL-4049), by its name. */
  const styleCard = (name: RegExp) => screen.getByRole('radio', { name })
  const createButton = () => screen.getByRole('button', { name: 'Create site' }) as HTMLButtonElement
  const submit = async (style: RegExp | null = /^Home services & trades/) => {
    typeName()
    if (style) fireEvent.click(styleCard(style))
    await act(async () => {
      fireEvent.click(createButton())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('creates the site with the starter in the style chosen on Create site, and lands on it', async () => {
    mockWidgets = []
    mockCreateAnswer.body.guidedStart = false
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    expect(screen.getByText('Create a new site')).toBeTruthy()
    await submit()
    // Never empty for a start this dialog did not offer (AGL-3859).
    expect(createBody()).toMatchObject({ start: 'starter', style: 'trades' })
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles')
  })

  it('the plain form requires a style: nothing chosen, and Create is disabled without one (AGL-4049)', async () => {
    mockWidgets = []
    render(<CreateHostDialog open onClose={() => undefined} />)
    await flush()
    expect(screen.getByText('Choose a style')).toBeTruthy()
    const cards = screen.getAllByRole('radio')
    expect(cards).toHaveLength(21)
    for (const card of cards) expect(card.getAttribute('aria-checked')).toBe('false')
    typeName()
    // Red before the fix: a name was all Create site needed.
    expect(createButton().disabled).toBe(true)
    expect(screen.getByText('Choose a style to create your site.')).toBeTruthy()
    await submit(null)
    expect(createCalls()).toHaveLength(0)
    fireEvent.click(styleCard(/^Yoga & mindfulness/))
    expect(styleCard(/^Yoga & mindfulness/).getAttribute('aria-checked')).toBe('true')
    expect(createButton().disabled).toBe(false)
    expect(screen.queryByText('Choose a style to create your site.')).toBeNull()
    // Each card shows its example home page.
    const picture = styleCard(/^Yoga & mindfulness/).querySelector('img')
    expect(picture?.getAttribute('src')).toBe('/_static/starter/styles/yoga.webp')
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

describe('AGL-4049 lane 3 · Choose your starter, behind release_site_starters', () => {
  const FREE = {
    listingId: 'fp-starter-restaurant-base',
    displayName: 'Restaurant & café',
    description: '',
    authorName: 'Aglyn',
    official: true,
    priceUsd: 0,
    previewImageUrl: null,
    facets: { kind: 'restaurant', base: 'starter', fonts: null, pages: 4, mode: 'base' },
  }
  const PAID = { ...FREE, listingId: 'northwind-studio', displayName: 'Studio North', official: false, priceUsd: 12 }
  const createButton = () => screen.getByRole('button', { name: 'Create site' }) as HTMLButtonElement
  const create = async () => {
    await act(async () => {
      fireEvent.click(createButton())
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  const pick = (row: Record<string, unknown>) => act(() => mockPicker?.onPick(row))
  /** Opens the start, lets the picker's first search answer `shown`. */
  const openOffered = async (shown = true, onClose = jest.fn()) => {
    const view = await openStart(onClose)
    act(() => mockPicker?.ready(shown))
    return view
  }
  /** Opens the start with the picker offered, and takes its starter path. */
  const openChoose = async (onClose = jest.fn()) => {
    const view = await openOffered(true, onClose)
    act(() => mockZone?.chooseStarter?.())
    act(() => mockPicker?.ready(true))
    return view
  }
  /** Opens Create site on the way back from paying, both answers in. */
  const openReturn = async (initialStarter: { listingId: string; purchase: 'success' | 'canceled' | null }) => {
    render(<CreateHostDialog open onClose={jest.fn()} initialStarter={initialStarter} />)
    await flush()
    act(() => mockZone?.pendingSite.ready(true))
    act(() => mockPicker?.ready(true))
  }

  beforeEach(() => {
    mockStartersVisible = true
    mockPickerWidgets = [{ widgetId: 'marketplace-starter-picker' }]
    mockCreateAnswer.body = {
      ...mockCreateAnswer.body,
      guidedStart: false,
      starterChoice: {
        listingId: FREE.listingId,
        version: null,
        kind: 'restaurant',
        mode: 'base',
        start: 'starter',
      },
      starter: { listingId: FREE.listingId, version: null, displayName: 'Restaurant & café' },
    }
  })

  it('with the flag off, asks no picker and offers the start nothing new', async () => {
    mockStartersVisible = false
    await openStart()
    // Red before the fix would be no change: this pins that off stays off.
    expect(mockZone?.chooseStarter).toBeUndefined()
    expect(mockSlotZones.some((zones) => zones.includes('hostStarterPicker'))).toBe(false)
  })

  it('asks the picker first, out of sight, and holds the start under the overlay until it answers', async () => {
    await openStart()
    expect(screen.queryByTestId('start-zone')).toBeTruthy()
    expect(document.querySelector('[data-create-area="starter-probe"]')).toBeTruthy()
    expect(mockDequeueLoading).not.toHaveBeenCalled()
    act(() => mockPicker?.ready(true))
    expect(mockDequeueLoading).toHaveBeenCalled()
    expect(document.querySelector('[data-create-area="starter-probe"]')).toBeNull()
  })

  it('leaves the start exactly as it was where the picker has no starters to offer', async () => {
    await openOffered(false)
    expect(mockZone?.chooseStarter).toBeUndefined()
    expect(screen.getByTestId('start-zone')).toBeTruthy()
  })

  it('with the flag on, the starter path opens Choose your starter with nothing chosen', async () => {
    await openOffered(true)
    // Red before the fix: the start was never handed a way to the picker.
    expect(typeof mockZone?.chooseStarter).toBe('function')
    act(() => mockZone?.chooseStarter?.())
    expect(screen.getByRole('heading', { name: 'Choose your starter' })).toBeTruthy()
    expect(screen.getByTestId('starter-picker')).toBeTruthy()
    expect(mockPicker?.selected).toBeNull()
    expect(mockPicker?.mode).toBe('base')
    // The AI starters tab, beside the start that fills them.
    expect(screen.getByRole('tab', { name: 'AI starters' })).toBeTruthy()
    // It takes the start's place: the name and address are asked once.
    expect(screen.queryByTestId('start-zone')).toBeNull()
    expect(screen.getAllByLabelText('Site name')).toHaveLength(1)
    expect(createCalls()).toHaveLength(0)
  })

  it('Create is disabled until a pick, and until a priced pick is owned', async () => {
    await openChoose()
    typeName()
    expect(createButton().disabled).toBe(true)
    expect(screen.getByText('Choose a starter to create your site.')).toBeTruthy()
    pick(PAID)
    expect(createButton().disabled).toBe(true)
    expect(screen.getByText('Buy this starter to create your site from it.')).toBeTruthy()
    pick({ ...PAID, owned: true })
    expect(createButton().disabled).toBe(false)
    pick(FREE)
    expect(createButton().disabled).toBe(false)
    expect(mockPicker?.selected).toEqual({ listingId: FREE.listingId })
  })

  it('a free pick posts `starter` and lands live naming it', async () => {
    const { onClose } = await openChoose()
    typeName()
    pick(FREE)
    await create()
    expect(createCalls()).toHaveLength(1)
    expect(createBody()).toMatchObject({ start: 'starter', starter: { listingId: FREE.listingId } })
    expect(createBody()).not.toHaveProperty('style')
    expect(mockTrack).toHaveBeenCalledWith('host_created', {
      start: 'starter',
      starter_kind: 'restaurant',
      starter_listing: FREE.listingId,
    })
    expect(onClose).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles?start=live&starterName=Restaurant+%26+caf%C3%A9')
  })

  it('a 402 keeps the pick and shows Buy', async () => {
    mockCreateAnswer = {
      status: 402,
      body: { error: 'Purchase required', code: 'purchase_required', listingId: PAID.listingId, priceUsd: 12 },
    }
    await openChoose()
    typeName()
    pick({ ...PAID, owned: true })
    await create()
    expect(screen.getByText('Purchase required')).toBeTruthy()
    // Kept, now unowned, so the picker offers Buy and continue again.
    expect(mockPicker?.selected).toEqual({ listingId: PAID.listingId, owned: false })
    expect(createButton().disabled).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('a 402 straight after paying says the payment is being confirmed, and offers no second purchase', async () => {
    mockCreateAnswer = {
      status: 402,
      body: { error: 'Purchase required', code: 'purchase_required', listingId: PAID.listingId, priceUsd: 12 },
    }
    await openReturn({ listingId: PAID.listingId, purchase: 'success' })
    pick(PAID)
    typeName()
    await create()
    expect(screen.getByText('Your payment is still being confirmed. Try Create site again in a moment.')).toBeTruthy()
    expect(mockPicker?.selected).toEqual({ listingId: PAID.listingId, owned: true })
  })

  it.each([
    [403, 'Site starters are not available for this workspace yet'],
    [404, 'That starter is no longer available'],
    [409, 'This starter needs the AI start, which is coming soon'],
  ])('a %i is shown in words, and the pick cleared', async (status, error) => {
    mockCreateAnswer = { status, body: { error, listingId: FREE.listingId } }
    await openChoose()
    typeName()
    pick(FREE)
    await create()
    expect(screen.getByText(error)).toBeTruthy()
    expect(mockPicker?.selected).toBeNull()
    expect(createButton().disabled).toBe(true)
    // Not read as a taken address.
    expect(screen.queryByText('royal-styles-2')).toBeNull()
  })

  it('Close creates nothing, and Back returns to the start', async () => {
    const { onClose } = await openChoose()
    typeName()
    pick(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('heading', { name: 'Choose your starter' })).toBeNull()
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    act(() => mockZone?.chooseStarter?.())
    fireEvent.click(screen.getByRole('button', { name: 'Close Create site' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createCalls()).toHaveLength(0)
  })

  it('`?create=site&starter=` reopens the pick', async () => {
    mockSearchParams = new URLSearchParams('create=site&starter=northwind-studio&purchase=success')
    const { CreateSiteFromUrl } = jest.requireActual(
      '../components/create-host-dialog.component',
    ) as typeof import('../components/create-host-dialog.component')
    const onOpen = jest.fn()
    const url = render(<CreateSiteFromUrl onOpen={onOpen} />)
    expect(onOpen).toHaveBeenCalledWith({ listingId: 'northwind-studio', purchase: 'success' })
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts')
    url.unmount()

    // The dialog opens straight on Choose your starter, that card chosen, owned.
    await openReturn({ listingId: 'northwind-studio', purchase: 'success' })
    expect(screen.getByRole('heading', { name: 'Choose your starter' })).toBeTruthy()
    expect(mockPicker?.selected).toEqual({ listingId: 'northwind-studio', owned: true })
    // The picker hands it back once read; Create waits only for the name.
    pick(PAID)
    typeName()
    expect(createButton().disabled).toBe(false)
  })

  it('a pick restored after cancelling shows Buy again', async () => {
    await openReturn({ listingId: 'northwind-studio', purchase: 'canceled' })
    expect(mockPicker?.selected).toEqual({ listingId: 'northwind-studio' })
    pick(PAID)
    typeName()
    expect(createButton().disabled).toBe(true)
  })

  it('with no start to offer, Create site is Choose your starter, without the AI tab, and the styles when the picker has none', async () => {
    mockWidgets = []
    render(<CreateHostDialog open onClose={jest.fn()} />)
    await flush()
    act(() => mockPicker?.ready(true))
    expect(screen.getByRole('heading', { name: 'Choose your starter' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'AI starters' })).toBeNull()
    act(() => mockPicker?.ready(false))
    // The plain dialog, as with the flag off.
    expect(screen.getByText('Create a new site')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(21)
  })

  it('the styles stand in for a picker that has nothing to offer after all, on the start’s path', async () => {
    await openOffered(true)
    act(() => mockZone?.chooseStarter?.())
    act(() => mockPicker?.ready(false))
    expect(screen.getByRole('heading', { name: 'Choose a style' })).toBeTruthy()
    typeName()
    fireEvent.click(screen.getByRole('radio', { name: /^Yoga & mindfulness/ }))
    await create()
    expect(createBody()).toMatchObject({ start: 'starter', style: 'yoga' })
  })

  it('narrows the picker to a kind and a search, and changing the tab clears the pick', async () => {
    await openChoose()
    fireEvent.click(screen.getByRole('button', { name: 'Photography' }))
    expect(mockPicker?.filter).toEqual({ kind: 'photography' })
    fireEvent.change(screen.getByLabelText('Search starters'), { target: { value: 'bistro' } })
    expect(mockPicker?.search).toBe('bistro')
    pick(FREE)
    fireEvent.click(screen.getByRole('tab', { name: 'AI starters' }))
    expect(mockPicker?.mode).toBe('ai')
    expect(mockPicker?.selected).toBeNull()
  })
})
