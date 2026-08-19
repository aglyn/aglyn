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

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => currentOrg,
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => routeScope,
  useOrgScope: () => routeScope,
  useOrgSlug: () => routeScope.pathOrgSlug ?? routeScope.currentOrg?.slug ?? '',
}))

jest.mock('../hooks/use-secondary-nav', () => ({
  useUrlNamesOrg: () => routeScope.namesOrg,
}))

jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  default: () => ({ isStaff: false }),
  useReleaseFlag: () => ({ visible: mockFlagVisible, staffPreview: false }),
}))

jest.mock('./host-id-provider', () => ({
  __esModule: true,
  // Required lazily: a hoisted factory cannot close over an import.
  HostIdContext: require('react').createContext('host-1'),
}))

jest.mock('./docs-help-tip.component', () => ({
  __esModule: true,
  DocsHelpTip: () => null,
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: () => undefined,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
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
    const { container } = render(<AssistPanelComponent />)
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
    render(<AssistPanelComponent />)
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
    render(<AssistPanelComponent />)
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
    const { container } = render(<AssistPanelComponent />)
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
    render(<AssistPanelComponent />)
    expect(screen.getByLabelText('Open Aglyn Assist')).toBeTruthy()
  })
})

describe('the gate is a scope check, not a kill switch (AGL-1934)', () => {
  it('opens on an org route and meters the org the URL named', async () => {
    // Unchanged defaults: URL names the workspace, resolved org agrees. Do
    // not trade the false positive for a dead assistant — or for an
    // assistant that answers and never bills.
    armChatResponse()
    render(<AssistPanelComponent />)
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
    render(<AssistPanelComponent />)
    await ask('Where is billing?')
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0][1].context).toMatchObject({ route: '/acme/hosts' })
  })

  it('stays hidden while the release flag is off, org route or not', async () => {
    mockFlagVisible = false
    const { container } = render(<AssistPanelComponent />)
    await waitFor(() => expect(posts).toEqual([]))
    expect(container.innerHTML).toBe('')
  })
})
