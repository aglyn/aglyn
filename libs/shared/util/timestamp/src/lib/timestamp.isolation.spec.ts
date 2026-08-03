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
 * `./timestamp` must not reach the Firestore client (AGL-1207).
 *
 * It used to `extend` the SDK's `Timestamp`, which is a hard runtime
 * dependency — not type-only, not tree-shakeable. Every module graph that
 * reached this file loaded the whole Firestore client, and any spec that
 * partially mocked `firebase/firestore` failed at IMPORT time rather than
 * anywhere useful. AGL-1151 routed two log lines around it via
 * `timestamp-json`; this file is the class itself, so the guard belongs here
 * too.
 *
 * Same shape as `timestamp-json.isolation.spec.ts`, and for the same reason:
 * it lives in its OWN spec file importing nothing else. A version of this
 * check sitting beside the behavioural tests would be VACUOUS — those import
 * `./timestamp` at the top, so `firebase` would already be in `require.cache`
 * before the assertion ran, and it would pass just as happily if the class
 * went back to extending the SDK's.
 *
 * The precondition is what stops that: if anything ever pulls `firebase` into
 * this file's registry first, the test fails loudly instead of quietly
 * measuring nothing.
 */
describe('timestamp module graph', () => {
  const firebaseModules = (): string[] =>
    Object.keys(require.cache).filter((path) => path.includes('firebase'))

  it('does not load the Firestore client', () => {
    // Precondition, NOT a formality — this is the assertion that makes the
    // real one meaningful.
    expect(firebaseModules()).toEqual([])

    require('./timestamp')

    expect(firebaseModules()).toEqual([])
  })

  it('still produces a value Firestore will accept', () => {
    // The class extends `Date` precisely so the SDK's `instanceof Date` check
    // passes and it serialises from the internal time slot. A regression to a
    // plain custom class would be rejected at write time with
    // `invalid-argument: Unsupported field value` — verified on the emulator —
    // so pin the property that prevents it.
    const { Timestamp } = require('./timestamp')
    const value = Timestamp.fromMillis(1767322445000)

    expect(value instanceof Date).toBe(true)
    // Firestore reads the internal slot via getTime(), NOT valueOf() — which
    // this class overrides to return a padded string for ordering.
    expect(value.getTime()).toBe(1767322445000)
    expect(typeof value.valueOf()).toBe('string')
  })
})
