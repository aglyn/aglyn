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

import { render, screen } from '@testing-library/react'
import React from 'react'
import ReadGatedEmptyState from './read-gated-empty-state.component'

/**
 * The gate itself is held by the console's own spec, which drives this
 * component through the wrapper it kept (`empty-state.spec.tsx`). What is
 * here is what only exists at this level: the component's behaviour for a
 * caller that is NOT the console — a plugin's list surface — and the
 * precedence between the two degraded actions (AGL-3080).
 */
describe('ReadGatedEmptyState, for a caller with no session store', () => {
  it('withholds the zero-state sentence until the read is loaded', () => {
    const { rerender } = render(
      <ReadGatedEmptyState read="loading" title="This workspace holds no licenses" />,
    )
    expect(screen.queryByText('This workspace holds no licenses')).toBeNull()

    rerender(
      <ReadGatedEmptyState read="unavailable" title="This workspace holds no licenses" />,
    )
    expect(screen.queryByText('This workspace holds no licenses')).toBeNull()

    rerender(
      <ReadGatedEmptyState read="loaded" title="This workspace holds no licenses" />,
    )
    expect(screen.getByText('This workspace holds no licenses')).toBeTruthy()
  })

  it('says the list is incomplete and that nothing was deleted', () => {
    render(
      <ReadGatedEmptyState
        read="unavailable"
        subject="this workspace’s licenses"
        title="This workspace holds no licenses"
      />,
    )
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    expect(screen.getByText(/Nothing has been deleted/i)).toBeTruthy()
  })

  it('offers the retry when one was passed, and no button when none was', () => {
    const { rerender } = render(
      <ReadGatedEmptyState read="unavailable" title="Nothing yet" />,
    )
    expect(screen.queryByRole('button')).toBeNull()

    rerender(
      <ReadGatedEmptyState
        read="unavailable"
        title="Nothing yet"
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('lets a degraded action OUTRANK the retry', () => {
    // The console's case: every server read is being refused, so retrying is
    // an invitation to fail and the caller knows it. Both props present is
    // the shape that matters — a caller passing `onRetry` for the ordinary
    // failure must not end up offering both buttons on the one failure where
    // the retry cannot work.
    render(
      <ReadGatedEmptyState
        read="unavailable"
        title="Nothing yet"
        onRetry={() => undefined}
        degradedAction={<button type="button">{'Sign in again'}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
