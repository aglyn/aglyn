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
 * AGL-1934: Aglyn Assist must not run against an org the URL never named.
 *
 * Every case below sets up a FULLY RESOLVED, entitled org — the same fixture
 * the positive case uses to render a working panel — and changes only the
 * route. That is the whole point: `orgId` is truthy, the plan carries
 * `aiAssist`, and the panel must still not appear and must still send
 * nothing, because the org that answered is one the picker never asked
 * about. A case that also blanked the org would pass with the gate deleted.
 *
 * The load-bearing assertion is the POST, not the pixels. A hidden panel that
 * still fired `/api/assist/chat` would leave the reported defect exactly
 * where it was — a message metered to a workspace nobody opened — so the
 * network is recorded in every case and asserted empty, and the paired
 * positive asserts the request still carries the real org id.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// The component streams the answer through a TextDecoder. jsdom does not
// ship one; without this the send path throws before the assertion.
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}

/** Every request the panel made, as `[url, parsedBody]`. */
const posts: Array<[string, Record<string, unknown>]> = []

/**
 * The route's own answer to "which workspace is this page about", and the org
 * the scope resolved to. Defaults are an org route whose slug the resolved
 * org matches, so the positive case needs no setup of its own.
 */
const routeScope = {
  namesOrg: true,
  pathOrgSlug: 'acme' as string | null,
  orgSlug: null as string | null,
  /** What `usePathname()` answers — the same URL the other fields describe. */
  pathname: '/acme/hosts',
  currentOrg: { $id: 'org-1', slug: 'acme' } as { $id: string; slug?: string },
}

/**
 * A real, resolved, ENTITLED org — never blanked by any case here. The whole
 * bug is that this object is present on a page that named no workspace.
 */
const currentOrg = {
  org: { plan: 'pro', billingStatus: 'active' } as Record<string, unknown>,
  orgId: 'org-1',
  ready: true,
}

let mockFlagVisible = true

/** The reader's AI verdict (AGL-2927); granted unless a case says otherwise. */
const aiPermissions = { loaded: true, use: true, generate: true }
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => ({ title: '', excerpt: '', href: '' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  HelpTip: () => null,
  AppLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as string}</a>
  ),
  MdiIcon: () => <span />,
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => routeScope.pathname,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

// The AI add-on as its plugin declares it (AGL-2939): the entitlement gate
// folds `aiAddon` only once the declaration is registered.
import '../declarations'
import AssistPanelComponent from './assist-panel.component'

/**
 * The canned `/api/assist/chat` response, or null for "this test must not
 * reach the network". Held separately from the `fetch` mock rather than armed
 * with `mockResolvedValue`, which would replace the recording implementation
 * and silently empty `posts` — the very array these suites assert on.
 */
let chatResponse: unknown = null

/** One SSE `done` event, enough for the send path to complete cleanly. */
function armChatResponse(): void {
  const frame = `data: ${JSON.stringify({
    type: 'done',
    exchangeId: 'exchange-1',
    docs: [],
  })}\n\n`
  const chunks = [new TextEncoder().encode(frame)]
  chatResponse = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length
            ? { done: false, value: chunks.shift() }
            : { done: true, value: undefined },
      }),
    },
  }
}

/**
 * Open the drawer, type a question, press send — and do nothing at all if the
 * panel is not on the page.
 *
 * The tolerance is the point, not a convenience. Asserting "no POST" on a
 * route where the panel never rendered proves nothing: there was no way to
 * send in the first place, so the assertion passes just as well with the gate
 * deleted. Driving the real control whenever one exists is what makes the
 * picker's `posts` assertion fail the moment the panel comes back.
 *
 * Returns whether there was anything to drive.
 */
async function ask(question: string): Promise<boolean> {
  const fab = screen.queryByLabelText('Open Aglyn Assist')
  if (!fab) return false
  fireEvent.click(fab)
  fireEvent.change(await screen.findByPlaceholderText('How do I…'), {
    target: { value: question },
  })
  // `getByRole` rather than `getByLabelText` (AGL-2128): the send button now
  // sits inside a MUI Tooltip, which wraps it in a <span> and copies the
  // title onto that span as an aria-label — so a label query matches two
  // elements. The role query names the BUTTON, which is what this is
  // clicking, and is the more precise question either way.
  fireEvent.click(
    screen.getByRole('button', { name: 'Send message' }),
  )
  return true
}

