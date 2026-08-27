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

import * as Aglyn from '@aglyn/aglyn'

import {
  isClassMuted,
  isClassSwitchable,
  mutedClassesForNode,
  mutedClassKey,
  parseMutedClassKey,
  stripMutedClasses,
  toggleMutedClass,
} from './muted-classes'

const NODE = 'card'
const target = (className: string) => ({ nodeId: NODE, className })

describe('mutedClassKey / parseMutedClassKey', () => {
  it('round-trips a class name that contains hyphens', () => {
    const value = target('site-drawer-open')
    expect(parseMutedClassKey(mutedClassKey(value))).toEqual(value)
  })

  it('ignores an entry that is not one of ours', () => {
    expect(parseMutedClassKey('nope')).toBeNull()
    expect(parseMutedClassKey('|orphan')).toBeNull()
    expect(parseMutedClassKey('card|')).toBeNull()
  })
})

describe('isClassSwitchable', () => {
  // Switching the hidden class off on the canvas and revealing the element
  // are the same act, so the class does not carry a second switch for it.
  it('refuses the class the visibility toggle already owns', () => {
    expect(isClassSwitchable(Aglyn.ELEMENT_HIDDEN_CLASS)).toBe(false)
    expect(isClassSwitchable('site-drawer')).toBe(true)
  })
})

describe('toggleMutedClass', () => {
  it('adds, removes, and never mutates the list it is given', () => {
    const start: string[] = []
    const on = toggleMutedClass(start, target('promo'))
    expect(isClassMuted(on, target('promo'))).toBe(true)
    expect(start).toEqual([])

    const off = toggleMutedClass(on, target('promo'))
    expect(isClassMuted(off, target('promo'))).toBe(false)
    expect(isClassMuted(on, target('promo'))).toBe(true)
  })

  it('keys a mute to its element', () => {
    const on = toggleMutedClass(undefined, target('promo'))
    expect(isClassMuted(on, { nodeId: 'other', className: 'promo' })).toBe(
      false,
    )
  })
})

describe('mutedClassesForNode', () => {
  it('reads only the entries belonging to the element', () => {
    const list = [mutedClassKey(target('promo')), 'other|promo']
    expect(mutedClassesForNode(list, NODE)).toEqual(['promo'])
    expect(mutedClassesForNode(list, undefined)).toEqual([])
  })
})

describe('stripMutedClasses (AGL-2486)', () => {
  const node = () => ({
    $id: NODE,
    props: { className: 'promo site-drawer', children: 'Hello' },
  })

  it('takes the switched-off name out and leaves the rest', () => {
    const stripped = stripMutedClasses(node(), NODE, [
      mutedClassKey(target('promo')),
    ])
    expect(stripped?.props.className).toBe('site-drawer')
    expect(stripped?.props.children).toBe('Hello')
  })

  it('drops the attribute entirely once the last class is switched off', () => {
    const stripped = stripMutedClasses(
      { $id: NODE, props: { className: 'promo' } },
      NODE,
      [mutedClassKey(target('promo'))],
    )
    expect(stripped?.props).not.toHaveProperty('className')
  })

  // The class list in the document is what ships, so it is never touched.
  it('never mutates the node it is given', () => {
    const original = node()
    stripMutedClasses(original, NODE, [mutedClassKey(target('promo'))])
    expect(original.props.className).toBe('promo site-drawer')
  })

  it('returns the node by identity when nothing is switched off', () => {
    const original = node()
    expect(stripMutedClasses(original, NODE, [])).toBe(original)
    expect(stripMutedClasses(original, NODE, ['other|promo'])).toBe(original)
    expect(stripMutedClasses(original, NODE, undefined)).toBe(original)
  })

  it('leaves another element alone', () => {
    const original = node()
    expect(
      stripMutedClasses(original, 'somewhere-else', [
        mutedClassKey(target('promo')),
      ]),
    ).toBe(original)
  })

  // `Leaf` prefers `resolvedProps` where a component declares a resolver, so
  // a copy that stripped only one reading would paint the class anyway.
  it('agrees with itself across both class readings', () => {
    const stripped = stripMutedClasses(
      {
        $id: NODE,
        className: 'promo outer',
        props: { className: 'promo' },
        resolvedProps: { className: 'promo' },
      },
      NODE,
      [mutedClassKey(target('promo'))],
    )
    expect(stripped?.className).toBe('outer')
    expect(stripped?.props).not.toHaveProperty('className')
    expect(stripped?.resolvedProps).not.toHaveProperty('className')
  })
})
