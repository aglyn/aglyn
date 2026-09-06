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
 * AGL-2179/AGL-2486: the palette RENDERS what the hook found, and renders a
 * failure as a failure.
 *
 * The query-shape and cost claims live in `use-global-search.spec.tsx`; this
 * file is about the three things only the rendered dialog can be wrong about:
 *
 *  * a result row is a real link that a click can follow;
 *  * a group that could not be READ says so, instead of looking like a group
 *    with no matches;
 *  * the palette cannot be rendered inert by another dialog, which is the
 *    measured cause of "clicking a result does nothing".
 */

const mockGroups: any[] = []
let mockActive = true

// `AppLink` reads the current path to decide its active class; without this
// the row renders nothing and the href assertions below silently pass on an
// empty list rather than proving anything.
jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts/demo',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
}))

jest.mock('../components/global-search/use-global-search', () => ({
  __esModule: true,
  SEARCH_WINDOW: 30,
  SEARCH_MAX_ITEMS: 300,
  default: () => ({
    groups: mockGroups,
    loading: false,
    active: mockActive,
    total: mockGroups.reduce((sum, group) => sum + group.rows.length, 0),
    readCount: 0,
  }),
}))

jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostReady: () => true,
  useHostSubdomain: () => 'demo',
}))
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => ({ $id: 'org-1' }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1' } }),
  useOrgSlug: () => 'acme',
}))
// The dialog gates the contacts group on the reader's org permissions
// (AGL-2596); an owner with everything granted, so every group the fixture
// offers is one the reader may see and the rows under test all render.
jest.mock('../hooks/use-org-permissions', () => ({
  useOrgPermissions: () => ({
    permissions: {},
    can: () => true,
    granted: {},
    isOwner: true,
    orgId: 'org-1',
    role: 'owner',
    loaded: true,
    errored: false,
    status: 'ready',
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'pro' }, orgId: 'org-1', ready: true }),
}))

import { render, screen } from '@testing-library/react'
import GlobalSearchDialogComponent from '../components/global-search/global-search-dialog.component'
import { GLOBAL_SEARCH_ENTITIES } from '../components/global-search/global-search-scope'

const definitionOf = (id: string) =>
  GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id)

const group = (id: string, rows: any[], extra: Record<string, any> = {}) => ({
  definition: definitionOf(id),
  rows,
  failed: false,
  truncated: false,
  searched: 30,
  ...extra,
})

beforeEach(() => {
  mockGroups.length = 0
  mockActive = true
})

const open = () =>
  render(<GlobalSearchDialogComponent open onClose={() => undefined} />)

/**
 * The anchors that are RESULT ROWS.
 *
 * A MUI `Dialog` renders through a portal, so the RTL `container` never holds
 * it — everything here reads `document.body`. That also picks up the footer's
 * docs-help link, which is not a result, hence the list scope.
 */
const resultAnchors = () =>
  Array.from(document.body.querySelectorAll('.MuiList-root a'))

describe('a result row', () => {
  /**
   * The reported defect was a row that does nothing when clicked. Driving a
   * real signed-in console showed the wiring is sound, so what this pins is
   * the property that makes it sound: the row is an ANCHOR carrying the href
   * the route table built. A row rendered as a bare button would look
   * identical and navigate nowhere.
   */
  it('is an anchor carrying a real href', () => {
    mockGroups.push(
      group('screens', [
        { $id: 's1', $label: 'Home', $score: 800, versionId: 'v1' },
      ]),
    )
    open()
    // A MUI `Dialog` renders through a PORTAL, so the RTL `container` never
    // contains it — querying `container` returns null for every row and makes
    // an href assertion look like it passed. Everything here reads
    // `document.body`, which is where the dialog actually is.
    const anchor = resultAnchors()[0]
    expect(anchor).toBeTruthy()
    expect(anchor?.getAttribute('href')).toBe(
      '/acme/hosts/demo/screens/s1/versions/v1/view',
    )
    expect(screen.getByText('Home')).toBeTruthy()
  })

  /** A row that cannot be addressed is dropped, never rendered inert. */
  it('is dropped when it has nowhere to go', () => {
    mockGroups.push(
      group('screens', [
        // Addressable: proves this test can see a row at all, so the
        // assertion below is about the versionless one and not about the
        // query finding nothing.
        { $id: 's0', $label: 'Openable', $score: 800, versionId: 'v1' },
        { $id: 's1', $label: 'Never opened', $score: 800 },
      ]),
    )
    open()
    // Result rows only — the footer's docs-help tip is an anchor too, and
    // counting every anchor on the page would make this assertion about the
    // chrome rather than about the rows.
    expect(resultAnchors()).toHaveLength(1)
    expect(screen.getByText('Openable')).toBeTruthy()
    expect(screen.queryByText('Never opened')).toBeNull()
  })

  it('links each kind of row at its own route', () => {
    mockGroups.push(
      group('layouts', [{ $id: 'l1', $label: 'Main Layout', $score: 600 }]),
      group('workflows', [{ $id: 'w1', $label: 'Quote', $score: 600 }]),
    )
    open()
    const hrefs = resultAnchors().map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/acme/hosts/demo/layouts/l1')
    expect(hrefs).toContain('/acme/hosts/demo/automation')
  })
})

