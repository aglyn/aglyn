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

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ReactNode } from 'react'

/**
 * A held or flagged page is visible where the owner works (AGL-3374): a
 * status chip in the screens, layouts and components lists, and a banner in
 * the editors that says what visitors see and offers View details, Request a
 * review and Contact support — never a release, which is staff's alone.
 */

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => <a href={href}>{children}</a>,
}))
jest.mock('../../hooks/use-org-scope', () => ({ useOrgSlug: () => 'harbor-view' }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'u1' } }) }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(async () => ({ ok: true, json: async () => ({}) })),
}))

import { PageHoldBannerView } from './page-hold-banner.component'
import PageHoldChips from './page-hold-chips.component'
import { holdsForTarget, pageHoldBannerCopy, type PageHold } from './page-hold-copy'

const heldTemplate: PageHold = {
  noticeId: 'n1',
  kind: 'page-held',
  status: 'held',
  chip: { label: 'Held for review', color: 'warning' },
  label: 'the "Video detail" template (/videos/:slug)',
  details: [
    'Found while showing https://aglyn.com/videos/intro.',
    'The flagged content is in the layout "Main", used on 4 pages, not on the page itself.',
  ],
  visitorSentence: 'Visitors see the site’s built-in design for these pages until the review is done.',
  targets: [
    { type: 'screen', id: 'IhmjX3ymSg' },
    { type: 'layout', id: 'main' },
  ],
  reference: 'HS-1',
  occurredAtMs: 0,
  reviewable: true,
  reviewRequestedAtMs: null,
}
const flaggedPage: PageHold = {
  ...heldTemplate,
  noticeId: 'n2',
  kind: 'page-flagged',
  status: 'in-review',
  chip: { label: 'Flagged — live, under review', color: 'info' },
  label: 'the "Home" page (/)',
  details: [],
  visitorSentence: 'Visitors still see this page while it is reviewed.',
  targets: [{ type: 'screen', id: 'home' }],
}
const rejectedComponentPage: PageHold = {
  ...heldTemplate,
  noticeId: 'n3',
  status: 'rejected',
  chip: { label: 'Not approved', color: 'error' },
  label: 'the "About" page (/about)',
  targets: [
    { type: 'screen', id: 'about' },
    { type: 'component', id: 'hdr' },
  ],
}
const holds = [heldTemplate, flaggedPage, rejectedComponentPage]

