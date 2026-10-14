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

import {
  BROWSER_FAMILIES,
  browserFamily,
  isBrowserFamily,
  type BrowserFamily,
} from './browser-family'

/** Real agents, one per family the classifier must place (AGL-3732). */
const CASES: Array<[string, BrowserFamily, string]> = [
  // Safari
  [
    'macOS Safari',
    'safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ],
  [
    'iPhone Safari',
    'safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  [
    'iPad Safari',
    'safari',
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  ],
  // Chrome
  [
    'Windows Chrome',
    'chrome',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ],
  [
    'Chrome OS',
    'chrome',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ],
  [
    'Android Chrome',
    'chrome',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  ],
  [
    'iOS Chrome',
    'chrome',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  ],
  // Firefox
  [
    'Windows Firefox',
    'firefox',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  ],
  [
    'Android Firefox',
    'firefox',
    'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  ],
  [
    'iOS Firefox',
    'firefox',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  ],
  // Edge
  [
    'Windows Edge',
    'edge',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79',
  ],
  [
    'Android Edge',
    'edge',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.2792.84',
  ],
  [
    'iOS Edge',
    'edge',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/129.2792.84 Mobile/15E148 Safari/605.1.15',
  ],
  // Samsung Internet
  [
    'Samsung Internet',
    'samsung',
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  ],
  // Webviews
  [
    'Android WebView',
    'webview',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36',
  ],
  [
    'Android Facebook in-app',
    'webview',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/483.0.0.53.110;]',
  ],
  [
    'iOS WKWebView (no Safari token)',
    'webview',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ],
  [
    'iOS Instagram',
    'webview',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.25.104 (iPhone15,2; iOS 17_5; en_GB; en-GB; scale=3.00; 1179x2556; 640385424)',
  ],
  [
    'iOS Facebook with a Safari token',
    'webview',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/483.0.0.42.106;FBBV/650000000;]',
  ],
  // Other
  [
    'Opera',
    'other',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  ],
  [
    'jsdom',
    'other',
    'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/20.0.3',
  ],
  ['curl', 'other', 'curl/8.7.1'],
]

describe('browserFamily (AGL-3732)', () => {
  it.each(CASES)('%s → %s', (_name, family, ua) => {
    expect(browserFamily(ua)).toBe(family)
  })

  it('is total: anything that is not an agent string is `other`', () => {
    for (const value of [undefined, null, '', 42, {}, ['Chrome/1']]) {
      expect(browserFamily(value)).toBe('other')
    }
  })

  it('only ever answers one of the seven families', () => {
    for (const [, , ua] of CASES) {
      expect(BROWSER_FAMILIES).toContain(browserFamily(ua))
    }
  })
})

describe('isBrowserFamily (AGL-3732)', () => {
  it('accepts exactly the seven families', () => {
    expect([...BROWSER_FAMILIES]).toEqual([
      'safari',
      'chrome',
      'firefox',
      'edge',
      'samsung',
      'webview',
      'other',
    ])
    for (const family of BROWSER_FAMILIES) expect(isBrowserFamily(family)).toBe(true)
  })

  it('refuses everything else, including a raw agent and a different case', () => {
    for (const value of ['Chrome', 'chrome/129', 'opera', '', CASES[0][2], null, 1]) {
      expect(isBrowserFamily(value)).toBe(false)
    }
  })
})
