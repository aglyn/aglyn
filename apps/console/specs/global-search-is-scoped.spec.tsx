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
 * AGL-2179: every result console search can show is one the caller could
 * already read.
 *
 * A search that surfaces another organization's order is worse than having no
 * search, so the scoping is asserted at the QUERY, not at the rendered list.
 * Filtering results after the fact is the version that can be got wrong by a
 * later edit and still look right in a screenshot; the reads here are scoped
 * by their own shape:
 *
 *  * sites are read from `users/{uid}/hostMemberships` — the caller's own
 *    membership projection, which the rules would refuse for anyone else —
 *    narrowed to the open workspace;
 *  * screens are read from the site already open, which `HostGuard` admitted
 *    the caller to.
 *
 * The dangerous case is neither of those going wrong on purpose. It is
 * AGL-2350: an unresolved `orgId` makes the `where` clause `undefined`, which
 * does not narrow the query — it DROPS the filter and returns this person's
 * site memberships across every org they belong to. That is the hold under
 * test, and it is why `skip` matters more here than any assertion about the
 * happy path.
 */

/** Every `useSwitcherCollection` call, in mount order, with its options. */
const switcherCalls: Array<Record<string, any>> = []

let mockOrgId: string | null = 'org-1'
let mockHostId: string | null = 'host-1'
let mockHostReady = true

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
  useSwitcherCollection: (options: Record<string, any>) => {
    switcherCalls.push(options)
    return { items: [], loading: false, hasQuery: false }
  },
}))

jest.mock('../components/host-id-provider', () => ({
  useHostId: () => mockHostId,
  useHostReady: () => mockHostReady,
  useHostSubdomain: () => (mockHostId ? 'acme' : null),
}))

// Global search reads the URL-NAMED workspace, not the ambient scope
// (AGL-2486) — `mockOrgId = null` is how this suite says "no workspace here",
// and before the fix that state was unreachable in the real app because the
// scope always fell back to a remembered org.
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => (mockOrgId ? { $id: mockOrgId } : null),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: mockOrgId ? { $id: mockOrgId } : null }),
  useOrgSlug: () => 'acme-studio',
}))

import { render, screen } from '@testing-library/react'
import GlobalSearchDialogComponent from '../components/global-search/global-search-dialog.component'
import GlobalSearchTriggerComponent from '../components/global-search/global-search-trigger.component'

/** The options of the read aimed at a given collection, or undefined. */
const callFor = (segment: string) =>
  switcherCalls.find((call) => call.path?.includes(segment))

beforeEach(() => {
  switcherCalls.length = 0
  mockOrgId = 'org-1'
  mockHostId = 'host-1'
  mockHostReady = true
})

describe('the sites query', () => {
  it("reads the caller's OWN membership projection, not a global list", () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    const sites = callFor('hostMemberships')
    // `users/{uid}/…` is the scoping. A query over a top-level collection
    // would be the shape that can leak, whatever it filtered on.
    expect(sites?.path).toEqual(['users', 'user-1', 'hostMemberships'])
  })

  it('narrows to the workspace that is open', () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(callFor('hostMemberships')?.where).toEqual(['orgId', '==', 'org-1'])
    expect(callFor('hostMemberships')?.skip).toBe(false)
  })

  /**
   * The AGL-2350 hold, and the single most important assertion in this file.
   * An unresolved workspace must stop the read, because the `where` it would
   * otherwise carry is `undefined` — which widens the query to every org this
   * person belongs to rather than failing.
   *
   * There are TWO layers holding it, and mutation testing is what established
   * that both are real rather than one being decoration:
   *
   *  * `resolveGlobalSearchScope` returns no entities without an org, so
   *    `searchesSites` is false. Breaking only this turns three cases red —
   *    but NOT this one, because the dialog's own `|| !orgId` still holds.
   *  * the dialog re-checks `orgId` itself. Breaking both is what turns this
   *    case red, which is the demonstration that this assertion guards the
   *    second layer specifically and is not a restatement of the first.
   */
  it('is HELD, not widened, while the workspace is unresolved', () => {
    mockOrgId = null
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    const sites = callFor('hostMemberships')
    expect(sites?.skip).toBe(true)
    // And if `skip` were ever dropped, an absent filter must not be what
    // stands between one agency client's sites and another's.
    expect(sites?.where).toBeUndefined()
  })
})

describe('the screens query', () => {
  it('reads only the site that is already open', () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(callFor('screens')?.path).toEqual(['hosts', 'host-1', 'screens'])
    expect(callFor('screens')?.skip).toBe(false)
  })

  /**
   * Screens are host-scoped, so searching them across an org would be one
   * query per site — a fan-out on an interactive path. Off a site the read is
   * not made narrower, it is not made at all.
   */
  it('is held entirely when no site is open', () => {
    mockHostId = null
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(callFor('screens')?.skip).toBe(true)
  })

  it('is held while the host id is still resolving', () => {
    // A half-resolved host would address `hosts//screens`.
    mockHostReady = false
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(callFor('screens')?.skip).toBe(true)
  })

  it('excludes email templates, which are not pages of the site', () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    const filter = callFor('screens')?.filter
    expect(filter({ kind: 'email' })).toBe(false)
    expect(filter({ deletedAt: 1 })).toBe(false)
    expect(filter({ displayName: 'Home' })).toBe(true)
  })
})

