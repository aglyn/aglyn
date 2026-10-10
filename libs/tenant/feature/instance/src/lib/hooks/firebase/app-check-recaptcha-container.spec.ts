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
 * Production, 2026-10-10 18:11Z: a new password sign-up reported
 * `reCAPTCHA placeholder element must be an element or id` as an
 * unhandledrejection on `/verify-email` and then on `/`.
 *
 * The REAL `@firebase/app-check` SDK runs here, against a stand-in
 * `grecaptcha` whose `render` refuses a missing container exactly the way
 * Google's does. `ready()` callbacks are held until the test releases them,
 * which is the script-load gap in which the page cleared `<body>`.
 */

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  appCheckRecaptchaContainerId,
  keepAppCheckRecaptchaContainer,
} from './app-check-recaptcha-container'

const PLACEHOLDER_ERROR = 'reCAPTCHA placeholder element must be an element or id'

type Grecaptcha = {
  ready: (cb: () => void) => void
  render: jest.Mock
  execute: jest.Mock
}

let pendingReady: Array<() => void> = []
let grecaptcha: Grecaptcha
let apps: FirebaseApp[] = []
let stops: Array<() => void> = []

const flushMutations = () => new Promise<void>((r) => setTimeout(r, 0))

/** What Google's script does when `ready()` fires: render, or throw. */
function releaseReady(): void {
  const queued = pendingReady
  pendingReady = []
  queued.forEach((cb) => cb())
}

function startAppCheck(name: string): FirebaseApp {
  const app = initializeApp(
    { apiKey: 'k', appId: '1:1:web:1', projectId: 'p' },
    name,
  )
  apps.push(app)
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('site-key'),
    isTokenAutoRefreshEnabled: false,
  })
  return app
}

beforeEach(() => {
  pendingReady = []
  grecaptcha = {
    ready: (cb) => pendingReady.push(cb),
    render: jest.fn((container: string | HTMLElement) => {
      const el =
        typeof container === 'string'
          ? document.getElementById(container)
          : container
      if (!el || !el.isConnected) throw new Error(PLACEHOLDER_ERROR)
      el.appendChild(document.createElement('iframe'))
      return 0
    }),
    execute: jest.fn(() => Promise.resolve('token')),
  }
  ;(globalThis as { grecaptcha?: Grecaptcha }).grecaptcha = grecaptcha
})

afterEach(async () => {
  stops.forEach((stop) => stop())
  stops = []
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)))
  apps = []
  document.body.innerHTML = ''
  delete (globalThis as { grecaptcha?: Grecaptcha }).grecaptcha
})

describe('App Check reCAPTCHA container', () => {
  it('reproduces the bug: the body is cleared before ready(), and render throws', async () => {
    startAppCheck('unkept')
    expect(
      document.getElementById(appCheckRecaptchaContainerId('unkept')),
    ).not.toBeNull()

    // Hydration fallback / global-error: everything React did not render goes.
    document.body.innerHTML = ''
    await flushMutations()

    expect(releaseReady).toThrow(PLACEHOLDER_ERROR)
  })

  it('puts the container back before ready() renders into it', async () => {
    const app = startAppCheck('kept')
    stops.push(keepAppCheckRecaptchaContainer(app.name))
    const id = appCheckRecaptchaContainerId(app.name)
    const original = document.getElementById(id)

    document.body.innerHTML = ''
    await flushMutations()

    expect(releaseReady).not.toThrow()
    expect(grecaptcha.render).toHaveBeenCalledWith(id, expect.anything())
    // The SDK's own element, not a look-alike.
    expect(document.getElementById(id)).toBe(original)
    expect(original?.querySelector('iframe')).not.toBeNull()
  })

  it('survives <body> itself being replaced (global-error)', async () => {
    const app = startAppCheck('replaced')
    stops.push(keepAppCheckRecaptchaContainer(app.name))
    const id = appCheckRecaptchaContainerId(app.name)

    document.documentElement.replaceChild(
      document.createElement('body'),
      document.body,
    )
    await flushMutations()

    expect(releaseReady).not.toThrow()
    expect(document.body.contains(document.getElementById(id))).toBe(true)
  })

  it('keeps the rendered widget in the page for later tokens', async () => {
    const app = startAppCheck('after-render')
    stops.push(keepAppCheckRecaptchaContainer(app.name))
    const id = appCheckRecaptchaContainerId(app.name)
    releaseReady()

    document.body.innerHTML = ''
    await flushMutations()

    expect(document.getElementById(id)?.querySelector('iframe')).not.toBeNull()
  })

  it('is one keeper per app, and leaves an intact page alone', async () => {
    const app = startAppCheck('once')
    const stop = keepAppCheckRecaptchaContainer(app.name)
    stops.push(stop)
    expect(keepAppCheckRecaptchaContainer(app.name)).toBe(stop)

    document.body.appendChild(document.createElement('main'))
    await flushMutations()

    expect(
      document.querySelectorAll(`#${appCheckRecaptchaContainerId(app.name)}`),
    ).toHaveLength(1)
  })
})
