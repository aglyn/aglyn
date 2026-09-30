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
  anonymousScriptFrameCount,
  AUTH_DESYNC_KIND,
  BEACON_STACK_TRACE_LIMIT,
  CHUNK_LOAD_KIND,
  describeRejectionReason,
  installErrorBeacon,
  isBenignBrowserNotice,
  isHydrationMismatch,
  isInjectedThirdPartyFrame,
  raiseStackTraceLimit,
  recoveredErrorKind,
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

/**
 * The same bridge in the Android webview, captured verbatim out of
 * `client-errors` on 2026-09-10 (AGL-2786). V8 format, and every frame is
 * under the webview's own `iabjs://` scheme rather than the document — the
 * shape the document comparison alone cannot see.
 */
const ANDROID_INJECTED_STACK = [
  'Error: Error invoking postMessage: Java object is gone',
  '    at sendDataToNative (iabjs://navigation_performance_logger_android:1:10632)',
  '    at sendBeforeUnloadMessage (iabjs://navigation_performance_logger_android:1:14286)',
  '    at iabjs://navigation_performance_logger_android:1:19687',
].join('\n')

/** One frame in a script we served. */
const OWN_FRAME =
  '    at rJ (https://aglyn.com/_next/static/immutable/chunks/3cuw.js:31:45769)'

/**
 * An automation driver's `evaluate` on the sign-up page, captured verbatim out
 * of `client-errors` on 2026-09-29 (AGL-3423). The page's CSP refused the
 * driver's own `eval`; no script we served is on the stack.
 */
const AUTOMATION_EVAL_STACK = [
  "EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self' https: blob: 'nonce-4cf1186565b04e22ae1a665908a4b07d'\".",
  '',
  '    at eval (<anonymous>)',
  '    at predicate (eval at evaluate (:234:30), <anonymous>:11:37)',
  '    at next (eval at evaluate (:234:30), <anonymous>:32:31)',
].join('\n')

/**
 * A devtools snippet clicking a button that was not there, captured verbatim
 * out of `client-errors` on 2026-09-23 from aglyn.com/solutions/agencies.
 */
const SNIPPET_STACK = [
  "TypeError: Cannot read properties of null (reading 'click')",
  '    at <anonymous>:1:54',
  '    at <anonymous>:1:64',
].join('\n')

/**
 * Firebase's cross-pool assert, captured verbatim out of `client-errors` on
 * 2026-09-29 from app.aglyn.com/signin. Every frame is a chunk we served.
 */
const TENANT_MISMATCH_STACK = [
  'FirebaseError: Firebase: Error (auth/tenant-id-mismatch).',
  '    at m (https://app.aglyn.com/_next/static/immutable/chunks/2v7qrpjkelxiy.js:22:8332)',
  '    at _ (https://app.aglyn.com/_next/static/immutable/chunks/2v7qrpjkelxiy.js:22:8404)',
  '    at ev._updateCurrentUser (https://app.aglyn.com/_next/static/immutable/chunks/2v7qrpjkelxiy.js:22:37216)',
  '    at ev._onStorageEvent (https://app.aglyn.com/_next/static/immutable/chunks/2v7qrpjkelxiy.js:22:34961)',
].join('\n')

