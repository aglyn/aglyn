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
 * Where the docs build loads the first-touch capture from (AGL-3289). The
 * build names its console twice without a variable of its own — the status
 * page's `console` target and the error endpoint — and the capture must follow
 * the first of those that is a real http(s) origin, or load nothing at all.
 */

import { firstTouchScriptUrl } from '../src/first-touch-source'

const TARGETS =
  'console|Console|https://app.example.com|Signing in|/api/health,' +
  'sites|Published sites|https://example.com|A published page|/api/health/render/site'

describe('firstTouchScriptUrl', () => {
  it('loads nothing when the build names no console', () => {
    expect(firstTouchScriptUrl({})).toBeUndefined()
    expect(firstTouchScriptUrl({ statusTargets: '', errorBeaconEndpoint: '' })).toBeUndefined()
  })

  it('follows the console the status page probes', () => {
    expect(firstTouchScriptUrl({ statusTargets: TARGETS })).toBe(
      'https://app.example.com/api/first-touch',
    )
  })

  it('reads the status target before the error endpoint, which may be any collector', () => {
    expect(
      firstTouchScriptUrl({
        statusTargets: TARGETS,
        errorBeaconEndpoint: 'https://errors.example.net/collect',
      }),
    ).toBe('https://app.example.com/api/first-touch')
  })

  it('falls back to the console the errors are reported to', () => {
    expect(
      firstTouchScriptUrl({ errorBeaconEndpoint: 'https://console.example.com/api/errors' }),
    ).toBe('https://console.example.com/api/first-touch')
  })

  it('never takes another target for the console', () => {
    expect(
      firstTouchScriptUrl({ statusTargets: 'sites|Published sites|https://example.com' }),
    ).toBeUndefined()
  })

  it('skips a source that is not an http(s) origin', () => {
    expect(
      firstTouchScriptUrl({
        statusTargets: 'console|Console|not a url',
        errorBeaconEndpoint: 'javascript:alert(1)',
      }),
    ).toBeUndefined()
    expect(
      firstTouchScriptUrl({
        statusTargets: 'console|Console|ftp://files.example.com',
        errorBeaconEndpoint: 'https://console.example.com/api/errors',
      }),
    ).toBe('https://console.example.com/api/first-touch')
  })
})