describe('the status chip in a list', () => {
  it.each([
    [{ type: 'screen', id: 'IhmjX3ymSg' }, 'Held for review'],
    [{ type: 'screen', id: 'home' }, 'Flagged — live, under review'],
    [{ type: 'layout', id: 'main' }, 'Held for review'],
    [{ type: 'component', id: 'hdr' }, 'Not approved'],
  ] as const)('%o shows %s', (target, label) => {
    render(<PageHoldChips holds={holds} target={target} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('shows nothing on a page that is not held', () => {
    const { container } = render(<PageHoldChips holds={holds} target={{ type: 'screen', id: 'clean' }} />)
    expect(container.textContent).toBe('')
  })
})

describe('the banner in an editor', () => {
  const renderBanner = (target: PageHold['targets'][number], canRequestReview = true) => {
    const onRequestReview = jest.fn()
    const view = render(
      <PageHoldBannerView
        holds={holds}
        target={target}
        orgSlug="harbor-view"
        canRequestReview={canRequestReview}
        onRequestReview={onRequestReview}
      />,
    )
    return { ...view, onRequestReview }
  }

  it('names the held template, says what visitors see, and offers the three owner actions', () => {
    const { container, onRequestReview } = renderBanner({ type: 'screen', id: 'IhmjX3ymSg' })
    const text = container.textContent ?? ''
    expect(text).toContain(
      'The "Video detail" template (/videos/:slug) is held for review by our automated safety review.',
    )
    expect(text).toContain('Found while showing https://aglyn.com/videos/intro.')
    expect(text).toContain('Visitors see the site’s built-in design for these pages until the review is done.')
    expect(screen.getByText('View details').closest('a')?.getAttribute('href')).toBe(
      '/harbor-view/settings/holds#notice-n1',
    )
    expect(screen.getByText('Contact support').closest('a')?.getAttribute('href')).toBe(
      '/harbor-view/support/tickets',
    )
    fireEvent.click(screen.getByText('Request a review'))
    expect(onRequestReview).toHaveBeenCalledWith(heldTemplate)
  })

  it('says a flagged page is still live', () => {
    const { container } = renderBanner({ type: 'screen', id: 'home' })
    expect(container.textContent).toContain('Flagged — live, under review')
    expect(container.textContent).toContain('Visitors still see this page while it is reviewed.')
  })

  it('on a layout or component, names the page that uses it', () => {
    expect(renderBanner({ type: 'layout', id: 'main' }).container.textContent).toContain(
      'The "Video detail" template (/videos/:slug), which uses this layout, is held for review',
    )
    expect(renderBanner({ type: 'component', id: 'hdr' }).container.textContent).toContain(
      'The "About" page (/about), which uses this component, was not approved after review',
    )
  })

  it('never offers the owner a release — in any state, on any target', () => {
    for (const target of holds.flatMap((hold) => hold.targets)) {
      const { container, unmount } = renderBanner(target)
      expect(container.textContent).not.toMatch(/release|approve it|dismiss|unhold|lift/i)
      const buttons = [...container.querySelectorAll('a, button')].map((node) => node.textContent)
      expect(buttons.every((label) => ['View details', 'Request a review', 'Contact support'].includes(String(label)))).toBe(true)
      unmount()
    }
  })

  it('tells a member who cannot ask for a review who can', () => {
    const { container } = renderBanner({ type: 'screen', id: 'IhmjX3ymSg' }, false)
    expect(screen.queryByText('Request a review')).toBeNull()
    expect(container.textContent).toContain('A workspace owner or admin can request a review.')
  })

  it('pairs holds with the documents they are shown on', () => {
    expect(holdsForTarget(holds, { type: 'layout', id: 'main' })).toEqual([heldTemplate])
    expect(pageHoldBannerCopy(flaggedPage, { type: 'screen', id: 'home' }).lines).toContain('Reference HS-1.')
  })
})

/**
 * Each surface an owner works in renders the hold for what it shows. A
 * literal sweep, so moving one of these files keeps the surface in view.
 */
describe('every surface shows the hold', () => {
  const app = join(__dirname, '..', '..', 'app')
  const read = (path: string) => readFileSync(join(app, path), 'utf8')
  it.each([
    ['(app)/[orgSlug]/hosts/[host]/screens/page.tsx', /<PageHoldChips[^>]*type: 'screen'/],
    ['(app)/[orgSlug]/hosts/[host]/layouts/page.tsx', /<PageHoldChips[^>]*type: 'layout'/],
    ['../components/host-components-card.component.tsx', /<PageHoldChips[^>]*type: 'component'/],
    ['../components/content/collection-entries-page.component.tsx', /<PageHoldBanner[\s\S]*?type: 'screen'/],
    ['(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx', /<PageHoldBanner[\s\S]*?type: 'screen'/],
    ['(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx', /<PageHoldBanner[\s\S]*?type: 'screen'/],
    ['(editor)/[orgSlug]/hosts/[host]/layouts/[layoutId]/versions/[versionId]/besigner/page.tsx', /<PageHoldBanner[\s\S]*?type: 'layout'/],
    ['(editor)/[orgSlug]/hosts/[host]/components/[componentId]/versions/[versionId]/besigner/page.tsx', /<PageHoldBanner[\s\S]*?type: 'component'/],
  ])('%s', (path, pattern) => {
    expect(read(path)).toMatch(pattern)
  })
})
