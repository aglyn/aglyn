/**
 * @jest-environment jsdom
 */
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
import { installForeignDomGuard } from './foreign-dom-guard'

/**
 * What a translator does to a React text node: wraps it in a `<font>` so
 * the node React holds is no longer a child of the parent React remembers.
 */
function translate(parent: HTMLElement, text: Text): HTMLElement {
  const font = document.createElement('font')
  parent.replaceChild(font, text)
  font.appendChild(text)
  return font
}

describe('installForeignDomGuard', () => {
  it('throws the 2026-10-09 NotFoundError without the guard', () => {
    const parent = document.createElement('p')
    const text = document.createTextNode('Create your workspace')
    parent.appendChild(text)
    translate(parent, text)
    expect(() => parent.removeChild(text)).toThrow(/not a child/i)
  })

  describe('installed', () => {
    beforeAll(() => {
      installForeignDomGuard()
      installForeignDomGuard() // repeat install is a no-op, not a double wrap
    })

    it('removing a node a translator moved is a no-op, not a crash', () => {
      const parent = document.createElement('p')
      const text = document.createTextNode('Create your workspace')
      parent.appendChild(text)
      const font = translate(parent, text)
      expect(parent.removeChild(text)).toBe(text)
      expect(font.parentNode).toBe(parent)
    })

    it('inserting before a node a translator moved appends instead', () => {
      const parent = document.createElement('p')
      const text = document.createTextNode('Workspace')
      parent.appendChild(text)
      translate(parent, text)
      const added = document.createElement('span')
      expect(parent.insertBefore(added, text)).toBe(added)
      expect(parent.lastChild).toBe(added)
    })

    it('leaves every well-formed call to the native method', () => {
      const parent = document.createElement('div')
      const a = document.createElement('a')
      const b = document.createElement('b')
      parent.appendChild(b)
      parent.insertBefore(a, b)
      expect(Array.from(parent.childNodes)).toEqual([a, b])
      parent.insertBefore(document.createElement('i'), null)
      expect(parent.childNodes).toHaveLength(3)
      expect(parent.removeChild(a)).toBe(a)
      expect(Array.from(parent.childNodes)).not.toContain(a)
    })
  })
})
