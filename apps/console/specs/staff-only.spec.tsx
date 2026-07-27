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

import { act, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * The mocked `useUser`, with the claim it reports held inside the factory.
 *
 * The state lives in here rather than in module-level `const`s because
 * `jest.mock` is hoisted above them — reading one from the factory is a TDZ
 * error at import time, not a test failure you can debug from the assertion.
 *
 * STABLE IDENTITIES ONLY (AGL-597): `user` and `userResult` are built once
 * and reused. A fresh object per call re-fires the claim effect on every
 * render, and the state set inside it loops until the worker exhausts its
 * heap.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  const state = { claims: {} as Record<string, unknown>, tokenRejects: false }
  const user = {
    getIdTokenResult: () =>
      state.tokenRejects
        ? Promise.reject(new Error('token unavailable'))
        : Promise.resolve({ claims: state.claims }),
  }
  const userResult = { data: user }
  return { useUser: () => userResult, __state: state }
})

/**
 * `notFound()` is the refusal now (AGL-847). It works by throwing, so the
 * spec has to both observe the call and absorb the throw — a bare render
 * would fail the test with React's error rather than assert the behaviour.
 *
 * The counter lives inside the factory for the same reason the claims state
 * does: `jest.mock` is hoisted above every `const` in this file, so a mock
 * that closes over one is a TDZ error at import time.
 */
jest.mock('next/navigation', () => {
  const calls = { count: 0 }
  return {
    notFound: () => {
      calls.count += 1
      throw new Error('NEXT_NOT_FOUND')
    },
    __calls: calls,
  }
})

import * as nextNavigation from 'next/navigation'
import * as tenantInstance from '@aglyn/tenant-feature-instance'
import StaffOnly from '../components/staff-only.component'

/** The factory's state, reached through the namespace — `__state` exists on
 *  the mock only, so it is not on the real module's type. */
const state = (
  tenantInstance as unknown as {
    __state: { claims: Record<string, unknown>; tokenRejects: boolean }
  }
).__state

/** The notFound() call counter held inside the next/navigation mock. */
const notFound = (
  nextNavigation as unknown as { __calls: { count: number } }
).__calls

/**
 * Catches the `notFound()` throw so the assertions below can run. Renders a
 * marker rather than nothing, so "the boundary caught something" and "the
 * component rendered nothing at all" stay distinguishable.
 */
class NotFoundBoundary extends React.Component<
  { children: React.ReactNode },
  { caught: boolean }
> {
  override state = { caught: false }
  static getDerivedStateFromError() {
    return { caught: true }
  }
  override render() {
    return this.state.caught ? <p>{'not-found'}</p> : this.props.children
  }
}

function renderGated() {
  return render(
    <NotFoundBoundary>
      <StaffOnly>
        <p>{'internal'}</p>
      </StaffOnly>
    </NotFoundBoundary>,
  )
}

describe('StaffOnly (AGL-760/847)', () => {
  beforeEach(() => {
    state.claims = {}
    state.tokenRejects = false
    notFound.count = 0
    // React logs every error it routes to a boundary; the throw here is the
    // expected path, so the noise would drown real failures.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders children for a staff-claim holder', async () => {
    state.claims = { staff: true }
    renderGated()
    await waitFor(() => expect(screen.getByText('internal')).toBeTruthy())
    expect(notFound.count).toBe(0)
  })

  it('404s, and does not render children, without the claim', async () => {
    renderGated()
    await waitFor(() => expect(notFound.count).toBeGreaterThan(0))
    // The point of the gate: the content must never reach the DOM. Hiding it
    // with CSS, or removing it after a paint, would still have shipped it.
    expect(screen.queryByText('internal')).toBeNull()
  })

  it('treats an unreadable token as not staff', async () => {
    state.tokenRejects = true
    renderGated()
    await waitFor(() => expect(notFound.count).toBeGreaterThan(0))
    expect(screen.queryByText('internal')).toBeNull()
  })

  it('refuses without naming the internal grant script (AGL-847)', async () => {
    // The old refusal read "Staff only. Grant access with …", which told an
    // unauthorized viewer that the page exists AND how access is granted.
    // A plain 404 is the whole point of the change.
    renderGated()
    await waitFor(() => expect(notFound.count).toBeGreaterThan(0))
    expect(document.body.textContent).not.toMatch(/grant access/i)
  })

  it('renders neither children nor refusal while the claim resolves', async () => {
    state.claims = { staff: true }
    const { container } = renderGated()
    // Synchronously after mount the token promise has not settled. Showing
    // the refusal here would flash it at every staff member on every admin
    // page load.
    expect(container.textContent).toBe('')
    // Let it settle inside act, so the state update this test deliberately
    // raced does not surface as an unrelated act() warning.
    await act(async () => undefined)
  })
})
