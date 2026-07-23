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

import * as tenantInstance from '@aglyn/tenant-feature-instance'
import StaffOnly from '../components/staff-only.component'

/** The factory's state, reached through the namespace — `__state` exists on
 *  the mock only, so it is not on the real module's type. */
const state = (
  tenantInstance as unknown as {
    __state: { claims: Record<string, unknown>; tokenRejects: boolean }
  }
).__state

const REFUSAL = /Staff only\. Grant access with/

describe('StaffOnly (AGL-760)', () => {
  beforeEach(() => {
    state.claims = {}
    state.tokenRejects = false
  })

  it('renders children for a staff-claim holder', async () => {
    state.claims = { staff: true }
    render(
      <StaffOnly>
        <p>{'internal'}</p>
      </StaffOnly>,
    )
    await waitFor(() => expect(screen.getByText('internal')).toBeTruthy())
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('refuses, and does not render children, without the claim', async () => {
    render(
      <StaffOnly>
        <p>{'internal'}</p>
      </StaffOnly>,
    )
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy())
    // The point of the gate: the content must never reach the DOM. Hiding it
    // with CSS, or removing it after a paint, would still have shipped it.
    expect(screen.queryByText('internal')).toBeNull()
  })

  it('treats an unreadable token as not staff', async () => {
    state.tokenRejects = true
    render(
      <StaffOnly>
        <p>{'internal'}</p>
      </StaffOnly>,
    )
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy())
    expect(screen.queryByText('internal')).toBeNull()
  })

  it('renders neither children nor refusal while the claim resolves', async () => {
    state.claims = { staff: true }
    const { container } = render(
      <StaffOnly>
        <p>{'internal'}</p>
      </StaffOnly>,
    )
    // Synchronously after mount the token promise has not settled. Showing
    // the refusal here would flash it at every staff member on every admin
    // page load.
    expect(container.textContent).toBe('')
    // Let it settle inside act, so the state update this test deliberately
    // raced does not surface as an unrelated act() warning.
    await act(async () => undefined)
  })
})
