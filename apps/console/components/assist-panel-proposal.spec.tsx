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
 * AGL-1988: level 2's client half — the two-depth answer, and the confirm
 * card that is the whole of "automate current view".
 *
 * The load-bearing assertion here is a NEGATIVE one, and it is deliberately
 * behavioural rather than a comment: confirming a proposal must make no
 * request at all. A card that quietly POSTed on confirm would satisfy every
 * pixel assertion in this file while being precisely the launch story the
 * scope decision exists to avoid — so the network is recorded on every case
 * and asserted, and the confirm control is checked to be a link to a
 * server-supplied path rather than a handler that could grow a body.
 *
 * Kept in its own file rather than added to `assist-panel.component.spec.tsx`
 * because that suite is AGL-1934's and answers a different question.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}

/** Every request the panel made, as `[url, parsedBody]`. */
const posts: Array<[string, Record<string, unknown>]> = []
const tracked: Array<[string, Record<string, unknown>]> = []

const routeScope = {
  namesOrg: true,
  pathOrgSlug: 'acme' as string | null,
  orgSlug: null as string | null,
  pathname: '/acme/hosts/host-1/screens',
  currentOrg: { $id: 'org-1', slug: 'acme' } as { $id: string; slug?: string },
}

const currentOrg = {
  org: { plan: 'pro', billingStatus: 'active' } as Record<string, unknown>,
  orgId: 'org-1',
  ready: true,
}

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => currentOrg,
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => routeScope,
  useOrgScope: () => routeScope,
  useOrgSlug: () => routeScope.pathOrgSlug ?? '',
}))

jest.mock('../hooks/use-secondary-nav', () => ({
  useUrlNamesOrg: () => routeScope.namesOrg,
}))

jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  default: () => ({ isStaff: false }),
  useReleaseFlag: () => ({ visible: true, staffPreview: false }),
}))

jest.mock('./host-id-provider', () => ({
  __esModule: true,
  HostIdContext: require('react').createContext('host-1'),
}))

