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
 * THE ASSIST CITATIONS REACH A READER (AGL-2486).
 *
 * `app/api/assist/chat/route.ts` puts a `docs` array on EVERY `done` event —
 * both the deflected path (line 547) and the model path (line 1029) — and the
 * panel destructured it, stored it on the message, used `docs.length > 0` to
 * set the `grounded` analytics flag, and rendered nothing. So every answer
 * shipped its own citations to a reader who never saw one, and on the model
 * path that array is the ONLY citation that exists: the completion is prose,
 * and nothing obliges a completion to name the page it was grounded in.
 *
 * ## WHAT THIS FILE HAS TO CATCH
 *
 *  - **The model answer shows its sources.** The plain case, and the whole
 *    point: prose with no link in it, plus a `docs` array, must put those
 *    pages on screen as real links.
 *  - **A DEFLECTED answer does not say everything twice.** This is the
 *    assertion that shapes the design. `composeDocsAnswer` deliberately
 *    carries its citation in the answer TEXT as `[label](url)`, because a
 *    link is the one markup `renderAssistText` speaks. A straight render of
 *    the array underneath would print every heading a second time, on exactly
 *    the answers that already cite well. So a url already linked in the prose
 *    must not reappear below it.
 *  - **A PARTIAL overlap keeps the remainder.** The trap on the deflected
 *    path is that `docs` is every section RETRIEVED while the template quotes
 *    only the sections it used — so the two sets differ, and an
 *    all-or-nothing rule ("the text has a link, render nothing") would be
 *    satisfied by the case above while dropping real uncited sources. The
 *    quoted one is suppressed and the unquoted one survives, in one render.
 *  - **Presence is not correctness.** Every source is asserted as a LINK with
 *    its own `href`, via `getByRole('link', { name })`. A heading reading
 *    "Sources" over an empty box, or titles rendered as inert text, passes a
 *    text search and dies here.
 *  - **The empty case renders NOTHING.** An ungrounded turn — which is a
 *    third of assist traffic and the whole subject of the docs-gap report —
 *    must not grow a bare "Sources" label with no sources under it.
 */

import { render, screen } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  checkEntitlement: () => true,
  lockdownRefusalText: () => '',
  parseLockdownRefusal: () => null,
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
}))
jest.mock('@aglyn/shared-data-mdi', () => ({
  mdiChatQuestionOutline: { path: '' },
  mdiChevronDown: { path: '' },
  mdiChevronUp: { path: '' },
  mdiClose: { path: '' },
  mdiOpenInNew: { path: '' },
  mdiSend: { path: '' },
  mdiThumbDownOutline: { path: '' },
  mdiThumbUpOutline: { path: '' },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  // Deliberately a real anchor: the assertions below are `role="link"` with
  // an `href`, so a stub rendering a <span> would fail them the same way a
  // component rendering inert text would. The double models the real one.
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: null }),
}))
jest.mock('next/navigation', () => ({ usePathname: () => '/' }))
jest.mock('../components/docs-help-tip.component', () => ({
  DocsHelpTip: () => null,
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({ branding: {} }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: null, orgId: 'org1', ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ orgSlug: 'o', pathOrgSlug: 'o', currentOrg: null }),
  useOrgSlug: () => 'o',
}))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  default: () => ({ isStaff: false }),
  useReleaseFlag: () => ({ enabled: true }),
}))
jest.mock('../hooks/use-secondary-nav', () => ({ useUrlNamesOrg: () => true }))

import { AssistSources } from '../components/assist-panel.component'

/** The shape `retrieveDocsSections` produces, as the route maps it. */
const DRAG = {
  title: 'Drag-and-drop hierarchy',
  url: '/docs/building-sites/besigner/hierarchy',
}
const STYLES = {
  title: 'Styling an element',
  url: '/docs/building-sites/besigner/responsive-styling',
}

describe('Assist citations reach a reader (AGL-2486)', () => {
  it('shows the sources of a MODEL answer, which cites nothing itself', () => {
    render(
      <AssistSources
        text={'Open the hierarchy panel and drag the node onto its new parent.'}
        docs={[DRAG, STYLES]}
      />,
    )
    expect(
      screen.getByRole('link', { name: DRAG.title }).getAttribute('href'),
    ).toBe(DRAG.url)
    expect(
      screen.getByRole('link', { name: STYLES.title }).getAttribute('href'),
    ).toBe(STYLES.url)
  })

  it('does NOT repeat a source the DEFLECTED answer already links in its text', () => {
    // Exactly what `composeDocsAnswer` emits: the heading as a bare
    // `[label](url)` on its own line, which the panel turns into a link.
    render(
      <AssistSources
        text={`[${DRAG.title}](${DRAG.url})\nMoving an element without dragging.`}
        docs={[DRAG]}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    // The label must not appear either — a bare "Sources" heading over an
    // empty list is its own defect.
    expect(screen.queryByText(/^Sources?$/)).toBeNull()
  })

  it('keeps a RETRIEVED source the deflected text did not quote', () => {
    // `docs` is every section retrieved; the template quotes only what it
    // used. An all-or-nothing rule passes the test above and loses this one.
    render(
      <AssistSources
        text={`[${DRAG.title}](${DRAG.url})\nMoving an element without dragging.`}
        docs={[DRAG, STYLES]}
      />,
    )
    expect(screen.queryByRole('link', { name: DRAG.title })).toBeNull()
    expect(
      screen.getByRole('link', { name: STYLES.title }).getAttribute('href'),
    ).toBe(STYLES.url)
  })

  it('renders nothing at all for an UNGROUNDED turn', () => {
    const { container } = render(<AssistSources text={'I am not sure.'} docs={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists a repeated url once', () => {
    render(<AssistSources text={'Prose with no links.'} docs={[DRAG, DRAG]} />)
    expect(screen.getAllByRole('link', { name: DRAG.title })).toHaveLength(1)
  })
})
