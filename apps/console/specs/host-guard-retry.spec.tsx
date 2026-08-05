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
 * AGL-1200: the guard's "Try again" is WIRED to a retry, not to a reload.
 *
 * `useHostResolution` gaining a `retry()` fixes nothing on its own — the
 * defect users hit was in the button, which called `window.location.reload()`
 * and so re-entered the same cold-load window that had just failed. A retry
 * with no caller is the shape of fix that passes its own unit tests and
 * changes nothing on screen, so this asserts the call site.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import {
  HostErrorContext,
  HostIdContext,
  HostReadyContext,
  HostRetryContext,
  HostSubdomainContext,
} from '../components/host-id-provider'
import HostGuard from '../components/host-guard.component'

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound() called')
  },
}))

/** The failed-resolution state: on a host route, settled, no host, errored. */
function renderErrored(retry: () => void) {
  return render(
    <HostSubdomainContext.Provider value="aglyn-marketing">
      <HostReadyContext.Provider value={true}>
        <HostIdContext.Provider value={null as never}>
          <HostErrorContext.Provider value={true}>
            <HostRetryContext.Provider value={retry}>
              <HostGuard>
                <div>{'editor'}</div>
              </HostGuard>
            </HostRetryContext.Provider>
          </HostErrorContext.Provider>
        </HostIdContext.Provider>
      </HostReadyContext.Provider>
    </HostSubdomainContext.Provider>,
  )
}

describe('HostGuard — Try again retries in place (AGL-1200)', () => {
  it('REGRESSION — the button calls retry, and does NOT reload the page', () => {
    const retry = jest.fn()
    renderErrored(retry)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    // This one assertion separates the old handler from the new one: the old
    // one called `window.location.reload()` and never touched `retry`, so it
    // scores 0 here. The reload itself is NOT asserted against — in jsdom
    // `window.location` cannot be redefined and `location.reload` is a
    // read-only property, so it can be neither replaced nor spied on. The
    // call count is the honest, available proof.
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('still shows the error copy rather than a 404 (AGL-813)', () => {
    // The guard must never turn a transient read failure into "this site does
    // not exist" — `notFound()` throws in this spec, so reaching it fails.
    renderErrored(jest.fn())
    expect(
      screen.getByText(/Couldn't load this workspace's sites/),
    ).toBeTruthy()
    expect(screen.queryByText('editor')).toBeNull()
  })

  it('CONTROL — renders children once a host resolves', () => {
    // Without this, "shows the error" is satisfied by a guard that never
    // renders anything.
    render(
      <HostSubdomainContext.Provider value="aglyn-marketing">
        <HostReadyContext.Provider value={true}>
          <HostIdContext.Provider value={'host-1'}>
            <HostErrorContext.Provider value={false}>
              <HostGuard>
                <div>{'editor'}</div>
              </HostGuard>
            </HostErrorContext.Provider>
          </HostIdContext.Provider>
        </HostReadyContext.Provider>
      </HostSubdomainContext.Provider>,
    )
    expect(screen.getByText('editor')).toBeTruthy()
  })
})
