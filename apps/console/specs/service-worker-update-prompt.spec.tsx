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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-1055: the console must not swap builds out from under a live page.
 *
 * `skipWaiting()` on install is the tempting one-liner and the wrong default
 * in an authoring tool — it activates a new worker while someone is mid-edit.
 * The worker now waits, and only a click promotes it.
 *
 * The two cases worth testing are the ones that are wrong in most
 * implementations of this:
 *
 * 1. **The reload loop.** `controllerchange` can fire more than once; reloading
 *    on each gives a page that reloads forever. Asserted explicitly.
 * 2. **The first install.** There is no update to announce on a first visit,
 *    and prompting there trains people to dismiss the thing that matters.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// `mock`-prefixed because a jest.mock factory is hoisted above the file and
// may not close over an ordinary out-of-scope variable.
const mockEnqueueSnackbar = jest.fn()
const mockCloseSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: mockEnqueueSnackbar,
    closeSnackbar: mockCloseSnackbar,
  }),
}))

import ServiceWorkerRegistrar, {
  createReloadOnce,
} from '../components/service-worker-registrar.component'

/** A stand-in for the parts of the SW registration API the component drives. */
function installFakeServiceWorker(opts: {
  waiting?: boolean
  controller?: boolean
}) {
  const postMessage = jest.fn()
  const waiting = { postMessage, state: 'installed' }
  const controllerListeners: (() => void)[] = []
  const registration = {
    waiting: opts.waiting ? waiting : null,
    installing: null,
    addEventListener: jest.fn(),
  }
  const container = {
    register: jest.fn(async () => registration),
    controller: opts.controller ? {} : null,
    addEventListener: jest.fn((type: string, fn: () => void) => {
      if (type === 'controllerchange') controllerListeners.push(fn)
    }),
  }
  Object.defineProperty(global.navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  })
  return {
    postMessage,
    waiting,
    /** Fire controllerchange n times, as a real browser may. */
    fireControllerChange: (times = 1) => {
      for (let i = 0; i < times; i += 1) {
        for (const fn of [...controllerListeners]) fn()
      }
    },
  }
}

describe('service worker update prompt (AGL-1055)', () => {
  const realEnv = process.env.NODE_ENV

  beforeEach(() => {
    jest.clearAllMocks()
    // The component is production-gated; a dev-mode run would pass every
    // assertion below by doing nothing at all.
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: realEnv,
      configurable: true,
    })
  })

  it('offers a reload when a worker is already waiting', async () => {
    installFakeServiceWorker({ waiting: true, controller: true })
    render(<ServiceWorkerRegistrar />)
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    const [message, options] = mockEnqueueSnackbar.mock.calls[0]
    expect(String(message)).toMatch(/new version/i)
    // Persist: the old build keeps working, so this must never auto-hide or
    // hurry someone who is mid-edit.
    expect(options.persist).toBe(true)
  })

  it('does NOT prompt on a first install (no controller)', async () => {
    // A first visit has nothing to announce. Prompting here is how people
    // learn to dismiss this notice without reading it.
    installFakeServiceWorker({ waiting: true, controller: false })
    render(<ServiceWorkerRegistrar />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
  })

  it('promotes the worker only on the click', async () => {
    const sw = installFakeServiceWorker({ waiting: true, controller: true })
    render(<ServiceWorkerRegistrar />)
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())

    // Nothing happens until the user asks — the old build keeps working.
    expect(sw.postMessage).not.toHaveBeenCalled()

    const action = mockEnqueueSnackbar.mock.calls[0][1].action
    render(<>{typeof action === 'function' ? action('snack-1') : action}</>)
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))

    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  describe('the reload loop guard', () => {
    // `window.location.reload` is read-only under jsdom and cannot be spied
    // on, which is why this guard is a named unit in the component module
    // rather than a boolean inside a callback. It is also the single most
    // likely bug in this code, so testing it directly is the right trade.

    it('reloads exactly once however many times it is called', () => {
      const reload = jest.fn()
      const reloadOnce = createReloadOnce(reload)
      // `controllerchange` really can fire repeatedly.
      reloadOnce()
      reloadOnce()
      reloadOnce()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('CONTROL — it does reload the first time', () => {
      // Without this, "at most once" is satisfied by never reloading at all,
      // which would leave the user stuck on the old build after accepting.
      const reload = jest.fn()
      createReloadOnce(reload)()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('CONTROL — separate instances are independent', () => {
      // A module-level `done` flag would pass the first test and then never
      // reload again for the lifetime of the tab.
      const first = jest.fn()
      const second = jest.fn()
      createReloadOnce(first)()
      createReloadOnce(second)()
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    })
  })
})
