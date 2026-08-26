/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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

/**
 * A refused read must never render as a zero-state (AGL-1066, AGL-1062).
 *
 * ## The report
 *
 * "Regardless what org you are on it shows the sites then they disappear and
 * this shows up" — the sites list on `/{org}/hosts` paints, empties to
 * **"No sites yet — Create a site to start building"**, and the AGL-1063
 * session banner appears above it. The header read `0 of Unlimited sites`.
 *
 * The stale session is not the defect. Sessions go stale, and the banner is
 * honest about it. The defect is the sentence underneath: "No sites yet" is a
 * claim about the DATA, made on a read that never reached the server. It is
 * the media library's rule (`media-library.component`, AGL-1062) — "no media
 * is a claim about the library, and a failed read is a claim about us" —
 * unapplied to the surface where it matters most, because this one carries a
 * **Create site** button. A customer who believes it recreates sites they
 * already own.
 *
 * ## The mechanism, pinned below
 *
 * `useOrgHosts` already returns `{ hosts, ready, error }`; every consumer
 * destructured `hosts` alone. Worse, the hook could not produce a truthful
 * `error` for this case at all: a per-host listen that the server REFUSES
 * lands in the same `hostDocs.set(id, null)` branch as a host that does not
 * exist, and `publish()` then called `setError(false)` unconditionally. So a
 * session that is denied every `hosts/{id}` read reported
 * `{ hosts: [], ready: true, error: false }` — byte-identical to a brand-new
 * workspace.
 *
 * That asymmetry is also why the list PAINTS first: `persistentLocalCache`
 * answers each `onSnapshot` from IndexedDB immediately, and only then does
 * the server refuse the listen and fire the error callback (AGL-1066).
 *
 * ## The negative control this file carries
 *
 * Asserting only "the degraded state appears" would also pass if the zero
 * state were deleted outright, or if the page rendered nothing at all. Every
 * refusal below is therefore paired with the genuine case: a read that really
 * did succeed and really did return zero still says "No sites yet" and still
 * offers **Create site**.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/* ------------------------------------------------------------------ *
 * The surface under test: the Sites page and everything it reads.
 * ------------------------------------------------------------------ */

const mockUseOrgHosts = jest.fn()
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  useOrgHosts: (...args: unknown[]) => mockUseOrgHosts(...args),
  default: (...args: unknown[]) => mockUseOrgHosts(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

const ORG = { $id: 'org-1', slug: 'aglyn-org', name: 'Aglyn LLC', plan: 'enterprise' }

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'aglyn-org',
  useOrgScope: () => ({ currentOrg: ORG, loading: false, error: false }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: ORG, orgId: ORG.$id, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: { createHosts: true }, can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))

const mockBranding = {
  branding: { productName: 'Aglyn', supportUrl: 'https://aglyn.com/support' },
  whiteLabel: false,
  ready: true,
}
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullComponent = { __esModule: true, default: () => null }
/**
 * The dashboard shell renders `headerRight` in a PROP, not in `children`. A
 * bare children-only stand-in silently drops the site meter and the header's
 * own Create-site button — and then "there is exactly one Create site button"
 * passes for the wrong reason. Render both slots.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    children,
    headerRight,
  }: {
    children?: ReactNode
    headerRight?: ReactNode
  }) => (
    <div>
      <div data-testid="header-right">{headerRight}</div>
      {children}
    </div>
  ),
}))
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/create-host-dialog.component', () => nullComponent)
jest.mock('../components/org-invites-banner.component', () => nullComponent)
jest.mock('../components/host-icon.component', () => nullComponent)

import HostsPage from '../app/(app)/[orgSlug]/hosts/page'

/** The exact sentence pair a refused read must never produce. */
const ZERO_STATE = /No sites yet/i
const ZERO_STATE_COPY = /Create a site to start building/i

describe('the Sites page on a read it could not complete', () => {
  it('never claims "No sites yet" when the read was refused', () => {
    mockUseOrgHosts.mockReturnValue({ hosts: [], ready: true, error: true })

    render(<HostsPage />)

    expect(screen.queryByText(ZERO_STATE)).toBeNull()
    expect(screen.queryByText(ZERO_STATE_COPY)).toBeNull()
    // …and says what actually happened, without asserting anything was lost.
    expect(screen.getByText(/could not be loaded|couldn.t load/i)).toBeTruthy()
    expect(screen.getByText(/[Nn]othing has been deleted/)).toBeTruthy()
  })

  it('withholds the Create-site call to action on a refused read', () => {
    mockUseOrgHosts.mockReturnValue({ hosts: [], ready: true, error: true })

    render(<HostsPage />)

    // The header button is a permanent affordance; the ZERO-STATE's button is
    // the one that tells a customer their sites are gone and offers to make
    // another. There must be exactly one "Create site" on the page, not two.
    expect(screen.getAllByRole('button', { name: /create site/i })).toHaveLength(1)
  })

  it('does not print a site COUNT it never read', () => {
    mockUseOrgHosts.mockReturnValue({ hosts: [], ready: true, error: true })

    render(<HostsPage />)

    // "0 of Unlimited sites · Enterprise plan" — a measured-looking zero.
    expect(screen.queryByText(/0 of Unlimited sites/i)).toBeNull()
  })

  it('shows neither state while the read is still in flight', () => {
    mockUseOrgHosts.mockReturnValue({ hosts: [], ready: false, error: false })

    render(<HostsPage />)

    expect(screen.queryByText(ZERO_STATE)).toBeNull()
  })

  it('STILL says "No sites yet" for a workspace that genuinely has none', () => {
    mockUseOrgHosts.mockReturnValue({ hosts: [], ready: true, error: false })

    render(<HostsPage />)

    // The negative control for all three refusals above: delete the zero
    // state instead of gating it and this fails.
    expect(screen.getByText(ZERO_STATE)).toBeTruthy()
    expect(screen.getByText(ZERO_STATE_COPY)).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /create site/i }).length,
    ).toBeGreaterThan(1)
  })

  it('offers a retry that re-runs the read rather than a dead end', () => {
    const retry = jest.fn()
    mockUseOrgHosts.mockReturnValue({
      hosts: [],
      ready: true,
      error: true,
      retry,
    })

    render(<HostsPage />)
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))

    expect(retry).toHaveBeenCalled()
  })
})
