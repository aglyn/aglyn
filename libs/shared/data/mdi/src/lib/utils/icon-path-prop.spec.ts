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

import { MdiIcons } from '../constants/mdi-icons'
import { getMdiIconFromId } from './get-mdi-icon-from-id'
import { getMdiIconPath, iconPathPropName } from './icon-path-prop'

describe('iconPathPropName', () => {
  it('maps each icon id prop to its companion path prop', () => {
    expect(iconPathPropName('iconId')).toBe('iconPath')
    expect(iconPathPropName('startIconId')).toBe('startIconPath')
    expect(iconPathPropName('endIconId')).toBe('endIconPath')
  })

  it('only rewrites a trailing Id, so an unrelated name is unchanged', () => {
    // The caller skips a no-op rename rather than writing a bogus prop.
    expect(iconPathPropName('identifier')).toBe('identifier')
    expect(iconPathPropName('size')).toBe('size')
  })
})

describe('getMdiIconPath', () => {
  afterEach(() => MdiIcons.clear())

  it('returns the path for a loaded icon', () => {
    MdiIcons.set('laptop', {
      id: 'laptop',
      name: 'Laptop',
      path: 'M4,6H20',
      as: [],
      tags: [],
    })
    expect(getMdiIconPath('laptop')).toBe('M4,6H20')
  })

  it('returns undefined for an empty or missing id', () => {
    expect(getMdiIconPath(undefined)).toBeUndefined()
    expect(getMdiIconPath('')).toBeUndefined()
  })

  /**
   * The whole point of this function (AGL-1212). On a render surface the
   * catalog is never loaded, so every lookup misses — and `getMdiIconFromId`
   * answers a miss with `DEFAULT_ICON`, which carries a real `path`. Callers
   * that only checked `icon?.path` therefore painted a "help" glyph on every
   * published page instead of falling back.
   */
  it('does NOT substitute DEFAULT_ICON when the catalog has not been loaded', () => {
    expect(MdiIcons.size).toBe(0)

    const viaFallbackHelper = getMdiIconFromId('view-grid-outline')
    expect(viaFallbackHelper.path).toEqual(expect.any(String))
    expect(viaFallbackHelper.path.length).toBeGreaterThan(0)

    expect(getMdiIconPath('view-grid-outline')).toBeUndefined()
  })
})