jest.mock('./docs-help-tip.component', () => ({
  __esModule: true,
  DocsHelpTip: () => null,
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: (name: string, params: Record<string, unknown>) => {
    tracked.push([name, params])
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

// AppLink renders as a plain anchor here on purpose: the confirm control's
// whole safety property is that it is a LINK to a path the server chose, and
// an anchor is the shape that makes "it cannot submit" checkable.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({
    href,
    children,
    onClick,
  }: {
    href: string
    children: unknown
    onClick?: () => void
  }) => (
    <a href={href} onClick={onClick}>
      {children as string}
    </a>
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

import AssistPanelComponent, {
  splitAssistDisclosure,
} from './assist-panel.component'

const PROPOSAL = {
  id: 'open.host.screens',
  label: 'Open Screens',
  outcome: 'the list of pages on this site',
  href: '/acme/hosts/host-1/screens',
  values: [{ name: 'source', value: '/old-page' }],
  prefill: false,
}

let chatResponse: unknown = null

/** Arm one streamed answer, optionally carrying a proposal. */
function armChat(text: string, proposal: unknown = null): void {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text })}\n\n`,
    `data: ${JSON.stringify({
      type: 'done',
      exchangeId: 'exchange-1',
      docs: [],
      proposal,
    })}\n\n`,
  ]
  const chunks = frames.map((frame) => new TextEncoder().encode(frame))
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

async function ask(question = 'How do I publish?'): Promise<void> {
  fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
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
}

beforeEach(() => {
  posts.length = 0
  tracked.length = 0
  currentOrg.org = { plan: 'pro', billingStatus: 'active' }
  routeScope.pathname = '/acme/hosts/host-1/screens'
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

describe('GUARD: no write happens without an explicit confirm', () => {
  it('shows the proposal as a card the user has to act on', async () => {
    armChat('Open Screens and pick the page.', PROPOSAL)
    render(<AssistPanelComponent />)
    await ask()
    expect(await screen.findByText('Open Screens')).toBeTruthy()
    // The card states the boundary in the user's own words, not only ours.
    expect(
      screen.getByText(/Nothing is saved until you fill the form in/),
    ).toBeTruthy()
    // prefill is off, so the copy offers values to use — it does not claim
    // to have filled anything in.
    expect(screen.getByText('Values to use:')).toBeTruthy()
    expect(screen.queryByText('Filled in for you:')).toBeNull()
  })

  it('confirming NAVIGATES and sends nothing', async () => {
    armChat('Open Screens and pick the page.', PROPOSAL)
    render(<AssistPanelComponent />)
    await ask()
    const confirm = (await screen.findByText('Take me there')).closest('a')
    // A link to the path the SERVER chose — not a handler that could grow a
    // request body later.
    expect(confirm?.getAttribute('href')).toBe('/acme/hosts/host-1/screens')

    const before = posts.length
    fireEvent.click(confirm as Element)
    await waitFor(() =>
      expect(tracked.map(([name]) => name)).toContain(
        'assistant_proposal_confirmed',
      ),
    )
    // The load-bearing assertion: confirming caused no request at all.
    expect(posts.length).toBe(before)
    expect(posts.map(([url]) => url)).toEqual(['/api/assist/chat'])
  })

  it('declining removes the card and sends nothing', async () => {
    armChat('Open Screens and pick the page.', PROPOSAL)
    render(<AssistPanelComponent />)
    await ask()
    const before = posts.length
    fireEvent.click(await screen.findByText('No thanks'))
    await waitFor(() => expect(screen.queryByText('Take me there')).toBeNull())
    expect(posts.length).toBe(before)
  })

  it('renders no card when the answer proposed nothing', async () => {
    armChat('You publish from the screen detail page.', null)
    render(<AssistPanelComponent />)
    await ask()
    await screen.findByText(/You publish from the screen detail page/)
    expect(screen.queryByText('Take me there')).toBeNull()
  })

  it('the panel can reach exactly two endpoints, both read-only to the console', async () => {
    // A behavioural check cannot see an endpoint that no test happens to
    // trigger. This one reads the source: the day someone adds a third
    // fetch — a publish, an invite, a "just do it for me" — this fails
    // before it ships, whatever the UI does.
    const source = readFileSync(
      join(__dirname, 'assist-panel.component.tsx'),
      'utf8',
    )
    const urls = [...source.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1])
    expect([...new Set(urls)].sort()).toEqual([
      '/api/assist/chat',
      '/api/assist/feedback',
    ])
  })

  it('the confirm control is a link, and the card contains no form submit', async () => {
    const source = readFileSync(
      join(__dirname, 'assist-panel.component.tsx'),
      'utf8',
    )
    const card = source.slice(
      source.indexOf('function ProposalCard('),
      source.indexOf('export function AssistPanelComponent'),
    )
    expect(card).toContain('AppLink')
    expect(card).not.toMatch(/fetch\(/)
    expect(card).not.toMatch(/<form/)
    expect(card).not.toMatch(/method=/)
  })
})

describe('one answer, two depths', () => {
  it('splits the technical tail off the plain answer', () => {
    const { plain, technical } = splitAssistDisclosure(
      'Open Screens, then press Publish.\n\nUnder the hood: the route is /[orgSlug]/hosts/[host]/screens.',
    )
    expect(plain).toBe('Open Screens, then press Publish.')
    expect(technical).toBe('the route is /[orgSlug]/hosts/[host]/screens.')
  })

  it('leaves an answer with nothing technical to add completely alone', () => {
    // The common case. A marker that never appears must not cost the
    // beginner a toggle to click.
    const { plain, technical } = splitAssistDisclosure('Press Publish.')
    expect(plain).toBe('Press Publish.')
    expect(technical).toBe('')
  })

  it('does not collapse an answer that is ONLY a technical tail', () => {
    const { plain, technical } = splitAssistDisclosure(
      'Under the hood: it is a Firestore converter.',
    )
    expect(plain).toBe('Under the hood: it is a Firestore converter.')
    expect(technical).toBe('')
  })

  it('hides the developer layer until it is asked for', async () => {
    armChat(
      'Open Screens, then press Publish.\n\nUnder the hood: the route is /[orgSlug]/hosts/[host]/screens.',
    )
    render(<AssistPanelComponent />)
    await ask()
    // The beginner sees the steps and a toggle; not the route.
    await screen.findByText(/Open Screens, then press Publish/)
    expect(screen.getByText('Under the hood')).toBeTruthy()
    expect(screen.queryByText(/the route is/)).toBeNull()

    fireEvent.click(screen.getByText('Under the hood'))
    // The developer gets it in one click, without asking a follow-up.
    expect(await screen.findByText(/the route is/)).toBeTruthy()
  })
})
