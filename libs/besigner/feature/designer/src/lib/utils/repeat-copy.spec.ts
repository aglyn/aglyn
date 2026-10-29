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
import * as Besigner from '@aglyn/besigner'
import {
  repeatCopyAt,
  repeatCopyElementIn,
  repeatCopyStandIns,
} from './repeat-copy'

/** A grid repeating its card, whose title has a copy in each copy of the card. */
function render() {
  const root = document.createElement('div')
  root.innerHTML = `
    <div data-aglyn="leaf:grid">
      <div data-aglyn="leaf:card"><span data-aglyn="leaf:title">Avery</span></div>
      <div data-aglyn="leaf:rep__grid__1__card" data-aglyn-repeat-copy="">
        <span data-aglyn="leaf:rep__grid__1__title"><b>Sam</b></span>
      </div>
    </div>`
  document.body.appendChild(root)
  const $ = (id: string) =>
    root.querySelector(`[data-aglyn="leaf:${id}"]`) as Element
  return { root, $ }
}

const nodes: Record<string, any> = {
  card: { $id: 'card' },
  title: { $id: 'title' },
  grid: { $id: 'grid' },
}

let getNode: jest.SpyInstance

beforeEach(() => {
  getNode = jest
    .spyOn(Aglyn.canvas, 'getNode')
    .mockImplementation((($id: any) => nodes[$id]) as any)
})

afterEach(() => {
  getNode.mockRestore()
  Besigner.focus.clearFocusStatus()
  repeatCopyStandIns.set('hovered', null)
  repeatCopyStandIns.set('selected', null)
  document.body.innerHTML = ''
})

describe('repeatCopyAt', () => {
  it('names the copy under the pointer and the element it draws', () => {
    const { $ } = render()
    const inside = $('rep__grid__1__title').querySelector('b')
    expect(repeatCopyAt(inside)).toEqual({
      original: nodes.title,
      copyId: 'rep__grid__1__title',
    })
    expect(repeatCopyAt($('rep__grid__1__card'))).toEqual({
      original: nodes.card,
      copyId: 'rep__grid__1__card',
    })
  })

  it('has nothing for a real element', () => {
    const { $ } = render()
    expect(repeatCopyAt($('title'))).toBeNull()
    expect(repeatCopyAt(null)).toBeNull()
  })
})

describe('repeatCopyElementIn', () => {
  it('finds a drawn copy by its id, in the canvas the element lives in', () => {
    const { $ } = render()
    expect(repeatCopyElementIn($('title'), 'rep__grid__1__title')).toBe(
      $('rep__grid__1__title'),
    )
    expect(repeatCopyElementIn($('title'), 'rep__grid__9__title')).toBeNull()
  })
})

describe('repeatCopyStandIns', () => {
  const copy = { original: nodes.title, copyId: 'rep__grid__1__title' }

  it('outlines the copy for the element it was made on, and nothing else', () => {
    Besigner.focus.setSelectedNode(nodes.title)
    repeatCopyStandIns.set('selected', copy)
    expect(repeatCopyStandIns.copyIdFor('selected', 'title')).toBe(
      'rep__grid__1__title',
    )
    expect(repeatCopyStandIns.copyIdFor('selected', 'card')).toBeUndefined()
    expect(repeatCopyStandIns.copyIdFor('hovered', 'title')).toBeUndefined()
  })

  it('forgets the copy once the selection moves to another element', () => {
    Besigner.focus.setSelectedNode(nodes.title)
    repeatCopyStandIns.set('selected', copy)
    Besigner.focus.setSelectedNode(nodes.card)
    // Back to the title some other way — the hierarchy, say: the title is
    // outlined, not the copy clicked before.
    Besigner.focus.setSelectedNode(nodes.title)
    expect(repeatCopyStandIns.copyIdFor('selected', 'title')).toBeUndefined()
  })

  it('forgets the hovered copy once the pointer leaves the element', () => {
    Besigner.focus.setHoveredNode(nodes.title)
    repeatCopyStandIns.set('hovered', copy)
    expect(repeatCopyStandIns.copyIdFor('hovered', 'title')).toBe(
      'rep__grid__1__title',
    )
    Besigner.focus.dehoverNode(nodes.title)
    expect(repeatCopyStandIns.copyIdFor('hovered', 'title')).toBeUndefined()
  })
})
