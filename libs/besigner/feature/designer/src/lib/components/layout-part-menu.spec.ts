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

import { LAYOUT_SLOT_COMPONENT_ID, NODE_ROOT_ID } from '@aglyn/aglyn'
import { findLayoutPart } from './layout-part-menu.component'

/** The layout's own nodes, as its read-only canvas holds them. */
const chrome = {
  getNode: (id: string) =>
    (
      ({
        [NODE_ROOT_ID]: { $id: NODE_ROOT_ID, componentId: 'root' },
        header: { $id: 'header', componentId: 'muiBox', labelShort: 'Header' },
        slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID },
        // A page node that happens to share an id with the layout's.
        title: { $id: 'title', componentId: 'muiTypography', labelShort: 'Title' },
      }) as Record<string, any>
    )[id],
} as any

/** The DOM both canvases render into one root, stamped as `Leaf` stamps it. */
function render() {
  const host = document.createElement('div')
  host.innerHTML = `
    <div data-aglyn="leaf:${NODE_ROOT_ID}">
      <header data-aglyn="leaf:header"><span id="brand">Demo Bakery</span></header>
      <main data-aglyn="leaf:slot">
        <h1 data-aglyn="leaf:title"><span id="page-title">Fresh bread</span></h1>
        <p data-aglyn="leaf:body" id="page-body">Every morning</p>
      </main>
    </div>`
  document.body.appendChild(host)
  return (selector: string) => host.querySelector(selector)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findLayoutPart', () => {
  it("names the layout element a click lands in", () => {
    const $ = render()
    expect(findLayoutPart($('#brand'), chrome)).toEqual({
      nodeId: 'header',
      label: 'Header',
    })
  })

  it("is null for the page's own elements, even one whose id the layout also uses", () => {
    const $ = render()
    expect(findLayoutPart($('#page-body'), chrome)).toBeNull()
    expect(findLayoutPart($('#page-title'), chrome)).toBeNull()
  })

  it('is null for the layout root and its slot, and without a layout', () => {
    const $ = render()
    expect(findLayoutPart($(`[data-aglyn="leaf:${NODE_ROOT_ID}"]`), chrome)).toBeNull()
    expect(findLayoutPart($('[data-aglyn="leaf:slot"]'), chrome)).toBeNull()
    expect(findLayoutPart($('#brand'), undefined)).toBeNull()
  })
})
