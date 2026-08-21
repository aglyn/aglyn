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
 * The shared gate (AGL-1066).
 *
 * The console had this rule in exactly one place — `media-library`, which
 * states it at its own call site: *"no media" is a claim about the library,
 * and a failed read is a claim about us.* Every other list reached the
 * opposite conclusion from the same evidence, because the rule lived in a
 * comment rather than in the component they all share.
 *
 * So `EmptyState` now owns it. `read` is a REQUIRED prop with no default: a
 * caller cannot render a zero-state without first stating that its read
 * succeeded, and TypeScript refuses the omission. These tests pin the part a
 * type cannot — that a non-`loaded` outcome renders NEITHER the sentence nor
 * the call to action, which is the half that invites a customer to rebuild
 * data they still own.
 */

import { fireEvent, render, screen } from '@testing-library/react'

import EmptyState from './empty-state.component'

const CTA = <button type="button">{'Create site'}</button>

describe('EmptyState gates its claim on the read', () => {
  it('renders the zero-state when the read succeeded and returned nothing', () => {
    render(
      <EmptyState
        read="loaded"
        title="No sites yet"
        description="Create a site to start building."
        action={CTA}
      />,
    )

    expect(screen.getByText('No sites yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create site' })).toBeTruthy()
  })

  it('renders NEITHER the claim nor the CTA on a refused read', () => {
    render(
      <EmptyState
        read="unavailable"
        subject="your sites"
        title="No sites yet"
        description="Create a site to start building."
        action={CTA}
      />,
    )

    expect(screen.queryByText('No sites yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create site' })).toBeNull()
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    // The one promise that matters to someone watching a list empty out.
    expect(screen.getByText(/Nothing has been deleted/)).toBeTruthy()
  })

  it('renders NEITHER while the read is still in flight', () => {
    render(
      <EmptyState
        read="loading"
        subject="your sites"
        title="No sites yet"
        description="Create a site to start building."
        action={CTA}
      />,
    )

    expect(screen.queryByText('No sites yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create site' })).toBeNull()
  })

  it('defers to the session banner rather than diagnosing the session', () => {
    render(<EmptyState read="unavailable" subject="your sites" title="x" />)

    // AGL-1179: a surface that concluded "your session is stale" from its own
    // single denial sent two people to sign out over a URL that did not
    // exist. One list is not evidence about the session; the banner is.
    expect(screen.queryByText(/your session is stale/i)).toBeNull()
    expect(screen.getByText(/banner above/i)).toBeTruthy()
  })

  it('offers a retry that actually re-runs the read', () => {
    const onRetry = jest.fn()
    render(
      <EmptyState
        read="unavailable"
        subject="your sites"
        title="x"
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
