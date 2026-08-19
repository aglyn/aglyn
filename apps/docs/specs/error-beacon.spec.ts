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
 * `apps/docs` had no `test` target and no spec file in its history
 * (AGL-2377), so `nx affected -t lint test build` could only ever build it.
 * This is the first suite, and it is pointed at the app's one piece of real
 * runtime logic: the browser error beacon.
 *
 * The two invariants asserted here are the ones that are expensive to get
 * wrong and invisible when they break, because both failure modes are SILENT
 * — the beacon is written never to throw:
 *
 *  - ARMING (AGL-2124). `apps/docs` ships in the open-source distribution.
 *    With no configured endpoint the beacon must install NO handlers at all,
 *    never fall back to Aglyn's collector. The bug this replaced POSTed a
 *    self-hoster's page URLs and stack traces to us, filed under our own
 *    `docs-web` service, with neither party consenting.
 *  - PRIVACY. Reported URLs are scrubbed to origin + pathname, so a search
 *    page's `?q=…` never leaves the browser. The beacon carries no user
 *    identifier and no cookies; the query string is the one place user-typed
 *    text could ride along, and nothing else in the pipeline strips it.
 *
 * The module installs its handlers at IMPORT time behind that gate, so every
 * test loads it through `jest.isolateModules` after setting the world up.
 */

const ENDPOINT = 'https://collector.example/api/errors'

/** Loads error-beacon.ts fresh, with the site config and NODE_ENV given. */
function loadBeacon(options: {
  endpoint?: string
  nodeEnv?: string
}): void {
  ;(globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__'] =
    options.endpoint === undefined
      ? {}
      : { errorBeaconEndpoint: options.endpoint }
  const previous = process.env.NODE_ENV
  // The production gate mirrors the gtag posture: `docusaurus start` never
  // reports. Jest runs as 'test', so every armed case has to say so.
  ;(process.env as Record<string, string>).NODE_ENV =
    options.nodeEnv ?? 'production'
  try {
    jest.isolateModules(() => {
      require('../src/error-beacon')
    })
  } finally {
    ;(process.env as Record<string, string>).NODE_ENV = previous as string
  }
}

/** The events of the last `sendBeacon` call, decoded. */
function beaconedEvents(send: jest.Mock): any[] {
  const body = send.mock.calls[send.mock.calls.length - 1]?.[1]
  return JSON.parse(String(body)).events
}

/**
 * A cancelable `error` event.
 *
 * jsdom re-throws an ErrorEvent's `error` as an uncaught exception unless the
 * event is canceled, exactly as a browser would — "unhandled" is what an
 * uncanceled error event MEANS. The beacon deliberately does not
 * `preventDefault()`: swallowing the page's error is not its job, it only
 * observes. So the harness cancels it (see `beforeEach`) and the events have
 * to be cancelable for that to bite.
 */
function errorEvent(init: ErrorEventInit): ErrorEvent {
  return new ErrorEvent('error', { cancelable: true, ...init })
}

let sendBeacon: jest.Mock

/**
 * Every handler the module under test installed, so it can be uninstalled.
 *
 * jsdom hands the whole FILE one `window`, and `jest.isolateModules` only
 * gives a fresh module registry — the listeners a previous test's import
 * added are still attached. Without this, the beacon accumulates one handler
 * set per test: the "installs nothing" cases pass because an EARLIER,
 * correctly-armed copy answers, and the per-pageview cap counts every copy's
 * events. Both read as product bugs and neither is one, which is precisely
 * the kind of unfaithful double that fabricates false reds.
 */
let installed: Array<[EventTarget, string, any]> = []

beforeEach(() => {
  jest.useFakeTimers()
  installed = []
  // Stop the synthetic error at the beacon — see `errorEvent`. Registered
  // before the spy below so it is not counted as something the module
  // installed, and removed by jsdom when the file's window is torn down.
  window.addEventListener('error', (event) => event.preventDefault(), true)
  for (const target of [window, document] as EventTarget[]) {
    jest
      .spyOn(target, 'addEventListener')
      .mockImplementation(function (this: EventTarget, type: any, fn: any, opts?: any) {
        installed.push([target, type, fn])
        return EventTarget.prototype.addEventListener.call(this, type, fn, opts)
      } as any)
  }
  sendBeacon = jest.fn(() => true)
  Object.defineProperty(window.navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: sendBeacon,
  })
  window.history.replaceState({}, '', '/learn/getting-started')
})

