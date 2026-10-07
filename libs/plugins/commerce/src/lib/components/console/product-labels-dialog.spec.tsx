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

import { fireEvent, render, screen } from '@testing-library/react'

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))

import { ProductLabelsDialog, productLabelRows } from './product-labels-dialog.component'

const PRODUCT: any = {
  $id: 'p1',
  name: 'Tee',
  type: 'physical',
  variants: [
    { id: 'v1', options: { Size: 'L' }, priceUsd: 25, barcode: '4006381333931' },
    { id: 'v2', options: { Size: 'M' }, priceUsd: 25, sku: 'TEE-M' },
    { id: 'v3', options: { Size: 'S' }, priceUsd: 25 },
  ],
}

describe('product labels (AGL-3619)', () => {
  it('labels each variant by its barcode, else its SKU', () => {
    expect(productLabelRows(PRODUCT).map((row) => [row.detail, row.code, row.priceCents])).toEqual([
      ['L', '4006381333931', 2500],
      ['M', 'TEE-M', 2500],
      ['S', '', 2500],
    ])
  })

  it('prints the labels with codes through the browser, and counts them', () => {
    const doc = { write: jest.fn(), close: jest.fn() }
    const win = { document: doc, focus: jest.fn(), print: jest.fn() }
    const open = jest.spyOn(window, 'open').mockReturnValue(win as any)
    render(<ProductLabelsDialog product={PRODUCT} onClose={() => undefined} />)
    expect(screen.getByText('Add a barcode or SKU to print a label')).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('Copies')[0], { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print 4 labels' }))
    expect(open).toHaveBeenCalled()
    const html = doc.write.mock.calls[0][0] as string
    expect(html.match(/<section class="label">/g)).toHaveLength(4)
    expect(html).toContain('TEE-M')
    expect(win.print).toHaveBeenCalled()
    open.mockRestore()
  })

  it('downloads ZPL for a Zebra', () => {
    const created: Blob[] = []
    ;(URL as any).createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob)
      return 'blob:labels'
    })
    ;(URL as any).revokeObjectURL = jest.fn()
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ProductLabelsDialog product={PRODUCT} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download ZPL' }))
    expect(created).toHaveLength(1)
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
})
