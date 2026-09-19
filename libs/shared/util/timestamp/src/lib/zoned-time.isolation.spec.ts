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
 * `zoned-time` must not reach the Firestore client, for the reason
 * `timestamp-json.isolation.spec.ts` gives: the package root extends the
 * SDK's `Timestamp`, and the booking model that reads a weekday through this
 * module is client code on published pages.
 *
 * Its own file, importing nothing, so `firebase` cannot already be in the
 * registry when the check runs — the precondition says so out loud.
 */
describe('zoned-time module graph', () => {
  const firebaseModules = (): string[] =>
    Object.keys(require.cache).filter((path) => path.includes('firebase'))

  it('does not load the Firestore client', () => {
    expect(firebaseModules()).toEqual([])

    require('./zoned-time')

    expect(firebaseModules()).toEqual([])
  })
})
