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
 * The console's last boundary reloads a stale build too (AGL-3423).
 *
 * `global-error.tsx` catches a throw in the root layout, and a tab open across
 * a deploy fails there as readily as in `error.tsx`: the root layout asks for
 * its chunks like any other segment. It only re-dispatched, so the operator
 * sat on a crash page with nothing to press.
 *
 * Observed through what the recovery leaves behind, as the tenant's spec of
 * the same recovery does: a reload spends the tab's mark in session storage,
 * and a reloaded error is not handed to `reportError`.
 */

import { render, screen } from '@testing-library/react'
import ConsoleGlobalError from '../app/global-error'

const RECOVERY_MARK = 'aglyn.staleBuildReloaded'

function staleBuild(): Error {
  return Object.assign(
    new Error('Failed to load chunk /_next/static/immutable/chunks/0a1b2c3d.js'),
    { name: 'ChunkLoadError' },
  )
}

let reportError: jest.Mock

beforeEach(() => {
  window.sessionStorage.clear()
  reportError = jest.fn()
  Object.defineProperty(window, 'reportError', {
    value: reportError,
    configurable: true,
    writable: true,
  })
  // React warns about <html> inside the test container, and jsdom logs the
  // reload it cannot do.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('console global-error.tsx', () => {
  it('reloads a stale build and does not report it', () => {
    render(<ConsoleGlobalError error={staleBuild()} reset={jest.fn()} />)

    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeTruthy()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('offers a reload, not a crash, when the recovery is spent', () => {
    window.sessionStorage.setItem(RECOVERY_MARK, String(Date.now()))
    const error = staleBuild()

    render(<ConsoleGlobalError error={error} reset={jest.fn()} />)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(screen.getByText('This page is out of date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('reports every other error, without spending the recovery', () => {
    const error = new Error('root layout failed')

    render(<ConsoleGlobalError error={error} reset={jest.fn()} />)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeNull()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })
})
