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
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'

import NodeOverlay from './node-overlay'
import { repeatCopyStandIns } from '../utils/repeat-copy'

jest.mock('../hooks/use-add-element-drawer-callback', () => ({
  __esModule: true,
  useAddElementDrawerCallback: () => () => undefined,
  default: () => () => undefined,
}))

/**
 * A click on a repeat copy selects the element it draws, and the selection is
 * outlined on THAT copy — exactly what was clicked, and nothing round the
 * other copies (AGL-3111).
 *
 * jsdom does no layout, so each element states its own box: the real heading
 * in the first card, its copy in the card beside it.
 */
describe('the selection outlines the repeat copy it was made on (AGL-3111)', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => undefined,
    }) as DOMRect

  const leaf = (id: string, box: DOMRect) => {
    const element = document.createElement('div')
    element.setAttribute('data-aglyn', `leaf:${id}`)
    element.getBoundingClientRect = () => box
    element.getClientRects = () =>
      Object.assign([box], { item: () => box }) as unknown as DOMRectList
    document.body.appendChild(element)
    return element
  }

  const title = { $id: 'title', componentId: 'muiTypography', parent: null }

  let getNode: jest.SpyInstance

  const mount = () => {
    const ref = createRef<HTMLElement>()
    ;(ref as any).current = leaf('title', rect(55, 85, 340, 25))
    leaf('rep__grid__1__title', rect(445, 85, 340, 25))
    Besigner.refs.set('title', ref as any)
    Besigner.focus.setSelectedNode(title as any)
    return render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <NodeOverlay variant="selected" />
      </ThemeProvider>,
    )
  }

  /** Where the popper hangs the overlay: the box the outline is drawn for. */
  const anchoredAt = () =>
    (
      document
        .querySelector('[data-aglyn="outline:title"]')
        ?.closest('[data-popper-placement]') as HTMLElement | null
    )?.style.transform ?? ''

  const outlines = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-aglyn="outline:title"]'),
    ).map((element) => [element.style.width, element.style.height])

  beforeEach(() => {
    getNode = jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockImplementation((($id: any) =>
        $id === 'title' ? (title as any) : undefined) as any)
  })

  afterEach(() => {
    cleanup()
    Besigner.refs.delete('title')
    Besigner.focus.clearFocusStatus()
    repeatCopyStandIns.set('selected', null)
    getNode.mockRestore()
    document.body.innerHTML = ''
  })

  it('outlines the element itself when it was selected itself', () => {
    mount()

    expect(outlines()).toEqual([['340px', '25px']])
    expect(anchoredAt()).toContain('55')
  })

  it('outlines the copy that was clicked, and only that copy', () => {
    mount()
    act(() => {
      repeatCopyStandIns.set('selected', {
        original: title as any,
        copyId: 'rep__grid__1__title',
      })
    })

    expect(outlines()).toEqual([['340px', '25px']])
    expect(anchoredAt()).toContain('445')
    expect(anchoredAt()).not.toContain('55px')
  })
})