describe('a group that could not be read', () => {
  /**
   * The rule: a swallowed query renders as a measured zero, which is worse
   * than an error because nothing looks wrong. The reader concludes they do
   * not have the thing and creates a duplicate.
   */
  it('says it is a read error, not an empty result', () => {
    mockGroups.push(group('layouts', [], { failed: true }))
    open()
    const note = screen.getByText(/could not be searched/)
    expect(note.textContent).toContain('not an empty result')
    expect(screen.queryByText('Nothing matched.')).toBeNull()
  })

  it('does not suppress the groups that succeeded', () => {
    mockGroups.push(
      group('layouts', [], { failed: true }),
      group('screens', [
        { $id: 's1', $label: 'Home', $score: 800, versionId: 'v1' },
      ]),
    )
    open()
    expect(screen.getByText(/could not be searched/)).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
  })
})

describe('a group whose window filled', () => {
  /**
   * Absence is only evidence of absence if everything was looked at.
   */
  it('says how much of it was actually searched', () => {
    mockGroups.push(
      group(
        'screens',
        [{ $id: 's1', $label: 'Home', $score: 800, versionId: 'v1' }],
        { truncated: true },
      ),
    )
    open()
    expect(screen.getByText(/Only the first 30 pages were searched/)).toBeTruthy()
  })

  it('stays quiet when the window had room left', () => {
    mockGroups.push(
      group('screens', [
        { $id: 's1', $label: 'Home', $score: 800, versionId: 'v1' },
      ]),
    )
    open()
    expect(screen.queryByText(/Only the first/)).toBeNull()
  })

  /**
   * The regression that reopened AGL-2179, reproduced at the size it was
   * measured at.
   *
   * Driven against a real signed-in console on `aglyn-marketing` — 54 screens
   * — typing `pric` rendered a bare **"Nothing matched."** while only 30 of
   * them had been read. The site's `/pricing` page exists and is one of its
   * most visited. The caveat that would have corrected the impression was
   * suppressed by the very condition it needed to survive: a group with no
   * matching rows was dropped before it could render.
   *
   * The read escalates now, so a 54-screen site is fully searched. This is the
   * residue above the ceiling, and it is the assertion that matters most,
   * because it is the one where the reader would otherwise be told a falsehood
   * rather than an incomplete truth.
   */
  it('does not report a partly-read group as "nothing matched"', () => {
    mockGroups.push(group('screens', [], { truncated: true, searched: 300 }))
    open()
    expect(screen.queryByText('Nothing matched.')).toBeNull()
    const caveat = screen.getByText(/No match among the 300 pages searched/)
    // The words have to close the inference, not merely avoid making it.
    expect(caveat.textContent).toContain('not read')
  })

  it('still says nothing matched when the group was read to the end', () => {
    mockGroups.push(group('screens', [], { truncated: false }))
    open()
    expect(screen.getByText('Nothing matched.')).toBeTruthy()
  })
})

describe('what the reader is told', () => {
  it('asks for a longer query rather than reading for a one-letter one', () => {
    mockActive = false
    open()
    expect(screen.getByText(/Type at least 2 characters/)).toBeTruthy()
  })

  it('promises a match on any part of a name, and states the window', () => {
    open()
    const note = screen.getByText(/any part of a name/)
    // The CEILING, not the first window: after an escalation the palette has
    // searched far more than 30, and quoting 30 would understate it.
    expect(note.textContent).toContain('300')
    // The old copy's promise, which the mechanism no longer has to make.
    expect(note.textContent).not.toContain('STARTS')
  })

  it('distinguishes "nothing matched" from "not searched yet"', () => {
    open()
    expect(screen.getByText('Nothing matched.')).toBeTruthy()
    expect(screen.queryByText(/Type at least/)).toBeNull()
  })
})

/**
 * The measured cause of "clicking a result does nothing".
 *
 * Every MUI `Dialog` renders at `theme.zIndex.modal`, so with two mounted the
 * winner is decided by DOM order — and this palette opens from the top bar of
 * EVERY console page, including pages that raise their own dialog. Measured
 * with `document.elementFromPoint` against a real signed-in console: with the
 * notifications prompt mounted, every row hit-tests to the OTHER dialog's
 * container and the click is refused; dismissed, the same rows hit-test to
 * themselves and navigate.
 */
describe('the palette cannot be buried by another dialog', () => {
  it('renders above the modal layer', () => {
    open()
    const root = document.body.querySelector('.MuiDialog-root')
    expect(root).toBeTruthy()
    const zIndex = Number(
      getComputedStyle(root as Element).zIndex || '0',
    )
    // MUI's `zIndex.modal` is 1300; anything at or below it can be covered by
    // a dialog that mounts later.
    expect(zIndex).toBeGreaterThan(1300)
  })
})