/** A tab open across a deploy, captured verbatim on aglyn.com 2026-09-29. */
const CHUNK_LOAD_STACK = [
  'ChunkLoadError: Failed to load chunk /_next/static/immutable/chunks/40dbnln1sqm49.js from module 964893',
  '    at https://aglyn.com/_next/static/immutable/chunks/turbopack-2_94opkch9l8s.js:1:5089',
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

describe('isInjectedThirdPartyFrame — foreign schemes (AGL-2786)', () => {
  it('is TRUE when every frame is under the Android webview scheme', () => {
    expect(isInjectedThirdPartyFrame(ANDROID_INJECTED_STACK, PAGE)).toBe(true)
  })

  it('is FALSE once one of our frames joins them', () => {
    expect(
      isInjectedThirdPartyFrame(`${ANDROID_INJECTED_STACK}\n${OWN_FRAME}`, PAGE),
    ).toBe(false)
  })

  it('is TRUE for an extension content script', () => {
    const extension =
      'TypeError: x is undefined\n    at run (chrome-extension://abcdefghijklmnop/content.js:4:17)'
    expect(isInjectedThirdPartyFrame(extension, PAGE)).toBe(true)
  })
})

describe('isInjectedThirdPartyFrame — scripts with no URL (AGL-3423)', () => {
  it('is TRUE for an automation driver evaluate, in V8 format', () => {
    expect(isInjectedThirdPartyFrame(AUTOMATION_EVAL_STACK, PAGE)).toBe(true)
  })

  it('is TRUE for a devtools snippet', () => {
    expect(isInjectedThirdPartyFrame(SNIPPET_STACK, PAGE)).toBe(true)
  })

  it('is TRUE for the Firefox devtools console, in the fn@location format', () => {
    const firefox = [
      'predicate@debugger eval code:11:37',
      'next@debugger eval code:32:31',
    ].join('\n')
    expect(isInjectedThirdPartyFrame(firefox, PAGE)).toBe(true)
  })

  it('is TRUE when anonymous frames mix with the document and a foreign scheme', () => {
    const mixed = [
      'Error: x',
      '    at <anonymous>:1:54',
      '    at https://aglyn.com/pricing:3:4',
      '    at run (chrome-extension://abcdefghijklmnop/content.js:4:17)',
    ].join('\n')
    expect(isInjectedThirdPartyFrame(mixed, PAGE)).toBe(true)
  })

  it('is FALSE once one of our frames joins anonymous ones', () => {
    // `every`, never `some`: a snippet that calls into our code and trips on
    // it has found OUR bug.
    expect(isInjectedThirdPartyFrame(`${SNIPPET_STACK}\n${OWN_FRAME}`, PAGE)).toBe(
      false,
    )
    expect(
      isInjectedThirdPartyFrame(`${AUTOMATION_EVAL_STACK}\n${OWN_FRAME}`, PAGE),
    ).toBe(false)
  })

  it('is FALSE for code OUR script evaluated, since the eval origin is ours', () => {
    // The marketing plugin's `runJs` step runs `new Function(code)` from a
    // chunk; V8 names that chunk inside the frame's eval origin.
    const ownEval = [
      'ReferenceError: foo is not defined',
      '    at eval (eval at runStep (https://aglyn.com/_next/static/chunks/site.js:1:200), <anonymous>:1:1)',
    ].join('\n')
    expect(isInjectedThirdPartyFrame(ownEval, PAGE)).toBe(false)
  })

  it('is FALSE for a builtin, which V8 prints as a bare (<anonymous>)', () => {
    // Builtins are called by whoever called them, including us, so a stack
    // made only of them is no evidence either way.
    const builtin = [
      'SyntaxError: Unexpected token < in JSON at position 0',
      '    at JSON.parse (<anonymous>)',
    ].join('\n')
    expect(isInjectedThirdPartyFrame(builtin, PAGE)).toBe(false)
  })

  it('is FALSE for an empty frame list, which is no evidence of anything', () => {
    expect(isInjectedThirdPartyFrame('TypeError: x is null', PAGE)).toBe(false)
    expect(isInjectedThirdPartyFrame('', PAGE)).toBe(false)
  })
})

describe('anonymousScriptFrameCount (AGL-3423)', () => {
  it('counts frames, not mentions in the message line', () => {
    expect(anonymousScriptFrameCount(AUTOMATION_EVAL_STACK)).toBe(2)
    expect(anonymousScriptFrameCount(SNIPPET_STACK)).toBe(2)
    expect(anonymousScriptFrameCount('Error: parse failed at <anonymous>:1:2')).toBe(0)
  })

  it('counts nothing on a stack of ours', () => {
    expect(anonymousScriptFrameCount(OWN_STACK)).toBe(0)
    expect(anonymousScriptFrameCount(TENANT_MISMATCH_STACK)).toBe(0)
  })
})

describe('isBenignBrowserNotice (AGL-3423)', () => {
  it('knows the ResizeObserver notice in both wordings', () => {
    expect(
      isBenignBrowserNotice('ResizeObserver loop completed with undelivered notifications.'),
    ).toBe(true)
    expect(isBenignBrowserNotice('ResizeObserver loop limit exceeded')).toBe(true)
    expect(isBenignBrowserNotice('Uncaught ResizeObserver loop limit exceeded')).toBe(true)
  })

  it('leaves an error that merely mentions a ResizeObserver alone', () => {
    expect(
      isBenignBrowserNotice(
        "Cannot read properties of null (reading 'observe') in ResizeObserver loop",
      ),
    ).toBe(false)
    expect(isBenignBrowserNotice('ResizeObserver is not defined')).toBe(false)
  })
})

describe('recoveredErrorKind (AGL-3423)', () => {
  it('labels the cross-pool desync by code, or by message when that is all it has', () => {
    const firebase = Object.assign(
      new Error('Firebase: Error (auth/tenant-id-mismatch).'),
      { code: 'auth/tenant-id-mismatch' },
    )
    expect(recoveredErrorKind(firebase)).toBe(AUTH_DESYNC_KIND)
    expect(
      recoveredErrorKind({ message: 'Firebase: Error (auth/tenant-id-mismatch).' }),
    ).toBe(AUTH_DESYNC_KIND)
  })

  it('labels a stale-build chunk failure', () => {
    const chunk = Object.assign(new Error('Failed to load chunk /_next/x.js'), {
      name: 'ChunkLoadError',
    })
    expect(recoveredErrorKind(chunk)).toBe(CHUNK_LOAD_KIND)
    expect(
      recoveredErrorKind(
        new TypeError('Failed to fetch dynamically imported module: https://a/b.js'),
      ),
    ).toBe(CHUNK_LOAD_KIND)
  })

  it('labels nothing else, so every other auth error still pages', () => {
    expect(recoveredErrorKind({ code: 'auth/user-token-expired' })).toBeUndefined()
    expect(recoveredErrorKind(new Error('Minified React error #185'))).toBeUndefined()
    expect(recoveredErrorKind(null)).toBeUndefined()
    expect(recoveredErrorKind('auth/tenant-id-mismatch')).toBeUndefined()
  })

  it('never throws, whatever the error does', () => {
    const hostile = {
      get code(): string {
        throw new Error('nope')
      },
    }
    expect(recoveredErrorKind(hostile)).toBeUndefined()
  })

  it('names kinds short enough to survive the server clamp', () => {
    // `parseClientErrorEvents` keeps 32 characters of `kind`.
    expect(AUTH_DESYNC_KIND).toBe('auth-desync')
    expect(CHUNK_LOAD_KIND).toBe('chunk-load')
    expect(AUTH_DESYNC_KIND.length).toBeLessThanOrEqual(32)
    expect(CHUNK_LOAD_KIND.length).toBeLessThanOrEqual(32)
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
  const engine = Error as ErrorConstructor & { stackTraceLimit: number }
  const engineLimit = engine.stackTraceLimit

  beforeAll(() => {
    // V8's own default, which the runner may have raised already.
    engine.stackTraceLimit = 10
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
    engine.stackTraceLimit = engineLimit
  })

  beforeEach(() => {
    beacon.mockClear()
  })

  it('keeps enough frames to reach past a form library to our code (AGL-3423)', () => {
    expect(engine.stackTraceLimit).toBe(BEACON_STACK_TRACE_LIMIT)
    const depth = (n: number): Error => (n ? depth(n - 1) : new Error('deep'))
    const frames = String(depth(40).stack).split('\n').filter((line) => /^\s+at /.test(line))
    expect(frames.length).toBeGreaterThan(40)
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

  /** jsdom has no PromiseRejectionEvent; dispatch the shape the browser does. */
  function rejectInPage(reason: unknown): void {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = reason
    window.dispatchEvent(event)
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

  it('DROPS the Android webview bridge, every frame under iabjs:// (AGL-2786)', () => {
    throwInPage('Error invoking postMessage: Java object is gone', ANDROID_INJECTED_STACK)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('REPORTS our error when the bridge is on the same stack (AGL-2786)', () => {
    throwInPage('bridge called into ours', `${ANDROID_INJECTED_STACK}\n${OWN_FRAME}`)
    expect(reported()).toHaveLength(1)
  })

  it('DROPS a devtools snippet, every frame anonymous (AGL-3423)', () => {
    throwInPage("Cannot read properties of null (reading 'click')", SNIPPET_STACK)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('REPORTS a snippet that tripped on our code (AGL-3423)', () => {
    throwInPage('snippet called into ours', `${SNIPPET_STACK}\n${OWN_FRAME}`)
    expect(reported()).toHaveLength(1)
  })

  it('DROPS the ResizeObserver notice, which carries no error at all (AGL-3423)', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
      }),
    )
    jest.runOnlyPendingTimers()
    expect(beacon).not.toHaveBeenCalled()
  })

  it('LABELS a chunk the origin no longer serves chunk-load (AGL-3423)', () => {
    const error = Object.assign(
      new Error(
        'Failed to load chunk /_next/static/immutable/chunks/40dbnln1sqm49.js from module 964893',
      ),
      { name: 'ChunkLoadError' },
    )
    error.stack = CHUNK_LOAD_STACK
    window.dispatchEvent(
      new ErrorEvent('error', { error, message: error.message, filename: PAGE }),
    )
    jest.runOnlyPendingTimers()
    const events = reported()
    expect(events).toHaveLength(1)
    expect(events[0]['kind']).toBe('chunk-load')
  })

  it('LABELS the cross-pool rejection auth-desync, and still reports it (AGL-3423)', () => {
    // AGL-3280 recovers the tab and deliberately leaves the rejection
    // unhandled so it is seen. It must arrive, under its own kind.
    const error = Object.assign(
      new Error('Firebase: Error (auth/tenant-id-mismatch).'),
      { code: 'auth/tenant-id-mismatch' },
    )
    error.name = 'FirebaseError'
    error.stack = TENANT_MISMATCH_STACK
    rejectInPage(error)
    const events = reported()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'auth-desync',
      message: 'Firebase: Error (auth/tenant-id-mismatch).',
    })
  })

  it('keeps every other rejection unhandledrejection (AGL-3423)', () => {
    const error = new Error('a save of ours was refused')
    error.stack = `Error: a save of ours was refused\n${OWN_FRAME}`
    rejectInPage(error)
    const events = reported()
    expect(events).toHaveLength(1)
    expect(events[0]['kind']).toBe('unhandledrejection')
  })

  it('DROPS a rejection an automation driver raised (AGL-3423)', () => {
    const error = new Error('Refused to evaluate a string as JavaScript')
    error.name = 'EvalError'
    error.stack = AUTOMATION_EVAL_STACK
    rejectInPage(error)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('REPORTS a stackless rejection rather than guessing about it (AGL-3423)', () => {
    rejectInPage({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    })
    expect(reported()).toHaveLength(1)
  })

  describe('an import() of a dropped chunk that no boundary saw (AGL-3423)', () => {
    function chunkRejection(label: string): Error {
      const error = Object.assign(
        new Error(`Failed to load chunk /_next/static/immutable/chunks/${label}.js`),
        { name: 'ChunkLoadError' },
      )
      error.stack = CHUNK_LOAD_STACK
      return error
    }

    function setVisibility(state: DocumentVisibilityState | undefined): void {
      if (state === undefined) {
        delete (document as { visibilityState?: unknown }).visibilityState
        return
      }
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      })
    }

    beforeEach(() => {
      window.sessionStorage.clear()
      // jsdom logs the reload it cannot perform.
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      // Fire any reload still pending, so no case leaves one for the next.
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      setVisibility(undefined)
      jest.restoreAllMocks()
    })

    it('RECOVERS the tab and does not report it', () => {
      rejectInPage(chunkRejection('recovered'))

      expect(reported()).toHaveLength(0)
      expect(window.sessionStorage.getItem('aglyn.staleBuildReloaded')).toBeTruthy()
    })

    it('still REPORTS it as chunk-load once the recovery is spent', () => {
      window.sessionStorage.setItem('aglyn.staleBuildReloaded', String(Date.now()))

      rejectInPage(chunkRejection('spent'))

      const events = reported()
      expect(events).toHaveLength(1)
      expect(events[0]['kind']).toBe(CHUNK_LOAD_KIND)
    })
  })

  it('judges the WHOLE stack, so our frame past the clamp still keeps it (AGL-2786)', () => {
    const bridgeFrames = Array.from(
      { length: 150 },
      (_, i) => `    at f${i} (iabjs://navigation_performance_logger_android:1:${i})`,
    )
    const long = [ANDROID_INJECTED_STACK, ...bridgeFrames, OWN_FRAME].join('\n')
    // Anti-vacuity: our frame must really sit beyond what the report carries.
    expect(long.indexOf(OWN_FRAME)).toBeGreaterThan(8_192)
    throwInPage('long bridge stack', long)
    expect(reported()).toHaveLength(1)
  })
})

describe('raiseStackTraceLimit (AGL-3423)', () => {
  const engine = Error as ErrorConstructor & { stackTraceLimit?: number }
  let saved: number | undefined

  beforeEach(() => {
    saved = engine.stackTraceLimit
  })

  afterEach(() => {
    engine.stackTraceLimit = saved
  })

  it('raises the engine limit', () => {
    engine.stackTraceLimit = 10
    raiseStackTraceLimit(50)
    expect(engine.stackTraceLimit).toBe(50)
  })

  it('never lowers a limit that is already higher', () => {
    engine.stackTraceLimit = 200
    raiseStackTraceLimit(50)
    expect(engine.stackTraceLimit).toBe(200)
  })

  it('hands an engine with no limit nothing to ignore', () => {
    delete engine.stackTraceLimit
    raiseStackTraceLimit(50)
    expect('stackTraceLimit' in Error).toBe(false)
  })
})

/**
 * A rejection is only sometimes an `Error` (AGL-3279).
 *
 * The report that prompted this carried the literal words "Unhandled promise
 * rejection" and nothing else — no message, no stack, no code — which names
 * the handler rather than the failure and cannot be acted on.
 */
describe('describeRejectionReason', () => {
  it('prefers the error own message', () => {
    expect(describeRejectionReason(new Error('the save was refused'))).toBe(
      'the save was refused',
    )
  })

  it('takes a string rejection as itself', () => {
    expect(describeRejectionReason('not signed in')).toBe('not signed in')
  })

  it('assembles the code/message shape every API rejection takes', () => {
    // A Firebase error, an aborted fetch and a failed response all land here.
    expect(
      describeRejectionReason({
        code: 'auth/tenant-id-mismatch',
        message: 'Firebase: Error (auth/tenant-id-mismatch).',
      }),
    ).toBe('auth/tenant-id-mismatch: Firebase: Error (auth/tenant-id-mismatch).')
    expect(describeRejectionReason({ name: 'AbortError' })).toBe('AbortError')
    expect(describeRejectionReason({ status: 503, statusText: 'Unavailable' })).toBe(
      'Unavailable',
    )
  })

  it('falls back to a toString that says something', () => {
    expect(
      describeRejectionReason({ toString: () => 'CanvasCommand(paste) failed' }),
    ).toBe('CanvasCommand(paste) failed')
  })

  it('names the shape when the value says nothing at all', () => {
    // Still not much — but it says WHAT rejected, which the old default did
    // not, and that is the difference between a report and a tally mark.
    expect(describeRejectionReason({ step: 3, surface: 'besigner' })).toBe(
      'Unhandled promise rejection (object with step, surface)',
    )
    expect(describeRejectionReason({})).toBe(
      'Unhandled promise rejection (empty object)',
    )
    expect(describeRejectionReason(undefined)).toBe(
      'Unhandled promise rejection (undefined)',
    )
    expect(describeRejectionReason(false)).toBe(
      'Unhandled promise rejection (boolean: false)',
    )
  })

  it('never throws, whatever the reason does', () => {
    const hostile = {
      get name(): string {
        throw new Error('nope')
      },
    }

    expect(describeRejectionReason(hostile)).toBe(
      'Unhandled promise rejection (undescribable)',
    )
  })
})
