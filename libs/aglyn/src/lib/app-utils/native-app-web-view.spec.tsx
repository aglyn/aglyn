/**
 * @jest-environment jsdom
 */
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
import { renderToString } from 'react-dom/server'
import {
  isNativeAppWebView,
  markNativeAppWebView,
  nativeAppUserAgentMarker,
  useIsNativeAppWebView,
  userAgentNamesNativeApp,
} from './native-app-web-view'

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
/** WKWebView keeps its default `Mobile/<build>` and the app appends its marker. */
const APP_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AglynApp/1.4.0 (ios)'
const APP_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) AglynApp/1.4.0 (macos)'
/** Android's System WebView user agent with the app's suffix. */
const APP_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64 Build/TE1A.220922.034; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.123 Mobile Safari/537.36 AglynApp/1.4.0 (android)'
const APP_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0 AglynApp/1.4.0 (windows)'

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value,
    configurable: true,
  })
}

const ORIGINAL_UA = window.navigator.userAgent

afterEach(() => {
  window.sessionStorage.clear()
  setUserAgent(ORIGINAL_UA)
})

describe('the apps\' user-agent marker (AGL-3894)', () => {
  it('has the shape the native web views append', () => {
    expect(nativeAppUserAgentMarker('1.4.0', 'ios')).toBe('AglynApp/1.4.0 (ios)')
    expect(nativeAppUserAgentMarker('', 'android')).toBe('AglynApp/0 (android)')
  })

  it.each([
    ['iPhone app', APP_IPHONE],
    ['Mac app', APP_MAC],
    ['Android app', APP_ANDROID],
    ['Windows app', APP_WINDOWS],
  ])('names the %s', (_label, userAgent) => {
    expect(userAgentNamesNativeApp(userAgent)).toBe(true)
  })

  it.each([
    ['Safari on an iPhone', SAFARI_IPHONE],
    ['an empty agent', ''],
    ['no agent', undefined],
    ['the word with no version', 'Mozilla/5.0 AglynApp'],
    ['a longer product name', 'Mozilla/5.0 NotAglynApp/2.0'],
  ])('does not name %s', (_label, userAgent) => {
    expect(userAgentNamesNativeApp(userAgent)).toBe(false)
  })
})

describe('isNativeAppWebView (AGL-3894)', () => {
  it('is false in an ordinary browser tab', () => {
    setUserAgent(SAFARI_IPHONE)
    expect(isNativeAppWebView()).toBe(false)
  })

  it('holds from the user-agent marker alone, with no entry-page mark', () => {
    setUserAgent(APP_ANDROID)
    expect(window.sessionStorage.length).toBe(0)
    expect(isNativeAppWebView()).toBe(true)
  })

  it('holds from the entry page\'s mark alone, for an app build without the marker', () => {
    setUserAgent(SAFARI_IPHONE)
    markNativeAppWebView()
    expect(isNativeAppWebView()).toBe(true)
  })
})

function Probe() {
  return <span>{useIsNativeAppWebView() ? 'in app' : 'in browser'}</span>
}

describe('useIsNativeAppWebView (AGL-3894)', () => {
  it('renders the browser\'s answer on the server, so hydration matches', () => {
    setUserAgent(APP_MAC)
    expect(renderToString(<Probe />)).toContain('in browser')
  })

  it('answers from the marker on the client', () => {
    setUserAgent(APP_MAC)
    render(<Probe />)
    expect(screen.getByText('in app')).toBeTruthy()
  })
})
