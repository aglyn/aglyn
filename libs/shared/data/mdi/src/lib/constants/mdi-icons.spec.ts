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

import { loadMdiIcons, MdiIcons } from './mdi-icons'

describe('loadMdiIcons (AGL-189)', () => {
  it('does not populate the map at module init', () => {
    // Importing the module must stay side-effect free — the catalog is
    // ~2.9 MB and only picker surfaces should pay for it.
    expect(MdiIcons.size).toBe(0)
  })

  it('loads the full generated catalog on demand', async () => {
    const icons = await loadMdiIcons()
    expect(icons).toBe(MdiIcons)
    // The 6.5.95 catalog ships thousands of icons; anything tiny means the
    // stub regression is back or the JSON failed to parse.
    expect(icons.size).toBeGreaterThan(1000)
    const sample = icons.get('ab-testing' as never)
    expect(sample).toBeDefined()
    expect(sample).toEqual(
      expect.objectContaining({ id: 'ab-testing', name: 'Ab Testing' }),
    )
    expect(typeof (sample as { path: string }).path).toBe('string')
  })

  it('returns the same promise for concurrent callers', async () => {
    const [first, second] = await Promise.all([loadMdiIcons(), loadMdiIcons()])
    expect(first).toBe(second)
  })
})
