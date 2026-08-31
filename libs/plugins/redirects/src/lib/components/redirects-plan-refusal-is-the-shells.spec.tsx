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
 * The Redirects surface does not refuse itself for plan reasons (AGL-2484).
 *
 * The shell resolves `redirects` from the org billing doc and renders the
 * refusal INSTEAD of the surface, so a plan refusal written inside this
 * component can never reach a reader: by the time it mounts, the verdict was
 * `entitled`. The copy that used to live here was therefore not a second
 * line of defense but an unreachable claim about pricing, free to drift away
 * from the plan tables with nothing rendering it to reveal the drift.
 *
 * Redirects keeps the shell's DERIVED sentence rather than registering an
 * `upgradeNotice` override, and the two tests below are the evidence for
 * that choice rather than a restatement of it. Events Calendar needed the
 * override because `eventCalendar` is false on every plan, which makes
 * "not included in your current plan" a standing lie; `redirects` is a
 * genuine upgrade — free denies it, Starter and every plan above grant it —
 * so the derived sentence is already the true one, and a second copy of it
 * here would only be a second thing to keep in sync.
 *
 * `PLAN_ENTITLEMENTS` is real here, not mocked, for the reason
 * `extension-entitlement.spec.ts` keeps it real: a stand-in table cannot
 * tell "no plan grants this" from "the stand-in forgot to grant it", and
 * that distinction is the whole basis of the decision under test.
 *
 * The companion invariant — that nothing this plugin registers can reach the
 * verdict, only the phrasing of one already decided against it — is pinned
 * shell-side in `plugin-surface-entitlement-gate.spec.tsx`, whose cases run
 * against this very flag.
 */

import { PLAN_ENTITLEMENTS, planGrantingFeature } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import RedirectsConsolePage from './redirects-console-page'

const redirectDocs = [
  {
    $id: 'red-1',
    source: '/old-pricing',
    destination: '/pricing',
    statusCode: 301,
    kind: 'exact',
    priority: 100,
    enabled: true,
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: redirectDocs,
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({
    data: { $id: 'host-1', screens: {} },
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'red-new' }),
  useUser: () => ({ data: { uid: 'uid-editor' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionCeiling,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => ({}) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

/** A plan that clears the redirect cap, so nothing is refused for that
 * reason instead of the one under test. */
const ORG = { plan: 'business' } as never

describe('the Redirects surface leaves plan refusal to the shell (AGL-2484)', () => {
  /**
   * `entitled={false}` is a state the shell cannot produce for this page —
   * it renders its own notice in place of the component — so this is not a
   * claim that the surface SHOULD open for an unentitled org. It is the only
   * way to reach the removed branch at all, and its emptiness is the point:
   * there is no longer a second, independently-worded plan refusal in the
   * repository for the pricing tables to drift away from.
   */
  it('renders no plan refusal of its own, even told it is unentitled', () => {
    render(<RedirectsConsolePage hostId="host-1" entitled={false} org={ORG} />)

    expect(screen.queryByText(/included from the Starter plan/i)).toBeNull()
    expect(screen.queryByText(/See Billing to upgrade/i)).toBeNull()
    // Positive control: the card really did render, so the absences above
    // are an absent refusal and not an absent component.
    expect(screen.getByText(/Exact-path rules/i)).toBeTruthy()
  })

  /**
   * The condition that makes the shell's derived sentence honest for this
   * flag, asserted rather than assumed. If a pricing change ever moves
   * `redirects` off every plan the way `eventCalendar` sits, this goes red —
   * and the fix is then to register an `upgradeNotice` on the redirects
   * extension, not to restore a refusal inside the component.
   */
  it('is a genuine upgrade, which is why the derived sentence stays', () => {
    expect(PLAN_ENTITLEMENTS.free.features.redirects).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.features.redirects).toBe(true)
    // "Which plan carries this" — the same ladder walk the shell's
    // `blockedExtensionNotice` consults to choose between the upgrade
    // framing and the add-on framing.
    expect(planGrantingFeature('redirects')).toBe('starter')
  })
})