describe('what the dialog tells the reader', () => {
  it('promises only what this context can answer', () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(
      screen.getByPlaceholderText('Search sites and pages…'),
    ).toBeTruthy()
  })

  it('shrinks the promise off a site', () => {
    mockHostId = null
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    expect(screen.getByPlaceholderText('Search sites…')).toBeTruthy()
  })

  /**
   * The honest half, rendered rather than merely defined. A prefix match is
   * not the search box people expect, and an unqualified empty result reads
   * as "you do not have one".
   */
  it('states the prefix rule and the two things it cannot find', () => {
    render(<GlobalSearchDialogComponent open onClose={() => undefined} />)
    const note = screen.getByText(/STARTS with/)
    expect(note.textContent).toContain('Orders and contacts are not searchable')
  })
})

describe('the top-bar trigger', () => {
  /**
   * A button that opens a field which can answer nothing is the defect this
   * issue is about, one viewport smaller. On the workspace picker — and on
   * every surface reached before the org resolves — there is nothing to
   * search, so there is nothing to press.
   */
  it('renders nothing at all when nothing is searchable', () => {
    mockOrgId = null
    const { container } = render(<GlobalSearchTriggerComponent />)
    expect(container.innerHTML).toBe('')
  })

  it('offers the affordance once a workspace has resolved', () => {
    const { container } = render(<GlobalSearchTriggerComponent />)
    expect(container.innerHTML).not.toBe('')
    expect(screen.getByLabelText('Search sites and pages…')).toBeTruthy()
  })

  /**
   * The trigger must not issue the reads. It renders on every console page,
   * so querying before it is opened would put two Firestore reads on every
   * navigation in the console to serve a dialog nobody asked for.
   *
   * Caught by this test rather than by review: the first version passed
   * `open={open}` to a permanently mounted dialog, and a MUI `Dialog` that is
   * closed has still run every hook inside it.
   */
  it('reads nothing until it is opened', () => {
    render(<GlobalSearchTriggerComponent />)
    expect(switcherCalls).toHaveLength(0)
  })
})

/**
 * The AGL-1414 invariant this feature had to not break.
 *
 * ## What this proves, and what it does not
 *
 * It reads the source rather than a rendered page, so it is a STRUCTURAL
 * claim, not a measurement: it cannot tell you the bar fits in 375px. It is
 * here because the property that matters is structural. AGL-1414's failure was
 * a flex child with the default `min-width: auto` growing without bound and
 * shoving the notifications bell off the right edge; its fix was a
 * `min-width: 0` chain through the elastic centre column, which holds the org
 * switcher.
 *
 * A `flexShrink: 0` child added OUTSIDE that column cannot reproduce that
 * failure. It takes a fixed width, and the elastic column absorbs it by
 * ellipsizing the org name — which is precisely the behaviour AGL-1414 built.
 * The two things that would break it are putting the trigger inside the centre
 * column, or letting it shrink; both are what this pins.
 *
 * The rendered-page check AGL-2179 asks for was NOT run: it needs an
 * authenticated console, and the console e2e suite records that authenticated
 * flows cannot run against local emulators. That verification is still owed.
 */
describe('the top bar keeps its AGL-1414 shape', () => {
  const layoutSource = require('node:fs').readFileSync(
    require('node:path').join(
      __dirname,
      '../components/layouts/main.layout.tsx',
    ),
    'utf8',
  )

  it('mounts the trigger in a flexShrink: 0 cluster', () => {
    const mount = layoutSource.indexOf('<GlobalSearchTriggerComponent />')
    expect(mount).toBeGreaterThan(-1)
    // The nearest enclosing Stack must pin its width.
    const enclosing = layoutSource.slice(0, mount).lastIndexOf('<Stack')
    expect(layoutSource.slice(enclosing, mount)).toContain('flexShrink: 0')
  })

  it('leaves the elastic centre column untouched', () => {
    // The chain the org switcher's ellipsis depends on. A trigger spliced in
    // here instead would re-establish the `auto` floor AGL-1414 removed.
    expect(layoutSource).toContain('minWidth: 0')
    const centre = layoutSource.indexOf('flexGrow: 1')
    const mount = layoutSource.indexOf('<GlobalSearchTriggerComponent />')
    expect(centre).toBeGreaterThan(-1)
    expect(mount).toBeGreaterThan(centre)
    // Nothing of ours lands between the centre column and its closing tag.
    const centreBlock = layoutSource.slice(centre, mount)
    expect(centreBlock).toContain('AppBarMenubarComponent')
  })
})
