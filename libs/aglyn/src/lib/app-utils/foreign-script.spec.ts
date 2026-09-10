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
 * The one list of schemes no deployment of ours serves, and the stack rule
 * built on it (AGL-2786).
 *
 * Every positive case sits beside the first-party frame that must flip it,
 * because a rule that answered "foreign" for everything would pass the
 * positive half and silence every error we have.
 */
import {
  FOREIGN_SCRIPT_SCHEMES,
  isForeignScriptStack,
  isForeignScriptUrl,
  stackFrameUrls,
} from './foreign-script'

/** Captured verbatim out of `client-errors` on 2026-09-10. */
const ANDROID_INJECTED_STACK = [
  'Error: Error invoking postMessage: Java object is gone',
  '    at sendDataToNative (iabjs://navigation_performance_logger_android:1:10632)',
  '    at sendBeforeUnloadMessage (iabjs://navigation_performance_logger_android:1:14286)',
  '    at iabjs://navigation_performance_logger_android:1:19687',
].join('\n')

/** One frame in a script we served. */
const OWN_FRAME =
  '    at rJ (https://aglyn.com/_next/static/immutable/chunks/3cuw.js:31:45769)'

describe('isForeignScriptStack (AGL-2786)', () => {
  it('is TRUE for the Meta Android in-app browser bridge', () => {
    expect(isForeignScriptStack(ANDROID_INJECTED_STACK)).toBe(true)
  })

  it('is FALSE once a frame from a script we served joins it', () => {
    expect(isForeignScriptStack(`${ANDROID_INJECTED_STACK}\n${OWN_FRAME}`)).toBe(false)
  })

  it('is FALSE for a CDN frame — a self-hosted deployment must still report', () => {
    const cdn = `${ANDROID_INJECTED_STACK}\n    at f (https://cdn.example.com/app.js:1:2)`
    expect(isForeignScriptStack(cdn)).toBe(false)
  })

  it('treats the DOCUMENT as ours — without the page URL it cannot tell', () => {
    // Our own inline bootstrap throws with document frames too, and a handled
    // report of one must survive anything that reads it without the page.
    expect(isForeignScriptStack('boot@https://aglyn.com/pricing:1:1325')).toBe(false)
  })

  it('is FALSE for a worker running from a blob: URL of our own origin', () => {
    expect(
      isForeignScriptStack('Error: x\n    at w (blob:https://app.aglyn.com/0b9e-4d2a:1:2)'),
    ).toBe(false)
  })

  it('is FALSE when no frame parses — that is not evidence of anything', () => {
    expect(isForeignScriptStack('Error: Error invoking postMessage: Java object is gone')).toBe(
      false,
    )
    expect(isForeignScriptStack('')).toBe(false)
  })

  it.each([
    [
      'a Chrome extension',
      'TypeError: x is undefined\n    at run (chrome-extension://abcdefghijklmnop/content.js:4:17)',
    ],
    [
      'a Firefox extension',
      'run@moz-extension://1b2c3d4e-0000-4000-8000-000000000000/content.js:4:17',
    ],
    ['a Safari web extension', 'run@safari-web-extension://ABCD-1234/content.js:4:17'],
    ['Safari masking an extension', 'run@webkit-masked-url://hidden/:4:17'],
  ])('is TRUE for %s', (_label, stack) => {
    expect(isForeignScriptStack(stack)).toBe(true)
  })
})

describe('stackFrameUrls (AGL-2786)', () => {
  it('parses a frame under a scheme it has no list entry for', () => {
    // An unreadable scheme made the whole stack "no frames", which every
    // caller keeps — the gap an `iabjs://` stack walked through.
    expect(stackFrameUrls('    at f (x-unknown-webview://bridge:1:2)')).toEqual([
      'x-unknown-webview://bridge',
    ])
  })

  it('still reads V8 and WebKit web frames, query string included', () => {
    const stack = [
      'Error: x',
      '    at fn (https://aglyn.com/_next/static/chunks/a.js:1:2)',
      '    at async https://aglyn.com/_next/static/chunks/b.js:3:4',
      'g@https://aglyn.com/pricing?fbclid=abc:5:6',
    ].join('\n')
    expect(stackFrameUrls(stack)).toEqual([
      'https://aglyn.com/_next/static/chunks/a.js',
      'https://aglyn.com/_next/static/chunks/b.js',
      'https://aglyn.com/pricing?fbclid=abc',
    ])
  })

  it('does not read a URL out of a message that carries no line and column', () => {
    expect(
      stackFrameUrls('Error: visit https://react.dev/errors/418?args[]=text for details'),
    ).toEqual([])
  })
})

describe('isForeignScriptUrl (AGL-2786)', () => {
  it('matches the scheme prefix only, whatever its case', () => {
    expect(isForeignScriptUrl('IABJS://navigation_performance_logger_android')).toBe(true)
    // A path that merely mentions a scheme is still our URL.
    expect(isForeignScriptUrl('https://aglyn.com/docs/chrome-extension:')).toBe(false)
  })

  it('never lists a scheme a deployment of ours serves from', () => {
    for (const scheme of ['http:', 'https:', 'blob:', 'data:', 'file:']) {
      expect([scheme, FOREIGN_SCRIPT_SCHEMES.includes(scheme)]).toEqual([scheme, false])
    }
  })
})
