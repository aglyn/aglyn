/**
 * @jest-environment jsdom
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
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'

/**
 * The customer's audit feed reads through the ROUTE, never the client SDK
 * (AGL-2292 → AGL-2444).
 *
 * ## What this file used to guard, and where it went
 *
 * `OrgActivityCard` queried `orgs/{orgId}/activity` with `limit(200)` and no
 * `orderBy`, so the window was a pseudo-random SAMPLE that the client sort
 * then dutifully ordered — it looked correct and was wrong. That ordering
 * property still matters and still has a guard, but the query moved into
 * `/api/orgs/activity`, so the guard moved with it:
 * `org-activity-route-enforces-auditlog.spec.ts` asserts the `orderBy` and
 * the cap. Deleting the query and the assertion together would have retired
 * the property along with the code.
 *
 * ## What it guards NOW
 *
 * That the component reads through that route at all. `org.auditLog` was a
 * display gate — the team page decided whether to mount this card, while the
 * security rule let any org-wide member read the collection directly. A
 * component that went back to a client query would restore that hole while
 * the route's own tests stayed green, because they never look at the caller.
 *
 * The DOM ordering assertion is kept as the NEGATIVE CONTROL it always was:
 * it is green whatever the fetch returns, because the client tie-break sort
 * runs either way.
 */

/** Every `fetch` the component made, in call order. */
let fetches: Array<{ url: string; authorization: string | null }> = []
/** What the fake route answers with. */
let response: {
  ok: boolean
  status?: number
  entries: unknown[]
  nextCursor?: string | null
} = { ok: true, entries: [] }
/**
 * Cursor → page, when a case wants a real feed to walk rather than one
 * canned answer. The key is the `cursor` param the component sent, so a
 * component that failed to send one lands on the first page forever — which
 * is the failure this models, not a lucky pass.
 */
let pages: Record<string, { entries: unknown[]; nextCursor: string | null }> | null =
  null

const ENTRIES = [
  { $id: 'b', action: 'Middle action', actorId: 'u1', createdAt: { seconds: 200 } },
  { $id: 'c', action: 'Newest action', actorId: 'u1', createdAt: { seconds: 300 } },
  { $id: 'a', action: 'Oldest action', actorId: 'u1', createdAt: { seconds: 100 } },
]

/**
 * A FRESH object every call, deliberately — that is what the real provider
 * hands back, and a stable double would hide the bug this modelled: keying
 * the effect on the user object re-ran it on every render, so the card
 * fetched its own feed in a loop. An unfaithful fake manufactures a false
 * green; here it would have manufactured a shipped one.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'id-token' } }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme' }),
}))

/**
 * A client query must FAIL this suite, not slip past it. `firebase/firestore`
 * is stubbed to throw so a component that reached for it explodes rather than
 * quietly rendering an empty card — the shape a reinstated hole would take.
 */
jest.mock('firebase/firestore', () => {
  const refuse = () => {
    throw new Error('the activity card must not read Firestore directly')
  }
  return {
    collection: refuse,
    query: refuse,
    orderBy: refuse,
    limit: refuse,
    onSnapshot: refuse,
    getDocs: refuse,
  }
})

import OrgActivityCard from '../components/org-activity-card.component'

beforeEach(() => {
  fetches = []
  response = { ok: true, entries: ENTRIES }
  pages = null
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    fetches.push({
      url: String(url),
      authorization:
        ((init?.headers ?? {}) as Record<string, string>)['Authorization'] ?? null,
    })
    if (pages) {
      const cursor =
        new URL(String(url), 'http://localhost').searchParams.get('cursor') ?? ''
      const page = pages[cursor] ?? { entries: [], nextCursor: null }
      return { ok: true, status: 200, json: async () => page }
    }
    return {
      ok: response.ok,
      // A refusal has to carry its STATUS: 403 is the permission answering
      // and renders as an empty feed, while anything else is a read that
      // broke and has to say so. A mock with no status cannot tell them
      // apart, and neither could a component tested against it.
      status: response.status ?? (response.ok ? 200 : 403),
      json: async () => ({
        entries: response.entries,
        nextCursor: response.nextCursor ?? null,
      }),
    }
  })
})

