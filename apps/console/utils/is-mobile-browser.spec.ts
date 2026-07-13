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

import { isMobileBrowser } from './is-mobile-browser'

function stubNavigator(overrides: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(window.navigator, key, {
      value,
      configurable: true,
    })
  }
}

describe('isMobileBrowser', () => {
  afterEach(() => {
    stubNavigator({
      userAgentData: undefined,
      userAgent: '',
      maxTouchPoints: 0,
    })
  })

  it('trusts UA-Client-Hints when present', () => {
    stubNavigator({ userAgentData: { mobile: true } })
    expect(isMobileBrowser()).toBe(true)
    stubNavigator({
      userAgentData: { mobile: false },
      // A mobile-looking UA must not override an explicit hint.
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    expect(isMobileBrowser()).toBe(false)
  })

  it('falls back to UA sniffing for mobile devices', () => {
    stubNavigator({
      userAgentData: undefined,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
    })
    expect(isMobileBrowser()).toBe(true)
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    expect(isMobileBrowser()).toBe(true)
  })

  it('treats desktop UAs as non-mobile', () => {
    stubNavigator({
      userAgentData: undefined,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      maxTouchPoints: 0,
    })
    expect(isMobileBrowser()).toBe(false)
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
    })
    expect(isMobileBrowser()).toBe(false)
  })

  it('detects iPadOS masquerading as macOS via the touch surface', () => {
    stubNavigator({
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      maxTouchPoints: 5,
    })
    expect(isMobileBrowser()).toBe(true)
  })
})
