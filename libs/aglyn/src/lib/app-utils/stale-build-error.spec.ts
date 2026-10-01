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
  recoverStaleBuildOrReport,
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

/**
 * The one recovery every boundary runs (AGL-3423). Before it, the two
 * boundaries a published page's body actually reaches only re-dispatched, so a
 * stale tab kept an empty body and the beacon reported a `ChunkLoadError`.
 */
describe('recoverStaleBuildOrReport', () => {
  const stale = () =>
    Object.assign(new Error('Failed to load chunk /_next/x.js'), {
      name: 'ChunkLoadError',
    })

  function withReportError(): jest.Mock {
    const reportError = jest.fn()
    Object.defineProperty(window, 'reportError', {
      value: reportError,
      configurable: true,
      writable: true,
    })
    return reportError
  }

  it('reloads a stale build and does NOT report it', () => {
    const reportError = withReportError()
    const reload = jest.fn()

    expect(recoverStaleBuildOrReport(stale(), reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports the failure a reload already failed to cure, and reloads no more', () => {
    const reportError = withReportError()
    const reload = jest.fn()
    recoverStaleBuildOrReport(stale(), reload)
    reload.mockClear()

    const again = stale()
    expect(recoverStaleBuildOrReport(again, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(again)
  })

  it('reports every other error without reloading', () => {
    const reportError = withReportError()
    const reload = jest.fn()
    const boom = new TypeError("Cannot read properties of null (reading 'indexOf')")

    expect(recoverStaleBuildOrReport(boom, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(boom)
  })
})

/**
 * The same stale tab when no boundary saw it: an `import()` nobody awaited
 * inside a render rejects to `window` (AGL-3423). The page is still up and may
 * hold unsaved work, so the reload waits for the tab to be hidden.
 *
 * The module holds the pending reload, so each case loads a fresh copy; the
 * `afterEach` hides the tab once so no case leaves a listener armed for the
 * next.
 */
describe('recoverStaleBuildRejection', () => {
  type Module = typeof import('./stale-build-error')

  const stale = () =>
    Object.assign(new Error('Failed to load chunk /_next/static/chunks/x.js'), {
      name: 'ChunkLoadError',
    })

  function fresh(): Module {
    let loaded: Module | undefined
    jest.isolateModules(() => {
      loaded = jest.requireActual<Module>('./stale-build-error')
    })
    return loaded as Module
  }

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    })
  }

  function hideTab(): void {
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    setVisibility('visible')
  })

  afterEach(() => {
    hideTab()
    delete (document as { visibilityState?: unknown }).visibilityState
  })

  it('waits for the tab to be hidden, then reloads once', () => {
    const { recoverStaleBuildRejection } = fresh()
    const reload = jest.fn()

    expect(recoverStaleBuildRejection(stale(), reload)).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('aglyn.staleBuildReloaded')).toBeTruthy()

    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload for a tab that is merely shown again', () => {
    const { recoverStaleBuildRejection } = fresh()
    const reload = jest.fn()
    recoverStaleBuildRejection(stale(), reload)

    document.dispatchEvent(new Event('visibilitychange'))

    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads at once when the tab is already hidden', () => {
    const { recoverStaleBuildRejection } = fresh()
    const reload = jest.fn()
    setVisibility('hidden')

    expect(recoverStaleBuildRejection(stale(), reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('absorbs every later stale rejection while the reload is pending', () => {
    const { recoverStaleBuildRejection } = fresh()
    const reload = jest.fn()
    recoverStaleBuildRejection(stale(), reload)

    // The recovery mark is spent, so without the pending reload these would
    // read as a reload that failed to cure the tab, and be reported.
    expect(recoverStaleBuildRejection(stale(), reload)).toBe(true)
    expect(recoverStaleBuildRejection(stale(), reload)).toBe(true)
    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('declines a stale build whose recovery is spent, so the beacon reports it', () => {
    const { recoverStaleBuildRejection } = fresh()
    window.sessionStorage.setItem('aglyn.staleBuildReloaded', String(Date.now()))

    expect(recoverStaleBuildRejection(stale(), jest.fn())).toBe(false)
  })

  it('declines every other rejection, without spending the recovery', () => {
    const { recoverStaleBuildRejection } = fresh()
    const reload = jest.fn()

    expect(recoverStaleBuildRejection(new Error('a save was refused'), reload)).toBe(false)
    expect(recoverStaleBuildRejection('aborted', reload)).toBe(false)
    expect(window.sessionStorage.getItem('aglyn.staleBuildReloaded')).toBeNull()
    hideTab()
    expect(reload).not.toHaveBeenCalled()
  })

  it('lets a boundary that crashes meanwhile take the pending reload at once', () => {
    const { recoverStaleBuildOrReport, recoverStaleBuildRejection } = fresh()
    const reportError = jest.fn()
    Object.defineProperty(window, 'reportError', {
      value: reportError,
      configurable: true,
      writable: true,
    })
    const pending = jest.fn()
    const now = jest.fn()
    recoverStaleBuildRejection(stale(), pending)

    expect(recoverStaleBuildOrReport(stale(), now)).toBe(true)
    expect(now).toHaveBeenCalledTimes(1)
    expect(reportError).not.toHaveBeenCalled()
    hideTab()
    expect(pending).not.toHaveBeenCalled()
  })

  it('keeps the pending reload when a boundary catches an unrelated error', () => {
    const { recoverStaleBuildOrReport, recoverStaleBuildRejection } = fresh()
    Object.defineProperty(window, 'reportError', {
      value: jest.fn(),
      configurable: true,
      writable: true,
    })
    const pending = jest.fn()
    recoverStaleBuildRejection(stale(), pending)

    expect(recoverStaleBuildOrReport(new TypeError('boom'), jest.fn())).toBe(false)
    hideTab()
    expect(pending).toHaveBeenCalledTimes(1)
  })
})