beforeEach(() => {
  posts.length = 0
  aiPermissions.loaded = true
  aiPermissions.use = true
  aiPermissions.generate = true
  mockFlagVisible = true
  currentOrg.org = { plan: 'pro', billingStatus: 'active' }
  currentOrg.orgId = 'org-1'
  routeScope.namesOrg = true
  routeScope.pathOrgSlug = 'acme'
  routeScope.orgSlug = null
  routeScope.pathname = '/acme/hosts'
  routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
  sessionStorage.clear()
  chatResponse = null
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    posts.push([String(url), JSON.parse(String(init?.body ?? '{}'))])
    if (!chatResponse) throw new Error(`unarmed request to ${url}`)
    return chatResponse
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())


/**
 * What the shell's dock wrapper would hand the panel, computed from the
 * same doubles the cases mutate (AGL-2940): the URL's scope verdict and
 * the org read, the flag verdict, the reader's AI permissions.
 */
function dockProps() {
  const wrongOrg = Boolean(
    routeScope.pathOrgSlug && routeScope.currentOrg?.slug && routeScope.currentOrg.slug !== routeScope.pathOrgSlug,
  )
  return {
    orgId: currentOrg.orgId,
    org: currentOrg.org,
    orgReady: currentOrg.ready,
    scopedOrgId: routeScope.namesOrg && !wrongOrg ? currentOrg.orgId : undefined,
    orgSlug: routeScope.pathOrgSlug ?? routeScope.currentOrg?.slug ?? '',
    hostId: 'host-1',
    productName: 'Aglyn',
    assistVisible: mockFlagVisible,
    assistStaffPreview: false,
    generativeVisible: true,
    isStaff: false,
    aiPermissions,
  }
}

describe('Aglyn Assist off an org-scoped route (AGL-1934)', () => {
  /** The picker: `/` on the apex, no path slug, no subdomain. */
  const onThePicker = () => {
    routeScope.namesOrg = false
    routeScope.pathOrgSlug = null
    routeScope.orgSlug = null
    routeScope.pathname = '/'
    // The fallback the scope hands out anyway — a remembered selection or the
    // user's first org. Present on purpose: this is the reported bug's exact
    // state, an org fully resolved on a page that named none.
    routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
  }

  it('renders no panel on the workspace picker', async () => {
    onThePicker()
    const { container } = render(<AssistPanelComponent {...dockProps()} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByLabelText('Open Aglyn Assist')).toBeNull()
  })

  it('posts NOTHING from the picker, even when a question is typed', async () => {
    // The one that matters, and the one that has to be driven rather than
    // observed. A panel merely hidden while its send path stayed reachable
    // would still bill a workspace the user never opened — and a bare "no
    // fetch after mount" would pass in that state, because nothing posts on
    // mount either way. So `ask` presses the real send control if the panel
    // is there at all: with the gate removed the panel renders, the click
    // lands, and this goes red.
    onThePicker()
    armChatResponse()
    render(<AssistPanelComponent {...dockProps()} />)
    const driven = await ask('How do I publish my first screen?')
    // The money assertion first, so a regression reports the BILLING fact —
    // "a request went out from the picker" — rather than the structural one.
    await waitFor(() => expect(posts).toEqual([]))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(driven).toBe(false)
  })

  it('files no session thread under the fallback org', async () => {
    // Gating only the render would still key the thread on the fallback org
    // on every mount — an org-scoped artifact created by a page that named
    // no org.
    onThePicker()
    render(<AssistPanelComponent {...dockProps()} />)
    await waitFor(() => expect(posts).toEqual([]))
    expect(sessionStorage.getItem('aglyn-assist:org-1')).toBeNull()
  })

  it('stays hidden when the resolved org contradicts the URL slug', async () => {
    // The URL names a workspace, so `useUrlNamesOrg()` alone would let this
    // through — but the scope fell through to a DIFFERENT org (a shared link
    // to a workspace this user is not in).
    routeScope.namesOrg = true
    routeScope.pathOrgSlug = 'other-org'
    routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
    armChatResponse()
    const { container } = render(<AssistPanelComponent {...dockProps()} />)
    expect(await ask('Where is billing?')).toBe(false)
    await waitFor(() => expect(posts).toEqual([]))
    expect(container.innerHTML).toBe('')
  })

  it('still opens when the membership row carries no slug at all', async () => {
    // The deliberate NON-suppression (AGL-1916's rule). `slug` is optional on
    // the membership doc, and a legacy row without one must not kill the
    // assistant on a route that is perfectly legitimate — only a slug that
    // actively DISAGREES suppresses. If this ever flips to hidden, the gate
    // has become a feature outage.
    routeScope.namesOrg = true
    routeScope.pathOrgSlug = 'acme'
    routeScope.currentOrg = { $id: 'org-1' }
    render(<AssistPanelComponent {...dockProps()} />)
    expect(screen.getByLabelText('Open Aglyn Assist')).toBeTruthy()
  })
})

describe('the gate is a scope check, not a kill switch (AGL-1934)', () => {
  it('opens on an org route and meters the org the URL named', async () => {
    // Unchanged defaults: URL names the workspace, resolved org agrees. Do
    // not trade the false positive for a dead assistant — or for an
    // assistant that answers and never bills.
    armChatResponse()
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('How do I publish my first screen?')
    await waitFor(() => expect(posts).toHaveLength(1))
    const [url, body] = posts[0]
    expect(url).toBe('/api/assist/chat')
    expect(body).toMatchObject({
      orgId: 'org-1',
      question: 'How do I publish my first screen?',
    })
  })

  it('sends the page context the server scopes the request by', async () => {
    // The server refuses a request that names no workspace
    // (`assistScopeRefusal`), and this is the evidence it reads. A client
    // that stopped sending `route` would 403 every message — better than
    // mis-billing, but it must not happen silently.
    armChatResponse()
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Where is billing?')
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0][1].context).toMatchObject({ route: '/acme/hosts' })
  })

  it('stays hidden while the release flag is off, org route or not', async () => {
    mockFlagVisible = false
    const { container } = render(<AssistPanelComponent {...dockProps()} />)
    await waitFor(() => expect(posts).toEqual([]))
    expect(container.innerHTML).toBe('')
  })
})

