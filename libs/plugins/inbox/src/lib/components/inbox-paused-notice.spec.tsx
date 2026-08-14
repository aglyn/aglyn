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
 * The site owner's half of a paused form (AGL-1666).
 *
 * AGL-1655 made the abuse ceiling refuse without billing, and recorded the
 * trip in two places the owner cannot reach: `counters/formSubmissionsRefused`,
 * which takes a Firestore console to read, and one in-app notification in the
 * `system` bucket — which the console's own notification settings let a user
 * mute, and muting suppresses at WRITE time, so a muted owner's notification
 * is never created at all. That left a real possibility of a site quietly
 * refusing every lead with nothing anywhere telling its owner.
 *
 * This spec is about that gap, so the assertions are: the notice appears from
 * the real counter document, it carries the three things the owner needs
 * (count, ceiling, when it lifts), and it does NOT appear when there is
 * nothing to report — the counter document outlives the month that created
 * it, so a stale one must not paint a permanent banner.
 *
 * No jest-dom in this repo; plain DOM assertions throughout.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { InboxConsolePage } from './inbox-console-page'

/** The month key the submit route writes, derived exactly as it derives it. */
const MONTH = new Date().toISOString().slice(0, 7)

/** Mutable so each case picks what `counters/formSubmissionsRefused` holds. */
let refusedCounter: Record<string, unknown> | undefined

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: [],
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({
    data: refusedCounter,
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
// Only the ACTIVE tab's panel renders, which is why the notice under test
// sits outside the tabs; this stub keeps that honest by rendering the first
// tab's content only, exactly as the real component would on arrival.
jest.mock('@aglyn/shared-ui-next', () => ({
  HubTabs: ({ tabs }: { tabs: Array<{ content: ReactNode }> }) => (
    <div>{tabs[0]?.content}</div>
  ),
}))
jest.mock('@aglyn/plugins-email', () => ({ CampaignsCard: () => null }))
jest.mock('@aglyn/plugins-commerce', () => ({ HostOrdersCard: () => null }))

const renderPage = () =>
  render(<InboxConsolePage hostId="host-1" entitled />)

beforeEach(() => {
  refusedCounter = undefined
})

describe('AGL-1666 · the inbox says when a form is paused', () => {
  it('shows the count, the ceiling and the reset date', () => {
    refusedCounter = { [MONTH]: 412, ceiling: 5000, lastRefusedAtMs: 1 }
    const { container } = renderPage()
    const text = container.textContent ?? ''
    expect(text).toContain('Form submissions are paused')
    expect(text).toContain('412 submissions')
    expect(text).toContain('5,000 submissions')
    // The fact an owner looking at an empty inbox would otherwise assume the
    // opposite of.
    expect(text).toContain('not billed')
    expect(text).toContain('Submissions start being accepted again on')
  })

  it('renders it as a warning, above the tabs, where arriving lands', () => {
    refusedCounter = { [MONTH]: 412, ceiling: 5000 }
    const { container } = renderPage()
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.className).toContain('Warning')
    // Outside every tab panel: the notification that brings an owner here
    // links to the page, and the last tab they used may not be Submissions.
    expect(alert?.textContent).toContain('Form submissions are paused')
  })

  it('shows nothing when the site has never been refused', () => {
    refusedCounter = undefined
    const { container } = renderPage()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).not.toContain('paused')
  })

  it('shows nothing in a clean month, on a site refused in an earlier one', () => {
    // The counter document is permanent — `{ceiling, lastRefusedAtMs}` and
    // last month's key survive. A banner keyed on the document's existence
    // would be there forever, and an owner learns to ignore it long before
    // the month it matters.
    refusedCounter = { '2020-01': 9999, ceiling: 5000, lastRefusedAtMs: 1 }
    const { container } = renderPage()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
