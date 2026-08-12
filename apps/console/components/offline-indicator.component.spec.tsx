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
 * The user-visible half of AGL-1056's indicator. Two properties are worth
 * pinning: it says NOTHING on a healthy connection (chrome that is always
 * there is chrome nobody reads), and it never announces offline before it has
 * measured — a false "you are offline" over a working editor is worse than the
 * silence it replaces.
 */

import { act, render, screen } from '@testing-library/react'
import OfflineIndicator from './offline-indicator.component'

function setOnLine(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  })
}

afterEach(() => setOnLine(true))

describe('OfflineIndicator (AGL-1056)', () => {
  it('shows no pill while the connection is healthy', () => {
    setOnLine(true)
    render(<OfflineIndicator />)
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('keeps the live region mounted even when silent', () => {
    // A polite region has to pre-exist its content to be announced; one that
    // appears already populated is skipped by most screen readers.
    setOnLine(true)
    render(<OfflineIndicator />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('says so the moment the connection drops', () => {
    setOnLine(true)
    render(<OfflineIndicator />)

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText('Offline')).toBeTruthy()

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('renders the offline pill on a first paint that is already offline', () => {
    // No transition to observe here — the very first render has to be right,
    // which is what reading the store on mount buys.
    setOnLine(false)
    render(<OfflineIndicator />)
    expect(screen.getByText('Offline')).toBeTruthy()
  })
})
