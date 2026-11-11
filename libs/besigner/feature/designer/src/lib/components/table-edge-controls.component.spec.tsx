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
import { parseDataTableRows } from '@aglyn/shared-data-enums'
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

import { inlineTextEdit } from '../utils/inline-text-edit.store'
import TableEdgeControlsComponent, {
  registerCellEditShapeHandler,
} from './table-edge-controls.component'

/**
 * "+" bars along a canvas Table's bottom and right edges (AGL-4216): there
 * when the Table is selected, and when one of its cells is being typed into.
 *
 * jsdom does no layout, so the table and the canvas state their own boxes.
 */
describe('table edge bars on the canvas (AGL-4216)', () => {
  const box = (left: number, top: number, width: number, height: number) =>
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

  const GRID = 'Feature | Us\n--- | :---:\nOpen source | Yes'
  const tableNode = {
    $id: 'table-1',
    componentId: 'dataTable',
    parent: null,
    props: { rows: GRID },
    componentSchema: {
      attributes: [
        { name: 'rows', component: Aglyn.FieldComponentType.DATA_TABLE },
      ],
    },
  }

  let getNode: jest.SpyInstance
  let updateNodeProps: jest.SpyInstance
  let tableEl: HTMLElement

  const mount = () => {
    const canvasEl = document.createElement('div')
    canvasEl.id = 'aglyn:viewport-canvas'
    canvasEl.getBoundingClientRect = () => box(0, 0, 1200, 800)
    document.body.appendChild(canvasEl)

    const leaf = document.createElement('div')
    tableEl = document.createElement('table')
    tableEl.getBoundingClientRect = () => box(100, 120, 400, 90)
    leaf.appendChild(tableEl)
    canvasEl.appendChild(leaf)

    const ref = createRef<HTMLElement>()
    ;(ref as any).current = leaf
    Besigner.refs.set('table-1', ref as any)
    return render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <TableEdgeControlsComponent />
      </ThemeProvider>,
    )
  }

  beforeEach(() => {
    getNode = jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockImplementation((($id: any) =>
        $id === 'table-1' ? (tableNode as any) : undefined) as any)
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    cleanup()
    act(() => inlineTextEdit.close())
    Besigner.refs.delete('table-1')
    Besigner.focus.clearFocusStatus()
    getNode.mockRestore()
    updateNodeProps.mockRestore()
    document.body.innerHTML = ''
  })

  it('shows nothing until a Table is selected', () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
  })

  it('adds a row and a column to the selected Table', () => {
    mount()
    act(() => Besigner.focus.setSelectedNode(tableNode as any))

    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const afterRow = updateNodeProps.mock.calls[0]?.[1] as Record<string, unknown>
    expect(parseDataTableRows(afterRow['rows'])).toEqual([
      ['Feature', 'Us'],
      ['Open source', 'Yes'],
      ['', ''],
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    const afterColumn = updateNodeProps.mock.calls[1]?.[1] as Record<
      string,
      unknown
    >
    expect(parseDataTableRows(afterColumn['rows'])[0]).toEqual([
      'Feature',
      'Us',
      '',
    ])
  })

  it('hangs the bars off the table edges', () => {
    mount()
    act(() => Besigner.focus.setSelectedNode(tableNode as any))
    const row = screen.getByRole('button', { name: 'Add row' })
    const column = screen.getByRole('button', { name: 'Add column' })
    // Under the table and its action strip (120 + 90 + 30), beside it (100 + 400 + 6).
    expect(window.getComputedStyle(row).top).toBe('240px')
    expect(window.getComputedStyle(row).width).toBe('400px')
    expect(window.getComputedStyle(column).left).toBe('506px')
    expect(window.getComputedStyle(column).height).toBe('90px')
  })

  it('goes through the open cell editor, so the typed text rides with the row', () => {
    mount()
    const cell = document.createElement('td')
    tableEl.appendChild(cell)
    const handler = jest.fn()
    const unregister = registerCellEditShapeHandler(handler)
    act(() => {
      Besigner.focus.setSelectedNode(tableNode as any)
      inlineTextEdit.openCell(
        tableNode as any,
        { left: 100, top: 120, width: 200, height: 30 },
        { attribute: 'rows', row: 1, column: 0, initialText: 'Open source' },
        cell,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    expect(handler).toHaveBeenCalledWith({ kind: 'insertRow', at: 2 })
    expect(updateNodeProps).not.toHaveBeenCalled()
    unregister()
  })
})
