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
 * `timestamp-json` must not reach the Firestore client (AGL-1151). That is the
 * entire reason it exists: `./timestamp` extends the SDK's `Timestamp`, which
 * is a hard runtime dependency, and importing it put the whole Firestore client
 * in every tenant site's eagerly-loaded page chunk.
 *
 * This lives in its OWN spec file, importing nothing else, on purpose. The
 * first version of this check sat beside the behavioural tests — which import
 * `./timestamp` at the top — so `firebase` was already in `require.cache`
 * before the check ran, and it passed just as happily when `timestamp-json`
 * imported the Firestore-backed class. Verified vacuous by making it import the
 * class and watching it stay green.
 *
 * The precondition below is what stops that recurring: if anything ever pulls
 * `firebase` into this file's registry first, the test fails loudly instead of
 * quietly measuring nothing.
 */
describe('timestamp-json module graph', () => {
  const firebaseModules = (): string[] =>
    Object.keys(require.cache).filter((path) => path.includes('firebase'))

  it('does not load the Firestore client', () => {
    // Precondition, NOT a formality — this is the assertion that makes the
    // real one meaningful.
    expect(firebaseModules()).toEqual([])

    require('./timestamp-json')

    expect(firebaseModules()).toEqual([])
  })
})
