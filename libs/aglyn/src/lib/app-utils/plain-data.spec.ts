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

import cloneDeep from 'lodash-es/cloneDeep.js'
import isEqual from 'lodash-es/isEqual.js'
import { observable, toJS } from 'mobx'

import { clonePlainData, plainDataEqual } from './plain-data'

/**
 * The canvas store's equality and copy answer what lodash's did on node data
 * (AGL-4220): the dirty check that switches Save on and off reads the first,
 * and every node a tree is denormalized into is the second.
 */

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  componentId: 'muiTypography',
  parentId: '_@_',
  nodes: [] as string[],
  props: { children: 'Hello', sx: { color: 'primary.main', mt: [1, 2] } },
  ...extra,
})

const SAME_SHAPED: Array<[string, unknown]> = [
  ['a string', 'text'],
  ['zero', 0],
  ['NaN', Number.NaN],
  ['null', null],
  ['undefined', undefined],
  ['a boolean', false],
  ['an empty object', {}],
  ['an empty array', []],
  ['a node', node('a')],
  ['a nodes map', { a: node('a'), b: node('b', { nodes: ['c'] }) }],
  ['nested arrays', [[1, [2, [3]]], { deep: [{ deeper: [null] }] }]],
  ['a date', new Date(Date.UTC(2026, 10, 12))],
  ['a class instance', new Point(1, 2)],
  ['a map', new Map<string, unknown>([['a', { b: 1 }]])],
  ['a set', new Set([1, 'two', 3])],
  ['an undefined-valued key', { a: undefined, b: 1 }],
]

const PAIRS: Array<[string, unknown, unknown]> = [
  ['equal nodes', node('a'), node('a')],
  ['a changed prop', node('a'), node('a', { props: { children: 'Bye' } })],
  [
    'a changed nested sx',
    node('a'),
    node('a', {
      props: { children: 'Hello', sx: { color: 'primary.main', mt: [1, 3] } },
    }),
  ],
  ['an extra key', { a: 1 }, { a: 1, b: 2 }],
  ['an undefined key against none', { a: undefined }, {}],
  ['null against undefined', null, undefined],
  ['NaN against NaN', Number.NaN, Number.NaN],
  ['+0 against -0', 0, -0],
  ['an array against an object', [], {}],
  ['an array-like object against an array', { 0: 'a', length: 1 }, ['a']],
  ['key order', { a: 1, b: 2 }, { b: 2, a: 1 }],
  ['arrays of different length', [1, 2], [1, 2, 3]],
  ['array order', [1, 2], [2, 1]],
  ['equal dates', new Date(5), new Date(5)],
  ['different dates', new Date(5), new Date(6)],
  ['a date against its time', new Date(5), 5],
  ['instances of one class', new Point(1, 2), new Point(1, 2)],
  ['a class instance against a plain object', new Point(1, 2), { x: 1, y: 2 }],
  ['equal maps', new Map([['a', { b: 1 }]]), new Map([['a', { b: 1 }]])],
  ['different maps', new Map([['a', { b: 1 }]]), new Map([['a', { b: 2 }]])],
  ['sets in another order', new Set([1, 2]), new Set([2, 1])],
  ['sets of equal objects', new Set([{ a: 1 }]), new Set([{ a: 1 }])],
  ['different sets', new Set([1, 2]), new Set([1, 3])],
  ['a string against a number', '1', 1],
  [
    'nodes maps',
    { a: node('a'), b: node('b') },
    { a: node('a'), b: node('b') },
  ],
  [
    'nodes maps differing in one child list',
    { a: node('a', { nodes: ['b'] }) },
    { a: node('a', { nodes: ['c'] }) },
  ],
]

describe('plainDataEqual', () => {
  it.each(SAME_SHAPED)(
    'equals a copy of %s, as lodash does',
    (_label, value) => {
      expect(plainDataEqual(value, cloneDeep(value))).toBe(
        isEqual(value, cloneDeep(value)),
      )
      expect(plainDataEqual(value, cloneDeep(value))).toBe(true)
    },
  )

  it.each(PAIRS)('answers lodash on %s', (_label, left, right) => {
    expect(plainDataEqual(left, right)).toBe(isEqual(left, right))
    expect(plainDataEqual(right, left)).toBe(isEqual(right, left))
  })

  it('reads through mobx proxies the way the canvas hands them over', () => {
    const tree = { a: node('a'), b: node('b', { nodes: ['a'] }) }
    const live = observable(cloneDeep(tree))
    expect(plainDataEqual(toJS(live), tree)).toBe(true)
    expect(plainDataEqual(live, tree)).toBe(isEqual(live, tree))
    live.b.nodes.push('c')
    expect(plainDataEqual(toJS(live), tree)).toBe(false)
  })
})

describe('clonePlainData', () => {
  it.each(SAME_SHAPED)('copies %s to what lodash copies', (_label, value) => {
    const copy = clonePlainData(value)
    expect(isEqual(copy, cloneDeep(value))).toBe(true)
    expect(isEqual(copy, value)).toBe(true)
  })

  it('shares nothing mutable with the original', () => {
    const original = { ...node('a', { nodes: ['b'] }), when: new Date(5) }
    const copy = clonePlainData(original)
    expect(copy).not.toBe(original)
    expect(copy.props).not.toBe(original.props)
    expect(copy.props.sx.mt).not.toBe(original.props.sx.mt)
    expect(copy.nodes).not.toBe(original.nodes)
    expect(copy.when).not.toBe(original.when)
    copy.props.sx.mt.push(9)
    copy.nodes.push('c')
    expect(original.props.sx.mt).toEqual([1, 2])
    expect(original.nodes).toEqual(['b'])
  })

  it('keeps a class instance its prototype and a function its reference', () => {
    const render = (): null => null
    const copy = clonePlainData({ at: new Point(3, 4), render })
    expect(copy.at).toBeInstanceOf(Point)
    expect(copy.at).toEqual(new Point(3, 4))
    expect(copy.render).toBe(render)
  })

  it('copies a mobx observable into plain data', () => {
    const live = observable(node('a', { nodes: ['b'] }))
    const copy = clonePlainData(live)
    expect(isEqual(toJS(copy), toJS(live))).toBe(true)
    expect(Array.isArray(copy.nodes)).toBe(true)
  })
})