describe('the org activity card reads the permission-gated route (AGL-2444)', () => {
  it('fetches /api/orgs/activity for its org, with the caller’s token', async () => {
    render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() => expect(fetches.length).toBeGreaterThan(0))
    expect(fetches[0].url).toContain('/api/orgs/activity')
    expect(fetches[0].url).toContain('orgId=org-1')
    // Unauthenticated, the route answers 401 and the card would be
    // permanently empty for everybody — the token is not optional.
    expect(fetches[0].authorization).toBe('Bearer id-token')
  })

  it('renders what the route returned', async () => {
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
  })

  it('a 403 renders an EMPTY feed rather than spinning forever', async () => {
    // A refusal is a real answer: this member's role does not carry
    // `org.auditLog`. Treating it as "still loading" would leave a permanent
    // spinner where the honest result is nothing.
    response = { ok: false, entries: [] }
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() => expect(fetches.length).toBeGreaterThan(0))
    await waitFor(() =>
      expect(view.container.textContent).not.toContain('Newest action'),
    )
  })

  it('fetches ONCE, not on every render', async () => {
    // The feed is not watched, it is fetched. Keying the effect on the user
    // OBJECT rather than its uid re-ran it on every render and drove the card
    // into a fetch loop — 1,183 requests before this assertion existed.
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    expect(fetches).toHaveLength(1)
  })

  it('NEGATIVE CONTROL — the rendered order proves nothing', async () => {
    // Green whatever the route returns, because the client tie-break sort
    // runs either way. Present so the difference between this and the real
    // ordering guard (now in the route's spec) is written down.
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    const text = view.container.textContent ?? ''
    expect(text.indexOf('Newest action')).toBeLessThan(text.indexOf('Oldest action'))
  })
})

/**
 * The route flattens `createdAt` to `{ seconds }`; the card has to READ that
 * shape.
 *
 * `entry.createdAt?.toDate?.().toLocaleString() ?? ''` survived the move to
 * the route (AGL-2444) unchanged, and a flattened timestamp has no `toDate`.
 * Optional-call syntax meant it threw nothing and returned nothing, so every
 * row rendered its separator with an empty string after it — "someone@ · " —
 * on the only audit surface a customer admin has. The date was not wrong, it
 * was absent, which is why nothing failed.
 */
describe('the timestamp the route actually sends', () => {
  it('renders a real date, not an empty string', async () => {
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    const text = view.container.textContent ?? ''
    // Whatever the runner's locale, second 300 of 1970 formats to a string
    // containing its year — and crucially not to '' or '[object Object]'.
    expect(text).toContain(new Date(300 * 1000).toLocaleString())
    expect(text).not.toContain('[object Object]')
  })

  it('an entry whose write has not resolved says so, rather than nothing', async () => {
    response = { ok: true, entries: [{ $id: 'x', action: 'Just now', createdAt: null }] }
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Just now'),
    )
    expect(view.container.textContent).toContain('—')
  })
})

describe('the feed pages (AGL-2292 follow-up)', () => {
  beforeEach(() => {
    pages = {
      '': {
        entries: [{ $id: 'c', action: 'Newest action', createdAt: { seconds: 300 } }],
        nextCursor: 'c',
      },
      c: {
        entries: [{ $id: 'b', action: 'Older action', createdAt: { seconds: 200 } }],
        nextCursor: null,
      },
    }
  })

  it('asks for a bounded page rather than a 200-row window', async () => {
    render(<OrgActivityCard orgId="org-1" pageSize={20} />)
    await waitFor(() => expect(fetches.length).toBeGreaterThan(0))
    expect(fetches[0].url).toContain('pageSize=20')
  })

  it('walks forward, sending the cursor the route handed back', async () => {
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    fireEvent.click(view.getByText('Next'))
    await waitFor(() =>
      expect(view.container.textContent).toContain('Older action'),
    )
    expect(fetches[1].url).toContain('cursor=c')
    // Rows 21+ were fetched and never rendered before this; reaching them
    // is the whole point.
    expect(view.container.textContent).not.toContain('Newest action')
    expect(view.container.textContent).toContain('Page 2')
  })

  it('walks back to the page it came from', async () => {
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    fireEvent.click(view.getByText('Next'))
    await waitFor(() =>
      expect(view.container.textContent).toContain('Older action'),
    )
    fireEvent.click(view.getByText('Previous'))
    await waitFor(() =>
      expect(view.container.textContent).toContain('Newest action'),
    )
    expect(view.container.textContent).toContain('Page 1')
  })

  it('offers no pager when the whole feed fits on one page', async () => {
    // A pager on a single-page feed is furniture, and a Next that leads
    // nowhere is worse than none.
    pages = { '': { entries: [{ $id: 'only', action: 'Only action' }], nextCursor: null } }
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Only action'),
    )
    expect(view.queryByText('Next')).toBeNull()
  })
})

describe('a read that FAILED is not a clean record (AGL-2486)', () => {
  it('a 403 renders an empty feed — the permission answering is a real answer', async () => {
    response = { ok: false, status: 403, entries: [] }
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() => expect(fetches.length).toBeGreaterThan(0))
    await waitFor(() =>
      expect(view.container.textContent).toContain('No activity yet'),
    )
    expect(view.container.textContent).not.toContain('Could not read')
  })

  it('a 500 says the log could not be read, NOT that nothing happened', async () => {
    response = { ok: false, status: 500, entries: [] }
    const view = render(<OrgActivityCard orgId="org-1" />)
    await waitFor(() =>
      expect(view.container.textContent).toContain('Could not read'),
    )
    expect(view.container.textContent).not.toContain('No activity yet')
  })
})
