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
  applyMutedStyles,
  isStyleMuted,
  mutedStyleKey,
  parseMutedStyleKey,
  toggleMutedStyle,
  mutedStylesForNode,
} from './muted-styles'

const NODE = 'card'

const mute = (
  sx: Record<string, any>,
  keys: string[],
  nodeId = NODE,
): Record<string, any> => applyMutedStyles(sx, nodeId, keys)

const key = (property: string, scope: { state?: any; breakpoint?: any } = {}) =>
  mutedStyleKey({ nodeId: NODE, property, ...scope })

describe('mutedStyleKey / parseMutedStyleKey', () => {
  it('round-trips a scope through the encoded flag entry', () => {
    const target = {
      nodeId: NODE,
      property: 'maxWidth',
      state: 'hover' as const,
      breakpoint: 'md' as const,
    }
    expect(parseMutedStyleKey(mutedStyleKey(target))).toEqual(target)
  })

  it('spells the default scopes rather than leaving them blank', () => {
    expect(mutedStyleKey({ nodeId: NODE, property: 'color' })).toBe(
      'card|base|base|color',
    )
    expect(parseMutedStyleKey('card|base|base|color')).toEqual({
      nodeId: NODE,
      property: 'color',
      state: null,
      breakpoint: null,
    })
  })

  it('ignores an entry that is not one of ours', () => {
    expect(parseMutedStyleKey('nonsense')).toBeNull()
    expect(parseMutedStyleKey('|base|base|color')).toBeNull()
  })
})

describe('toggleMutedStyle', () => {
  const target = { nodeId: NODE, property: 'maxWidth' }

  it('adds, removes, and never mutates the list it is given', () => {
    const start: string[] = []
    const on = toggleMutedStyle(start, target)
    expect(isStyleMuted(on, target)).toBe(true)
    expect(start).toEqual([])

    const off = toggleMutedStyle(on, target)
    expect(isStyleMuted(off, target)).toBe(false)
    expect(isStyleMuted(on, target)).toBe(true)
  })

  it('keys a mute to its scope', () => {
    const on = toggleMutedStyle(undefined, {
      ...target,
      state: 'hover',
    })
    expect(isStyleMuted(on, { ...target, state: 'hover' })).toBe(true)
    expect(isStyleMuted(on, target)).toBe(false)
    expect(isStyleMuted(on, { ...target, breakpoint: 'md' })).toBe(false)
  })
})

describe('mutedStylesForNode', () => {
  it('reads only the entries belonging to the element', () => {
    const list = [key('color'), 'other|base|base|color']
    expect(mutedStylesForNode(list, NODE)).toEqual([
      { nodeId: NODE, property: 'color', state: null, breakpoint: null },
    ])
    expect(mutedStylesForNode(list, undefined)).toEqual([])
  })
})

describe('applyMutedStyles (AGL-2486)', () => {
  it('stops the declaration applying and leaves the rest alone', () => {
    const sx = { maxWidth: '600px', color: 'primary.main' }
    expect(mute(sx, [key('maxWidth')])).toEqual({ color: 'primary.main' })
  })

  // The value is not moved anywhere while it is off, so putting it back is
  // not a restore that can fail — it is the absence of a removal.
  it('never touches the record it is given', () => {
    const sx = { maxWidth: '600px' }
    mute(sx, [key('maxWidth')])
    expect(sx).toEqual({ maxWidth: '600px' })
  })

  it('returns the record by identity when nothing is muted', () => {
    const sx = { maxWidth: '600px' }
    expect(applyMutedStyles(sx, NODE, [])).toBe(sx)
    expect(applyMutedStyles(sx, NODE, undefined)).toBe(sx)
    expect(applyMutedStyles(sx, NODE, [key('color')])).toBe(sx)
  })

  it('leaves the styles of another element alone', () => {
    const sx = { maxWidth: '600px' }
    expect(applyMutedStyles(sx, 'other-node', [key('maxWidth')])).toBe(sx)
  })

  it('reaches the declaration through a system-prop alias', () => {
    // A preset writes `bgcolor`; the panel's field is `backgroundColor`.
    const sx = { bgcolor: 'background.paper', color: 'text.primary' }
    expect(mute(sx, [key('backgroundColor')])).toEqual({
      color: 'text.primary',
    })
  })

  it('walks the array form of sx', () => {
    const sx = [{ maxWidth: '600px' }, { color: 'red' }]
    expect(mute(sx as any, [key('maxWidth')])).toEqual([{}, { color: 'red' }])
  })
})

describe('muted styles keep their scopes apart', () => {
  const hovered = {
    color: 'text.primary',
    '&:hover': { color: 'primary.main', textDecoration: 'underline' },
  }

  it('mutes a state slice without disturbing the default styles', () => {
    expect(mute(hovered, [key('color', { state: 'hover' })])).toEqual({
      color: 'text.primary',
      '&:hover': { textDecoration: 'underline' },
    })
  })

  it('mutes the default styles without disturbing a state slice', () => {
    expect(mute(hovered, [key('color')])).toEqual({
      '&:hover': { color: 'primary.main', textDecoration: 'underline' },
    })
  })

  it('drops the slice entirely once its last declaration is muted', () => {
    const sx = { color: 'text.primary', '&:hover': { color: 'primary.main' } }
    expect(mute(sx, [key('color', { state: 'hover' })])).toEqual({
      color: 'text.primary',
    })
  })

  it('mutes one breakpoint and lets the cascade fill in from below', () => {
    const sx = { maxWidth: { xs: '100%', md: '600px' } }
    expect(mute(sx, [key('maxWidth', { breakpoint: 'md' })])).toEqual({
      maxWidth: '100%',
    })
  })

  it('leaves the other breakpoints of the same property applying', () => {
    const sx = { maxWidth: { xs: '100%', md: '600px', lg: '800px' } }
    expect(mute(sx, [key('maxWidth', { breakpoint: 'md' })])).toEqual({
      maxWidth: { xs: '100%', lg: '800px' },
    })
  })

  // Nothing is declared AT lg — it applies there through the cascade — so
  // muting at lg takes the declaration off rather than reading as a control
  // that does nothing.
  it('drops a declaration that applies at the breakpoint by inheritance', () => {
    const sx = { maxWidth: { xs: '100%' }, color: 'red' }
    expect(mute(sx, [key('maxWidth', { breakpoint: 'lg' })])).toEqual({
      color: 'red',
    })
  })

  it('applies several mutes at once', () => {
    const sx = { maxWidth: '600px', color: 'red', boxShadow: 3 }
    expect(mute(sx, [key('maxWidth'), key('boxShadow')])).toEqual({
      color: 'red',
    })
  })
})
