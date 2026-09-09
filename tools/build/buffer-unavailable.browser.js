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
 * `buffer` as the BROWSER sees it: a name to compare against, not 22 KB of
 * Node's byte type reimplemented for a page that has `Uint8Array` (AGL-2706).
 *
 * A bare `Buffer` identifier is a free variable, and Turbopack resolves a free
 * variable by importing the `buffer` module — so one mention of the name
 * anywhere in the client graph ships the whole polyfill. `9448ecc0c` removed
 * the three first-party mentions by reaching through `globalThis`. That trick
 * cannot reach a vendored dependency, and one mention survives it: the browser
 * ESM of `@firebase/firestore` asserts
 *
 *     void 0 === t || t instanceof Buffer || t instanceof Uint8Array
 *
 * on a watch stream's resume token, in the branch taken when the serializer is
 * NOT emitting proto3 JSON. A browser's WebChannel transport always is, so the
 * comparison never runs there — but a bundler cannot prove that, and the
 * polyfill was the price of the doubt.
 *
 * `instanceof` needs only a constructor to point at, so that is all this is.
 * The class refuses construction, `isBuffer` answers the truth for a browser
 * rather than throwing — nothing there IS a Node Buffer — and every byte-level
 * entry point throws by name, so client code that genuinely wanted Node's
 * Buffer fails loudly at the call instead of quietly carrying a polyfill.
 *
 * Only the `browser` condition is aliased, so Node keeps the real module:
 * every server route, the cloud functions and the whole test suite are
 * untouched. The one place a browser could still have a real `Buffer` is a
 * host that defined the global itself, and that one is preferred if present.
 */

class BrowserBufferUnavailable extends Uint8Array {
  constructor() {
    super(0)
    throw new Error(
      'Buffer is not bundled for the browser. Use Uint8Array, TextEncoder or ' +
        'the base64 helpers in @aglyn/aglyn/app-utils. See ' +
        'tools/build/buffer-unavailable.browser.js.',
    )
  }

  /** Nothing in a browser is a Node Buffer, which is an answer, not a failure. */
  static isBuffer() {
    return false
  }

  static from() {
    return new BrowserBufferUnavailable()
  }

  static alloc() {
    return new BrowserBufferUnavailable()
  }

  static allocUnsafe() {
    return new BrowserBufferUnavailable()
  }

  static concat() {
    return new BrowserBufferUnavailable()
  }

  static byteLength() {
    return new BrowserBufferUnavailable()
  }
}

export const Buffer = globalThis.Buffer ?? BrowserBufferUnavailable

export default { Buffer }
