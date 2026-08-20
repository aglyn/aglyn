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

import { render, waitFor } from '@testing-library/react'

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
let response: { ok: boolean; entries: unknown[] } = { ok: true, entries: [] }

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
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    fetches.push({
      url: String(url),
      authorization:
        ((init?.headers ?? {}) as Record<string, string>)['Authorization'] ?? null,
    })
    return {
      ok: response.ok,
      json: async () => ({ entries: response.entries }),
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