/**
 * The AI jobs drawer (AGL-2904) rides inside the panel, scoped to the same
 * org the thread is. It is a mount check, not a behavior one: the drawer's
 * own spec drives its list, stream and cancel; what this pins is that the
 * panel puts it on the page for a workspace that carries the add-on and
 * not for one that does not.
 */
describe('the AI jobs drawer is mounted in the panel (AGL-2904)', () => {
  it('is on the page for a workspace with the AI add-on, collapsed', async () => {
    currentOrg.org = {
      plan: 'pro',
      billingStatus: 'active',
      seatAddons: { aiAddon: true },
    }
    render(<AssistPanelComponent {...dockProps()} />)
    fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
    expect(await screen.findByLabelText('Show AI jobs')).toBeTruthy()
    // Collapsed, so opening the panel made no request the thread did not.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('is absent on a plan without aiGenerative', async () => {
    render(<AssistPanelComponent {...dockProps()} />)
    fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
    await screen.findByPlaceholderText('How do I…')
    expect(screen.queryByLabelText('Show AI jobs')).toBeNull()
  })
})

/**
 * What a person reads when the server can go no further (AGL-2486).
 *
 * "Aglyn Assist is not configured on this deployment" names a deployment the
 * reader does not administer and a configuration they cannot see. Met in a
 * besigner drawer on the second question of a thread whose first question was
 * answered in full, it reads as the product breaking rather than as a limit.
 *
 * The server hands back the closest docs pages whenever it has any, so a
 * 501 reaching this branch at all is rare — which makes the words it prints
 * more important, not less: it is the one message left with nothing else to
 * offer.
 */
describe('the reader’s own permission closes the input (AGL-2927)', () => {
  it('a role without `ai.use` cannot send, and is told who to ask', async () => {
    aiPermissions.use = false
    render(<AssistPanelComponent {...dockProps()} />)
    fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
    const input = (await screen.findByPlaceholderText('How do I…')) as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/ask an organization admin/)).toBeTruthy()
    expect(posts).toEqual([])
  })

  it('HOLDS while the answer is pending — no grant from a loading default', async () => {
    aiPermissions.loaded = false
    aiPermissions.use = false
    render(<AssistPanelComponent {...dockProps()} />)
    fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
    const input = (await screen.findByPlaceholderText('How do I…')) as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    expect(screen.queryByText(/ask an organization admin/)).toBeNull()
    expect(posts).toEqual([])
  })

  it('the CONTROL: a granted role sends', async () => {
    armChatResponse()
    render(<AssistPanelComponent {...dockProps()} />)
    expect(await ask('How do I publish?')).toBe(true)
    await waitFor(() => expect(posts.length).toBe(1))
  })
})

describe('a refusal is written for the person reading it', () => {
  const armRefusal = (status: number, error: string) => {
    chatResponse = {
      ok: false,
      status,
      body: null,
      json: async () => ({ error }),
    }
  }

  it('turns a 501 into plain English, not deployment vocabulary', async () => {
    armRefusal(501, 'Aglyn Assist is not configured (ANTHROPIC_API_KEY).')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('How do I publish my first screen?')
    const notice = await screen.findByText(/could not find anything/i)
    const text = notice.textContent ?? ''
    // The operator's half of the message must not be relayed to the user —
    // it is in the API body for an operator, who reads logs, not drawers.
    expect(text).not.toMatch(/ANTHROPIC|API[_ ]KEY/i)
    expect(text).not.toMatch(/not configured|deployment/i)
    // …and it must still say what to do next and who can fix it, which is
    // what the old line never did.
    expect(text).toMatch(/different words/i)
    expect(text).toMatch(/set up this workspace|enabling the assistant/i)
  })
})
