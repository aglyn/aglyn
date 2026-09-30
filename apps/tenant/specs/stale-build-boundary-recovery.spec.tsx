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
 * The boundaries a published page's body reaches reload a stale build too
 * (AGL-3423).
 *
 * A site plugin's chunk is loaded by the page body, so a tab holding the
 * previous deploy's HTML fails inside `PageBodyBoundary`, or in
 * `[host]/[scheme]/error.tsx` above it — never in `app/error.tsx`, the only
 * tenant boundary that ran the AGL-3279 reload. Both only re-dispatched: the
 * visitor kept an empty body or a **Try again** that re-requests the missing
 * chunk, and the beacon reported a `ChunkLoadError` for it.
 *
 * Observed through what the recovery leaves behind rather than through the
 * reload itself, which jsdom will not let a spec redefine: a reload SPENDS
 * the tab's recovery mark in session storage, and a reloaded error is not
 * handed to `reportError`.
 */

import { render, screen } from '@testing-library/react'
import PageBodyBoundary from '../app/[host]/[scheme]/[[...slug]]/page-body-boundary'
import HostError from '../app/[host]/[scheme]/error'
import GlobalError from '../app/global-error'

jest.mock('next/dynamic', () => () => () => null)

const RECOVERY_MARK = 'aglyn.staleBuildReloaded'

function staleBuild(): Error {
  return Object.assign(
    new Error('Failed to load chunk /_next/static/immutable/chunks/40dbnln1sqm49.js'),
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
  // React logs every caught error, and jsdom logs the reload it cannot do.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

function Throws({ error }: { error: Error }): never {
  throw error
}

describe('PageBodyBoundary', () => {
  it('reloads a stale build instead of leaving an empty body, and does not report it', () => {
    render(
      <PageBodyBoundary>
        <Throws error={staleBuild()} />
      </PageBodyBoundary>,
    )

    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeTruthy()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports the stale build a reload already failed to cure', () => {
    window.sessionStorage.setItem(RECOVERY_MARK, String(Date.now()))
    const error = staleBuild()

    render(
      <PageBodyBoundary>
        <Throws error={error} />
      </PageBodyBoundary>,
    )

    expect(reportError).toHaveBeenCalledWith(error)
  })

  it('reports every other error, without spending the recovery', () => {
    const error = new TypeError("Cannot read properties of null (reading 'indexOf')")

    render(
      <PageBodyBoundary>
        <Throws error={error} />
      </PageBodyBoundary>,
    )

    expect(reportError).toHaveBeenCalledWith(error)
    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeNull()
  })
})

describe('[host]/[scheme]/error.tsx', () => {
  it('reloads a stale build and does not report it', () => {
    render(<HostError error={staleBuild()} reset={jest.fn()} />)

    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeTruthy()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports every other error, without spending the recovery', () => {
    const error = new Error('load-page-data failed')

    render(<HostError error={error} reset={jest.fn()} />)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeNull()
  })
})

/**
 * The last boundary, for a throw in the root layout. A stale tab's root layout
 * asks for its chunks like any other segment, and this only re-dispatched.
 */
describe('global-error.tsx', () => {
  it('reloads a stale build and does not report it', () => {
    render(<GlobalError error={staleBuild()} reset={jest.fn()} />)

    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeTruthy()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('offers a reload, not a crash, when the recovery is spent', () => {
    window.sessionStorage.setItem(RECOVERY_MARK, String(Date.now()))
    const error = staleBuild()

    render(<GlobalError error={error} reset={jest.fn()} />)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(screen.getByText('This page is out of date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('reports every other error, without spending the recovery', () => {
    const error = new Error('root layout failed')

    render(<GlobalError error={error} reset={jest.fn()} />)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(window.sessionStorage.getItem(RECOVERY_MARK)).toBeNull()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })
})
