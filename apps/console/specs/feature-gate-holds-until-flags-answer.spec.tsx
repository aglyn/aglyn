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
 * `FeatureGate` must not answer "coming soon" before the flags arrive
 * (AGL-243 residual, the MIRRORED defect).
 *
 * `useOrgPermissions` failed OPEN while loading; this one fails CLOSED while
 * loading, and both are the same mistake — a loading default that answers the
 * question instead of deferring it.
 *
 * `useReleaseFlag` returns `ready` (Remote Config's `activated`, false until
 * the fetch lands) and this component destructured `{ visible, staffPreview }`
 * and threw it away. `visible` is `released || isStaff`, and `released` is
 * false before Remote Config answers — so on the first paint of every session
 * a customer whose flag is genuinely ON was told the feature "isn't available
 * on your workspace yet", and then watched it appear. On the marketplace hub
 * and the org Data page that is the whole page.
 *
 * It is the cheaper direction to get wrong — nothing leaks — but it is a
 * support ticket, and it is the same class, so it is fixed here.
 *
 * ⚠️ Every "the notice is absent" assertion is paired with a control that
 * drives the same component to the state where the notice MUST appear.
 */

import { getReleaseFlagDefinition } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'

let mockReady: boolean
let mockReleased: boolean
let mockIsStaff: boolean

jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({
    released: mockReleased,
    // The real hook's derivation, reproduced — `visible` and `staffPreview`
    // are computed from `released`/`isStaff` and carry no readiness of their
    // own. That is exactly why dropping `ready` is undetectable downstream.
    visible: mockReleased || mockIsStaff,
    staffPreview: mockIsStaff && !mockReleased,
    isStaff: mockIsStaff,
    ready: mockReady,
  }),
}))

import FeatureGate from '../components/feature-gate.component'

const FLAG = 'release_marketplace'
const COMING_SOON = `${getReleaseFlagDefinition(FLAG).label} is coming soon`
const BODY = 'the marketplace hub'

beforeEach(() => {
  mockReady = true
  mockReleased = true
  mockIsStaff = false
})

describe('THE MIRROR: no refusal before Remote Config answers', () => {
  beforeEach(() => {
    // First paint of every session: the fetch is a network round trip, so
    // `released` reads false for a reason that is not an answer.
    mockReady = false
    mockReleased = false
  })

  it('does not tell the reader the feature is coming soon', () => {
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.queryByText(COMING_SOON)).toBeNull()
  })

  it('holds — it renders the spinner, not the body either', () => {
    // The other half. Painting the body on an unknown flag would leak an
    // unreleased surface, which is what the gate exists to prevent.
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.queryByText(BODY)).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('does NOT hold for staff — the bypass needs no flag to resolve', () => {
    // The boundary of the hold, and it is deliberate. Staff pass on the
    // token's claim, not on `released`, so for them nothing is unresolved and
    // a spinner would only be a delay. AGL-1662 depends on this: a staff
    // previewer must reach the plugin page body DURING the activation window,
    // because that is the case proving the route hands the plugin `released`
    // rather than `visible`. Holding here broke that spec — the narrowing to
    // `!ready && !isStaff` is what this test pins.
    mockIsStaff = true
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.getByText(BODY)).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('withholds the staff-preview banner until the flag actually answers', () => {
    // `staffPreview` is `isStaff && !released`, and `released` reads false
    // before activation — so the banner would tell a staff member the feature
    // is "hidden from customers by release flag" on every first paint,
    // including for flags that are fully released. Staff see the page; they
    // are not told a claim about the flag until there is one.
    mockIsStaff = true
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.queryByText('Release-flagged feature')).toBeNull()
  })
})

describe('NEGATIVE CONTROLS: the gate still gates once the flags land', () => {
  it('a released flag renders the body and no notice', () => {
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.getByText(BODY)).toBeTruthy()
    expect(screen.queryByText(COMING_SOON)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('a flag that is genuinely OFF still says coming soon, and hides the body', () => {
    // Without this the block above is satisfied by a component that never
    // refuses anything — which would leak every unreleased surface.
    mockReleased = false
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.getByText(COMING_SOON)).toBeTruthy()
    expect(screen.queryByText(BODY)).toBeNull()
  })

  it('staff still get the body plus the release-flagged warning', () => {
    mockReleased = false
    mockIsStaff = true
    render(
      <FeatureGate flag={FLAG}>
        <div>{BODY}</div>
      </FeatureGate>,
    )
    expect(screen.getByText(BODY)).toBeTruthy()
    expect(screen.getByText('Release-flagged feature')).toBeTruthy()
  })
})
