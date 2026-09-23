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

/**
 * The tab open across a deploy, and the reload that fixes it (AGL-3279).
 *
 * The contract that matters most is the NEGATIVE one: this may never
 * reload in a loop, and it may never reload for an error a reload cannot
 * fix. A recovery that runs away is worse than the crash page it replaces.
 */

import {
  isStaleBuildError,
  RECOVERY_INTERVAL_MS,
  shouldReloadForStaleBuild,
} from './stale-build-error'

beforeEach(() => {
  window.sessionStorage.clear()
  jest.restoreAllMocks()
})

describe('isStaleBuildError', () => {
  it('knows webpack own chunk failure by name', () => {
    const error = Object.assign(new Error('Failed to load chunk /_next/x.js'), {
      name: 'ChunkLoadError',
    })

    expect(isStaleBuildError(error)).toBe(true)
  })

  it('knows a native dynamic import failure, which is a plain TypeError', () => {
    // Every browser words this differently and none of them sets a name.
    expect(
      isStaleBuildError(
        new TypeError('Failed to fetch dynamically imported module: https://a/b.js'),
      ),
    ).toBe(true)
    expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(
      true,
    )
    expect(isStaleBuildError(new Error('error loading dynamically imported module'))).toBe(
      true,
    )
    expect(isStaleBuildError(new Error('Loading CSS chunk 42 failed.'))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isStaleBuildError(new TypeError("Cannot read properties of null"))).toBe(false)
    expect(isStaleBuildError(new Error('Minified React error #185'))).toBe(false)
    expect(isStaleBuildError(null)).toBe(false)
    expect(isStaleBuildError(undefined)).toBe(false)
  })
})

describe('shouldReloadForStaleBuild', () => {
  const stale = () =>
    Object.assign(new Error('Loading chunk 9 failed.'), { name: 'ChunkLoadError' })

  it('says yes once for a stale build, and marks the recovery spent', () => {
    expect(shouldReloadForStaleBuild(stale())).toBe(true)
    expect(window.sessionStorage.getItem('aglyn.staleBuildReloaded')).toBeTruthy()
  })

  it('REFUSES the second reload inside the interval, so it cannot loop', () => {
    expect(shouldReloadForStaleBuild(stale())).toBe(true)

    expect(shouldReloadForStaleBuild(stale())).toBe(false)
  })

  it('recovers again once the interval has passed — a tab outlives a release', () => {
    expect(shouldReloadForStaleBuild(stale())).toBe(true)
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + RECOVERY_INTERVAL_MS + 1_000)

    expect(shouldReloadForStaleBuild(stale())).toBe(true)
  })

  it('does nothing for an error a reload cannot fix', () => {
    expect(shouldReloadForStaleBuild(new TypeError('boom'))).toBe(false)
  })

  it('takes the crash page rather than an unbounded reload when storage is refused', () => {
    // A private window, or site data blocked: with no way to remember the
    // reload there is no way to bound it.
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(shouldReloadForStaleBuild(stale())).toBe(false)
  })

  it('recovers when the stored mark is unreadable, rather than never again', () => {
    window.sessionStorage.setItem('aglyn.staleBuildReloaded', 'not a number')

    expect(shouldReloadForStaleBuild(stale())).toBe(true)
  })
})
