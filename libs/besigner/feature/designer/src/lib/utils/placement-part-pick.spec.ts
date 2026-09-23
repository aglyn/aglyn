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

import { resolvePickedPart } from './placement-part-pick'

describe('resolvePickedPart (AGL-3288)', () => {
  const canvas = (nodeId: string, key: string, seq: number) => ({
    nodeId,
    key,
    seq,
  })

  it('starts on the whole placement', () => {
    expect(
      resolvePickedPart('a', { key: 'root', seq: 0 }, canvas('b', 'x', 0)),
    ).toBe('root')
  })

  it('follows a canvas click on this placement newer than the menu', () => {
    expect(
      resolvePickedPart(
        'a',
        { nodeId: 'a', key: 'menu', seq: 1 },
        canvas('a', 'clicked', 2),
      ),
    ).toBe('clicked')
  })

  it('keeps a menu choice made after the last click', () => {
    expect(
      resolvePickedPart(
        'a',
        { nodeId: 'a', key: 'menu', seq: 2 },
        canvas('a', 'clicked', 2),
      ),
    ).toBe('menu')
  })

  it("ignores a click on another placement, and another node's choice", () => {
    expect(
      resolvePickedPart(
        'a',
        { nodeId: 'b', key: 'menu', seq: 0 },
        canvas('b', 'clicked', 5),
      ),
    ).toBe('root')
    expect(resolvePickedPart(undefined, { key: 'x', seq: 0 })).toBe('root')
  })
})