afterEach(() => {
  // Uninstall BEFORE restoring the spies — the removal has to go through the
  // real `removeEventListener`, and the record has to still exist.
  for (const [target, type, fn] of installed) {
    EventTarget.prototype.removeEventListener.call(target, type, fn)
  }
  installed = []
  jest.useRealTimers()
  jest.restoreAllMocks()
  delete (globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__']
})

describe('the docs error beacon arms only when configured (AGL-2124)', () => {
  it('reports an error once an endpoint is configured', () => {
    loadBeacon({ endpoint: ENDPOINT })
    window.dispatchEvent(
      errorEvent({
        message: 'boom',
        error: new Error('boom'),
        filename: 'https://docs.example/assets/main.js',
        lineno: 12,
        colno: 34,
      }),
    )
    jest.runAllTimers()
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(sendBeacon.mock.calls[0][0]).toBe(ENDPOINT)
    const [event] = beaconedEvents(sendBeacon)
    expect(event.kind).toBe('error')
    expect(event.message).toBe('boom')
    expect(event.line).toBe(12)
  })

  it('with NO endpoint configured it installs nothing at all', () => {
    // Not "falls back to ours" — reports NOWHERE. An unconfigured self-host
    // build must not send a stranger's stack traces to Aglyn's collector.
    loadBeacon({ endpoint: undefined })
    window.dispatchEvent(
      errorEvent({ message: 'boom', error: new Error('boom') }),
    )
    jest.runAllTimers()
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('stays disarmed outside a production build', () => {
    // `docusaurus start` never reports, even with an endpoint configured.
    loadBeacon({ endpoint: ENDPOINT, nodeEnv: 'development' })
    window.dispatchEvent(
      errorEvent({ message: 'boom', error: new Error('boom') }),
    )
    jest.runAllTimers()
    expect(sendBeacon).not.toHaveBeenCalled()
  })
})

describe('the docs error beacon never reports a query string', () => {
  it('scrubs the page URL to origin + pathname', () => {
    // The search page carries what the reader typed. Nothing downstream
    // strips it, so it has to be stripped here or not at all.
    window.history.replaceState({}, '', '/search?q=my+private+search#hit-3')
    loadBeacon({ endpoint: ENDPOINT })
    window.dispatchEvent(
      errorEvent({ message: 'boom', error: new Error('boom') }),
    )
    jest.runAllTimers()
    const [event] = beaconedEvents(sendBeacon)
    expect(event.url).toBe('http://localhost/search')
    expect(JSON.stringify(event)).not.toContain('my+private+search')
  })

  it('scrubs the failing script URL too', () => {
    loadBeacon({ endpoint: ENDPOINT })
    window.dispatchEvent(
      errorEvent({
        message: 'boom',
        error: new Error('boom'),
        filename: 'https://docs.example/assets/main.js?token=abc123',
      }),
    )
    jest.runAllTimers()
    const [event] = beaconedEvents(sendBeacon)
    expect(event.source).toBe('https://docs.example/assets/main.js')
    expect(JSON.stringify(event)).not.toContain('abc123')
  })
})

describe('the docs error beacon does not become the outage', () => {
  it('collapses a repeated error into ONE report', () => {
    loadBeacon({ endpoint: ENDPOINT })
    const error = new Error('render loop')
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(errorEvent({ message: 'render loop', error }))
    }
    jest.runAllTimers()
    expect(beaconedEvents(sendBeacon)).toHaveLength(1)
  })

  it('drops the opaque cross-origin "Script error."', () => {
    // No stack, no file, nothing actionable — reporting it only creates a
    // noisy group.
    loadBeacon({ endpoint: ENDPOINT })
    window.dispatchEvent(errorEvent({ message: 'Script error.' }))
    jest.runAllTimers()
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('caps a single pageview at 10 reported events', () => {
    loadBeacon({ endpoint: ENDPOINT })
    for (let i = 0; i < 25; i += 1) {
      window.dispatchEvent(
        errorEvent({
          message: `distinct ${i}`,
          error: new Error(`distinct ${i}`),
        }),
      )
    }
    jest.runAllTimers()
    const total = sendBeacon.mock.calls.reduce(
      (sum, call) => sum + JSON.parse(String(call[1])).events.length,
      0,
    )
    expect(total).toBe(10)
  })

  it('an unhandled rejection is reported, and a sendBeacon refusal is survived', () => {
    loadBeacon({ endpoint: ENDPOINT })
    // Reporting must never break the page: when sendBeacon refuses the
    // payload the module falls back to fetch and swallows any failure.
    sendBeacon.mockReturnValue(false)
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error('offline'))
    global.fetch = fetchMock as never
    const rejection = new Event('unhandledrejection') as any
    rejection.reason = new Error('promise died')
    expect(() => {
      window.dispatchEvent(rejection)
      jest.runAllTimers()
    }).not.toThrow()
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.events[0].kind).toBe('unhandledrejection')
    expect(body.events[0].message).toBe('promise died')
  })
})
