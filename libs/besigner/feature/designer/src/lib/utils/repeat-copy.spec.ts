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

import { repeatCopyElementsOf } from './repeat-copy'

/** A Stack repeating its rows, with a card that is itself repeated inside. */
function render() {
  const root = document.createElement('div')
  root.innerHTML = `
    <div data-aglyn="leaf:visible">
      <p data-aglyn="leaf:row">Avery</p>
      <p data-aglyn="leaf:rep__visible__1__row" data-aglyn-repeat-copy="">Sam</p>
      <p data-aglyn="leaf:rep__visible__2__row" data-aglyn-repeat-copy="">Jordan</p>
      <p data-aglyn="leaf:other-row">Unrelated</p>
      <div data-aglyn="leaf:rep__visible__1__card" data-aglyn-repeat-copy="">
        <span data-aglyn="leaf:rep__visible__1__title">Inner copy</span>
      </div>
      <span data-aglyn="leaf:title">Inner</span>
    </div>`
  document.body.appendChild(root)
  const $ = (id: string) =>
    root.querySelector(`[data-aglyn="leaf:${id}"]`) as Element
  return { root, $ }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('repeatCopyElementsOf', () => {
  it('finds every drawn copy of an element, and nothing else', () => {
    const { $ } = render()
    expect(repeatCopyElementsOf($('row'), 'row').map((e) => e.textContent)).toEqual([
      'Sam',
      'Jordan',
    ])
  })

  it('finds a copy nested inside a copy of its parent', () => {
    const { $ } = render()
    expect(
      repeatCopyElementsOf($('title'), 'title').map((e) => e.textContent),
    ).toEqual(['Inner copy'])
  })

  it('has nothing for an element no repeat draws', () => {
    const { $ } = render()
    expect(repeatCopyElementsOf($('other-row'), 'other-row')).toEqual([])
  })
})
