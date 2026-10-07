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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import { openPrintable, renderLabelSheet, renderPackingSlips } from '../model/printables'
import type { ShippingHostSettings } from '../model/shipping-settings'
import type { PublicLabel, PublicRate } from './order-labels-widget.component'
import { formatCents, newAttemptKey, useShippingAvailability, useShippingFetch } from './shipping-api'

/**
 * The props the commerce plugin's `ordersBulk` zone hands a widget, restated
 * to what this one reads: the site and the orders ticked in the list.
 */
export interface OrdersBatchWidgetProps {
  hostId: string
  orgId?: string
  selectedOrderIds: readonly string[]
  /** The store's name, for packing slips. */
  storeName?: string
}

interface BatchRow {
  recordId: string
  recordRef: string | null
  shipmentId: string | null
  rate: PublicRate | null
  weightGrams: number | null
  slip?: { shipTo: PluginShippingAddress; lines: Array<{ name: string; sku: string | null; quantity: number }> }
  error: string | null
}

/**
 * BATCH LABELS (AGL-3612), beside the orders list's bulk actions: rate every
 * ticked order in the default box under one service rule, review, buy them
 * all, then print one sheet of labels and the packing slips. Each order's
 * label is its own claimed purchase, so a batch retried after a lost answer
 * buys only what it had not bought.
 */
export function OrdersBatchWidget(props: OrdersBatchWidgetProps) {
  const { hostId, selectedOrderIds, storeName = '' } = props
  const availability = useShippingAvailability(hostId)
  const request = useShippingFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<ShippingHostSettings | null>(null)
  const [presetId, setPresetId] = useState('')
  const [policy, setPolicy] = useState('cheapest')
  const [rows, setRows] = useState<BatchRow[] | null>(null)
  const [bought, setBought] = useState<Array<{ recordId: string; label: PublicLabel | null; error: string | null }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [batchKey, setBatchKey] = useState(() => newAttemptKey('batch'))

  useEffect(() => {
    if (!open) return
    request<{ settings: ShippingHostSettings }>(SHIPPING_API_ROUTES.settings, { query: { hostId } })
      .then((answer) => {
        setSettings(answer.settings)
        setPresetId(answer.settings.defaultPackageId ?? answer.settings.packages[0]?.id ?? '')
      })
      .catch(() => undefined)
  }, [hostId, open, request])

  const total = useMemo(
    () => (rows ?? []).reduce((sum, row) => sum + (row.rate && !row.rate.merchantCarrierAccount ? row.rate.amountCents : 0), 0),
    [rows],
  )

  const handleRate = async () => {
    setBusy(true)
    setBought(null)
    try {
      const answer = await request<{ results: BatchRow[] }>(SHIPPING_API_ROUTES.batchRates, {
        body: { hostId, recordIds: selectedOrderIds, presetId, policy },
      })
      setRows(answer.results)
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const handleBuy = async () => {
    const items = (rows ?? [])
      .filter((row) => row.rate && row.shipmentId)
      .map((row) => ({ recordId: row.recordId, shipmentId: row.shipmentId, rateId: row.rate?.rateId }))
    if (!items.length) return
    setBusy(true)
    try {
      const answer = await request<{ results: Array<{ recordId: string; label: PublicLabel | null; error: string | null }> }>(
        SHIPPING_API_ROUTES.batchBuy,
        { body: { hostId, batchKey, items } },
      )
      setBought(answer.results)
      const ok = answer.results.filter((result) => result.label).length
      enqueueSnackbar(`${ok} of ${items.length} labels bought`, { variant: ok === items.length ? 'success' : 'warning' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setOpen(false)
    setRows(null)
    setBought(null)
    setBatchKey(newAttemptKey('batch'))
  }

  if (!availability.available || !selectedOrderIds.length) return null

  const refOf = (recordId: string) => rows?.find((row) => row.recordId === recordId)?.recordRef ?? recordId

  return (
    <>
      <Button onClick={() => setOpen(true)}>{`Buy labels (${selectedOrderIds.length})`}</Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="md">
        <DialogTitle>{`Labels for ${selectedOrderIds.length} order${selectedOrderIds.length === 1 ? '' : 's'}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField select label="Box" value={presetId} onChange={(event) => setPresetId(event.target.value)} sx={{ flex: 1 }}>
                {(settings?.packages ?? []).map((box) => (
                  <MenuItem key={box.id} value={box.id}>
                    {box.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Service" value={policy} onChange={(event) => setPolicy(event.target.value)} sx={{ flex: 1 }}>
                <MenuItem value="cheapest">{'Cheapest for each order'}</MenuItem>
                <MenuItem value="fastest">{'Fastest for each order'}</MenuItem>
              </TextField>
              <Button onClick={handleRate} disabled={busy}>
                {rows ? 'Get rates again' : 'Get rates'}
              </Button>
            </Stack>
            {rows ? (
              <ScrollTable size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Order'}</TableCell>
                    <TableCell>{'Service'}</TableCell>
                    <TableCell>{'Weight'}</TableCell>
                    <TableCell align="right">{'Price'}</TableCell>
                    <TableCell>{'Label'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const result = bought?.find((one) => one.recordId === row.recordId)
                    return (
                      <TableRow key={row.recordId}>
                        <TableCell>{row.recordRef ?? row.recordId}</TableCell>
                        <TableCell>{row.rate?.label ?? row.error}</TableCell>
                        <TableCell>{row.weightGrams ? `${row.weightGrams} g` : ''}</TableCell>
                        <TableCell align="right">{row.rate ? formatCents(row.rate.amountCents, row.rate.currency) : ''}</TableCell>
                        <TableCell>
                          {result?.label?.labelUrl ? (
                            <Button size="small" onClick={() => window.open(result.label?.labelUrl ?? '', '_blank', 'noopener,noreferrer')}>
                              {'Print'}
                            </Button>
                          ) : (
                            result?.error ?? ''
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </ScrollTable>
            ) : null}
            {rows ? (
              <Typography variant="body2">{`Total for labels on discounted rates: ${formatCents(total)}`}</Typography>
            ) : null}
            {bought ? (
              <Alert
                severity="success"
                action={
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() =>
                        openPrintable(
                          renderLabelSheet(
                            bought
                              .filter((one) => one.label?.labelUrl)
                              .map((one) => ({
                                recordRef: refOf(one.recordId),
                                serviceLabel: one.label?.serviceLabel ?? '',
                                trackingNumber: one.label?.trackingNumber ?? '',
                                labelUrl: one.label?.labelUrl ?? '',
                              })),
                          ),
                        )
                      }
                    >
                      {'All labels'}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        openPrintable(
                          renderPackingSlips(
                            storeName,
                            (rows ?? [])
                              .filter((row) => row.slip && bought.some((one) => one.recordId === row.recordId && one.label))
                              .map((row) => ({ recordRef: row.recordRef ?? row.recordId, ...(row.slip as NonNullable<BatchRow['slip']>) })),
                          ),
                        )
                      }
                    >
                      {'Packing slips'}
                    </Button>
                  </Stack>
                }
              >
                {'Labels bought. Print them, and the packing slips to go in each box.'}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{bought ? 'Done' : 'Cancel'}</Button>
          {!bought ? (
            <Button variant="contained" onClick={handleBuy} disabled={busy || !rows?.some((row) => row.rate)}>
              {busy ? 'Working…' : 'Buy labels'}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
OrdersBatchWidget.displayName = 'OrdersBatchWidget'

export default OrdersBatchWidget
