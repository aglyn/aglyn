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
 * The browser twin keys the SAME document the server writes (AGL-2612).
 *
 * The whole value of `personKeyInBrowser` is that a console surface can
 * address `hosts/{hostId}/leads/{personKey}` without the server; a twin that
 * drifted by one byte would look every lead up under an id nothing wrote.
 * So the assertion is against the Node derivation itself, not a pasted hex.
 */

import { personKey } from './person-key'
import { personKeyInBrowser } from './person-key-web'

describe('personKeyInBrowser', () => {
  it('derives exactly the key the server derivation does', async () => {
    for (const email of ['ada@example.com', '  Ada@Example.COM ', 'x@y.io']) {
      expect(await personKeyInBrowser(email)).toBe(personKey(email))
    }
  })

  it('refuses what the server derivation refuses, with no best guess', async () => {
    for (const input of ['', 'not an address', null, undefined, 42]) {
      expect(personKey(input)).toBeNull()
      expect(await personKeyInBrowser(input)).toBeNull()
    }
  })
})
