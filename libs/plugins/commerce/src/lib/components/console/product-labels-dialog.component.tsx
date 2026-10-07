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
'use client'

import * as CommerceModel from '../../model'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useEffect, useMemo, useState } from 'react'
import {
  LABEL_SIZES,
  MAX_LABEL_COPIES,
  productLabelsHtml,
  productLabelsZpl,
  type ProductLabel,
} from '../../printing/product-labels'

/**
 * Print product labels (AGL-3619): a label per variant with its name,
 * options, price and a barcode the register scans back, on a thermal label
 * printer through the browser, or as ZPL for a Zebra.
 */

const COPIES_INPUT = { htmlInput: { inputMode: 'numeric', min: 0, max: MAX_LABEL_COPIES } } as const

/** The labels a product prints: one row per variant that has a barcode or SKU. */
export function productLabelRows(product: CommerceModel.HostProduct): Array<ProductLabel & { variantId: string }> {
  return product.variants.map((variant) => {
    const options = Object.values(variant.options ?? {}).filter(Boolean)
    return {
      variantId: variant.id,
      name: product.name,
      ...(options.length ? { detail: options.join(' / ') } : {}),
      ...(Number.isFinite(Number(variant.priceUsd))
        ? { priceCents: Math.round(Number(variant.priceUsd) * 100) }
        : {}),
      currency: 'usd',
      code: String(variant.barcode || variant.sku || '').trim(),
      copies: 1,
    }
  })
}

export function ProductLabelsDialog(props: {
  product: (CommerceModel.HostProduct & { $id: string }) | null
  onClose: () => void
}) {
  const { product, onClose } = props
  const { enqueueSnackbar } = useSnackbar()
  const initial = useMemo(() => (product ? productLabelRows(product) : []), [product])
  const [rows, setRows] = useState(initial)
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0].id)
  useEffect(() => setRows(initial), [initial])
  const printable = rows.filter((row) => row.code && row.copies > 0)
  const total = printable.reduce((sum, row) => sum + row.copies, 0)

  const setCopies = (variantId: string, value: string) =>
    setRows((current) =>
      current.map((row) =>
        row.variantId === variantId
          ? { ...row, copies: Math.max(0, Math.min(MAX_LABEL_COPIES, Math.floor(Number(value) || 0))) }
          : row,
      ),
    )

  const print = () => {
    const win = window.open('', '_blank', 'width=480,height=640')
    if (!win) {
      return void enqueueSnackbar('Allow pop-ups for this site to print labels', {
        variant: 'warning',
        persist: false,
      })
    }
    // Every merchant-authored value on the page is escaped by the renderer.
    win.document.write(productLabelsHtml(printable, sizeId))
    win.document.close()
    win.focus()
    win.print()
  }

  const downloadZpl = () => {
    const blob = new Blob([productLabelsZpl(printable, sizeId)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `labels-${(product?.name ?? 'product').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.zpl`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Dialog open={Boolean(product)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Labels — ${product?.name ?? ''}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Label size" value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
            {LABEL_SIZES.map((size) => (
              <MenuItem key={size.id} value={size.id}>
                {size.label}
              </MenuItem>
            ))}
          </TextField>
          {rows.map((row) => (
            <Stack key={row.variantId} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {row.detail ?? row.name}
                </Typography>
                <Typography variant="caption" color={row.code ? 'text.secondary' : 'warning.main'} noWrap>
                  {row.code || 'Add a barcode or SKU to print a label'}
                </Typography>
              </Stack>
              <TextField
                label="Copies"
                type="number"
                size="small"
                value={row.code ? row.copies : 0}
                disabled={!row.code}
                onChange={(event) => setCopies(row.variantId, event.target.value)}
                slotProps={COPIES_INPUT}
                sx={{ width: 96 }}
              />
            </Stack>
          ))}
          <Typography variant="body2" color="text.secondary">
            {'Print to a label printer at 100% scale, or download ZPL to send straight to a Zebra.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button disabled={!total} onClick={downloadZpl}>
          {'Download ZPL'}
        </Button>
        <Button disabled={!total} onClick={print}>
          {total === 1 ? 'Print 1 label' : `Print ${total} labels`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ProductLabelsDialog
