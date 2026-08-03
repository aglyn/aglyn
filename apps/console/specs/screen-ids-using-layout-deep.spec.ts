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

import {
  scanLayoutUsage,
  screenIdsUsingLayoutDeep,
} from '../utils/server/scan-artifact-usage'

/**
 * Publishing a layout has to drop the cache of every screen rendered inside it
 * (AGL-1150). Layouts nest, so "inside it" is a chain, not a level — and a
 * one-level answer looks correct on the simple case that anyone would test by
 * hand, which is exactly why this is worth pinning.
 */
describe('screenIdsUsingLayoutDeep', () => {
  const screen = (id: string, layoutId?: string) => ({ id, layoutId })
  const layout = (id: string, layoutId?: string) => ({ id, layoutId })

  it('finds screens bound directly to the layout', () => {
    const screens = [screen('s1', 'L'), screen('s2', 'L'), screen('s3', 'other')]
    expect(screenIdsUsingLayoutDeep('L', screens, []).sort()).toEqual(['s1', 's2'])
  })

  it('finds screens nested one layout below — the case a level-only walk misses', () => {
    const screens = [screen('deep', 'child')]
    const layouts = [layout('child', 'L')]

    // The direct scan sees the child LAYOUT but no screen, so a caller that
    // stopped there would revalidate nothing and the page would serve stale
    // chrome for the whole window.
    expect(scanLayoutUsage('L', screens, layouts).map((d) => d.id)).toEqual(['child'])

    expect(screenIdsUsingLayoutDeep('L', screens, layouts)).toEqual(['deep'])
  })

  it('walks several levels', () => {
    const screens = [screen('s1', 'a'), screen('s2', 'b'), screen('s3', 'c')]
    const layouts = [layout('a', 'L'), layout('b', 'a'), layout('c', 'b')]
    expect(screenIdsUsingLayoutDeep('L', screens, layouts).sort()).toEqual([
      's1',
      's2',
      's3',
    ])
  })

  it('does not return screens outside the chain', () => {
    const screens = [screen('inside', 'a'), screen('outside', 'unrelated')]
    const layouts = [layout('a', 'L'), layout('unrelated')]
    expect(screenIdsUsingLayoutDeep('L', screens, layouts)).toEqual(['inside'])
  })

  it('terminates on a cycle in stored data', () => {
    // `canNestLayout` refuses to create one, but a document written straight to
    // Firestore is not bound by that, and a naive walk would hang the publish
    // request rather than surface anything.
    const screens = [screen('s1', 'b')]
    const layouts = [layout('a', 'L'), layout('b', 'a'), layout('L', 'b')]
    expect(screenIdsUsingLayoutDeep('L', screens, layouts)).toEqual(['s1'])
  })

  it('deduplicates a screen reachable by more than one path', () => {
    const screens = [screen('s1', 'a')]
    const layouts = [layout('a', 'L'), layout('b', 'L'), layout('a2', 'b')]
    expect(screenIdsUsingLayoutDeep('L', screens, layouts)).toEqual(['s1'])
  })

  it('ignores deleted screens and layouts', () => {
    const screens = [
      { id: 'live', layoutId: 'L' },
      { id: 'gone', layoutId: 'L', deletedAt: 1 },
      { id: 'belowDeleted', layoutId: 'deadLayout' },
    ]
    const layouts = [{ id: 'deadLayout', layoutId: 'L', deletedAt: 1 }]
    expect(screenIdsUsingLayoutDeep('L', screens, layouts)).toEqual(['live'])
  })

  it('returns nothing for an empty layout id', () => {
    expect(screenIdsUsingLayoutDeep('', [screen('s1', 'L')], [])).toEqual([])
  })
})
