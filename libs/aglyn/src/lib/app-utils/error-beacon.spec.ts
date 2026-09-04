/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://aglyn.com/pricing"}
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
 * What the beacon refuses to report, and what it merely LABELS (AGL-2523).
 *
 * The document URL is pinned in the docblock above rather than left to
 * jsdom's default `http://localhost/`: every assertion here turns on whether
 * a frame is the document or a script, so on the default URL the negative
 * cases would pass for the wrong reason.
 *
 * ⚑ The beacon is installed exactly ONCE, in `beforeAll`. `installErrorBeacon`
 * adds a real `window` listener and guards re-entry with a module-level flag,
 * so a `jest.resetModules()` per test yields a fresh module that installs a
 * SECOND listener on the same jsdom window — after which one dispatched error
 * is reported once per test that has run so far.
 */
import {
  installErrorBeacon,
  isHydrationMismatch,
  isInjectedThirdPartyFrame,
} from './error-beacon'

const PAGE = 'https://aglyn.com/pricing'

/** Frames pointing at real chunk files — what our own code always produces. */
const OWN_STACK = [
  'Error: boom',
  '    at rJ (https://aglyn.com/_next/static/immutable/chunks/3cuw.js:31:45769)',
  '    at id (https://aglyn.com/_next/static/immutable/chunks/3cuw.js:31:97017)',
].join('\n')

/**
 * The Meta in-app browser's native bridge, captured verbatim out of
 * `client-errors` on 2026-09-02. WebKit format, and every frame is the
 * document because the webview evaluated it inline.
 */
const INJECTED_STACK = [
  'sendDataToNative@https://aglyn.com/pricing:1:1325',
  'sendPageHideMessage@https://aglyn.com/pricing:1:4139',
  '@https://aglyn.com/pricing:1:6257',
].join('\n')

describe('isInjectedThirdPartyFrame (AGL-2523)', () => {
  it('is TRUE only when every frame is the document itself', () => {
    expect(isInjectedThirdPartyFrame(INJECTED_STACK, PAGE)).toBe(true)
  })

  it('is FALSE for a stack with any frame in a script we served', () => {
    expect(isInjectedThirdPartyFrame(OWN_STACK, PAGE)).toBe(false)
  })

  it('is FALSE once one of our frames joins injected ones', () => {
    // Injected code calling into ours is OUR bug the moment one of our frames
    // is on the stack — so the quantifier is `every`, not `some`.
    const mixed = `${INJECTED_STACK}\n    at rJ (https://aglyn.com/_next/static/chunks/a.js:1:2)`
    expect(isInjectedThirdPartyFrame(mixed, PAGE)).toBe(false)
  })

  it('is FALSE for a CDN frame — a self-hosted deploy must still report', () => {
    // The rule compares against the DOCUMENT, never against `/_next/static/`.
    // An asset-path rule would delete every error from an operator serving
    // assets off another origin.
    const cdn = 'Error: boom\n    at f (https://cdn.example.com/app.js:1:2)'
    expect(isInjectedThirdPartyFrame(cdn, PAGE)).toBe(false)
  })

  it('is FALSE when no frame parses — that is not evidence of anything', () => {
    expect(isInjectedThirdPartyFrame('Error: boom', PAGE)).toBe(false)
    expect(isInjectedThirdPartyFrame('', PAGE)).toBe(false)
  })

  it('reads V8 frames as well as the WebKit ones it was found on', () => {
    const v8 = [
      'Error: x',
      '    at fn (https://aglyn.com/pricing:1:2)',
      '    at https://aglyn.com/pricing:3:4',
    ].join('\n')
    expect(isInjectedThirdPartyFrame(v8, PAGE)).toBe(true)
  })

  it('ignores the query string, which the document URL never carries', () => {
    // Frames are compared origin+pathname, like every other URL this beacon
    // handles, so a webview frame carrying `?fbclid=…` still matches.
    const q = 'f@https://aglyn.com/pricing?fbclid=abc:1:2'
    expect(isInjectedThirdPartyFrame(q, PAGE)).toBe(true)
  })
})

describe('isHydrationMismatch (AGL-2523)', () => {
  it('labels the whole minified hydration family', () => {
    expect(isHydrationMismatch('Minified React error #418; visit …')).toBe(true)
    expect(isHydrationMismatch('Minified React error #423; visit …')).toBe(true)
    expect(isHydrationMismatch('Minified React error #425; visit …')).toBe(true)
  })

  it('does NOT label a render loop, which is ours', () => {
    // #185 is "maximum update depth exceeded", and it was in the same measured
    // window as the eight #418s. Labelling it would stop it paging.
    expect(isHydrationMismatch('Minified React error #185; visit …')).toBe(false)
  })

  it('does not match a longer error code by prefix', () => {
    expect(isHydrationMismatch('Minified React error #4180; visit …')).toBe(false)
  })

  it('labels the unminified wording, for a non-production build', () => {
    expect(
      isHydrationMismatch(
        "Hydration failed because the server rendered HTML didn't match the client.",
      ),
    ).toBe(true)
    expect(isHydrationMismatch('Text content does not match server-rendered HTML')).toBe(
      true,
    )
  })

  it('leaves an ordinary error alone', () => {
    expect(isHydrationMismatch('Cannot read properties of undefined')).toBe(false)
  })
})

describe('the installed beacon applies both rules end to end (AGL-2523)', () => {
  let beacon: jest.Mock

  beforeAll(() => {
    beacon = jest.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
    jest.useFakeTimers()
    // Well above the number of events this file reports, so the per-page cap
    // cannot silently swallow a later case.
    installErrorBeacon({ maxPerPage: 100 })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  beforeEach(() => {
    beacon.mockClear()
  })

  /**
   * Fire a real `error` event through the installed window handler. Each
   * caller passes a DISTINCT message: the beacon dedupes on message + first
   * stack line for the life of the pageview, and these tests share one.
   */
  function throwInPage(message: string, stack?: string): void {
    const error = new Error(message)
    error.stack = stack
    window.dispatchEvent(
      new ErrorEvent('error', { error, message, filename: PAGE }),
    )
    jest.runOnlyPendingTimers()
  }

  function reported(): Array<Record<string, unknown>> {
    return beacon.mock.calls.flatMap(
      (call) => JSON.parse(call[1] as string).events as Array<Record<string, unknown>>,
    )
  }

  it('reports an error thrown by a script we served', () => {
    throwInPage('served-script boom', OWN_STACK)
    const events = reported()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'error', message: 'served-script boom' })
  })

  it('DROPS a webview that evaluated its own code into the page', () => {
    throwInPage('null is not an object', INJECTED_STACK)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('still drops the opaque cross-origin Script error.', () => {
    throwInPage('Script error.', OWN_STACK)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('REPORTS a hydration error, marked — a rate must still catch a regression', () => {
    // Dropping it would hide a real render divergence, which is an expensive
    // bug. The mark is what lets the per-entry policy stop paging while a
    // rate-based policy keeps watching.
    throwInPage(
      'Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]=',
      OWN_STACK,
    )
    const events = reported()
    expect(events).toHaveLength(1)
    expect(events[0]['kind']).toBe('hydration')
  })

  it('reports a stackless error rather than guessing about it', () => {
    throwInPage('stackless boom', undefined)
    expect(reported()).toHaveLength(1)
  })
})
