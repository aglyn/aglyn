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

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type * as CommerceModel from '../../../model'
import { buildPosReceipt } from '../../../model/commerce-pos-ops'
import { posReceiptLogoUrl, printPosReceipt } from '../pos-ops/pos-receipt'
import { centsFromInput, usd } from '../pos/pos-api'
import { POS_TOUCH_PX } from '../pos/pos-product-grid.component'
import type { PosOfflineRungSale, PosOfflineState } from './use-pos-offline'
import type { RegisterLine } from '../pos/pos-cart-panel.component'

/*==========================================
 * AN OFFLINE CASH SALE (AGL-3625): the total the register rings from its
 * cached catalog and the store's rate, the cash handed over, and — once the
 * sale is on the device — the change and the printed receipt. The emailed
 * receipt goes when the sale syncs.
 *=========================================*/

export interface PosOfflineCheckoutProps {
  open: boolean
  offline: PosOfflineState
  hostId: string
  lines: RegisterLine[]
  discountPct: number
  customer?: { email?: string | null; name?: string | null; kind?: string; id?: string } | null
  registerName?: string
  cashierName?: string
  onClose: () => void
  /** The sale is on the device; the basket can be cleared. */
  onRung: (rung: PosOfflineRungSale) => void
  /** The cashier is done with the receipt step. */
  onDone: () => void
}

/** Prints an offline sale's receipt from what the register queued. */
export function printPosOfflineReceipt(
  rung: PosOfflineRungSale,
  kit: PosOfflineState['kit'],
  hostId: string,
  options: { gift?: boolean; registerName?: string; cashierName?: string } = {},
): void {
  const logoUrl = posReceiptLogoUrl(
    kit?.receipt.logo,
    hostId,
    typeof window === 'undefined' ? null : window.location.origin,
  )
  printPosReceipt(
    buildPosReceipt({
      orderId: rung.saleKey,
      order: rung.order as never,
      store: {
        name: kit?.receipt.name ?? 'Receipt',
        ...(logoUrl ? { logoUrl } : {}),
        ...(kit?.receipt.address ? { address: kit.receipt.address } : {}),
        ...(kit?.receipt.footer ? { footer: kit.receipt.footer } : {}),
        ...(kit?.receipt.returnPolicy ? { returnPolicy: kit.receipt.returnPolicy } : {}),
      },
      ...(options.gift ? { gift: true } : {}),
      ...(options.registerName ? { registerName: options.registerName } : {}),
      ...(options.cashierName ? { cashierName: options.cashierName } : {}),
    }),
  )
}

export function PosOfflineCheckout(props: PosOfflineCheckoutProps) {
  const { offline, lines, discountPct } = props
  const [received, setReceived] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rung, setRung] = useState<PosOfflineRungSale | null>(null)
  useEffect(() => {
    if (!props.open) {
      setReceived('')
      setFailed(false)
      setRung(null)
    }
  }, [props.open])

  const totals: CommerceModel.OrderTotals | null = rung ? rung.sale.totals : offline.totalsFor(lines, discountPct)
  const owed = totals?.totalCents ?? 0
  const tendered = centsFromInput(received)
  const overLimit = Boolean(offline.kit && discountPct > offline.kit.maxDiscountPct)
  const quick = [
    ...new Set([owed, Math.ceil(owed / 500) * 500, Math.ceil(owed / 1000) * 1000, Math.ceil(owed / 2000) * 2000]),
  ]
    .filter((value) => value >= owed)
    .slice(0, 4)

  const take = async () => {
    if (busy || !totals || tendered < owed) return
    setBusy(true)
    setFailed(false)
    const result = await offline.ringCashSale({
      lines,
      discountPct,
      cashTenderedCents: tendered,
      ...(props.customer ? { customer: props.customer } : {}),
    })
    setBusy(false)
    if (!result) {
      setFailed(true)
      return
    }
    setRung(result)
    props.onRung(result)
  }

  const print = (gift: boolean) => {
    if (!rung) return
    printPosOfflineReceipt(rung, offline.kit, props.hostId, {
      gift,
      ...(props.registerName ? { registerName: props.registerName } : {}),
      ...(props.cashierName ? { cashierName: props.cashierName } : {}),
    })
  }

  const close = () => (rung ? props.onDone() : props.onClose())

  return (
    <Dialog open={props.open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{rung ? 'Sale saved on this register' : `Cash — ${usd(owed)}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!totals ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {offline.unavailableReason ?? 'This basket cannot be rung offline.'}
          </Alert>
        ) : (
          <Stack spacing={0.5} sx={{ mt: 1 }} aria-label="Offline totals">
            <Row label="Items" value={usd(totals.itemsCents)} />
            {totals.discountCents > 0 ? <Row label="Discount" value={`-${usd(totals.discountCents)}`} /> : null}
            <Row label="Tax" value={usd(totals.taxCents)} />
            <Row label="Total" value={usd(totals.totalCents)} strong />
          </Stack>
        )}
        {rung ? (
          <>
            <Alert severity="success">
              {rung.sale.changeCents > 0 ? `Change due: ${usd(rung.sale.changeCents)}` : 'No change due.'}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {rung.sale.customer?.email
                ? 'It syncs when the register is back online, and the emailed receipt goes then.'
                : 'It syncs when the register is back online.'}
            </Typography>
          </>
        ) : totals ? (
          <>
            {overLimit ? (
              <Alert severity="error">
                {`This register may discount up to ${offline.kit?.maxDiscountPct ?? 0}%.`}
              </Alert>
            ) : null}
            <TextField
              label="Cash received ($)"
              value={received}
              onChange={(event) => setReceived(event.target.value.replace(/[^0-9.]/g, ''))}
              autoFocus
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              {quick.map((cents) => (
                <Button
                  key={cents}
                  variant="outlined"
                  onClick={() => setReceived((cents / 100).toFixed(2))}
                  sx={{ minHeight: POS_TOUCH_PX }}
                >
                  {cents === owed ? 'Exact' : usd(cents)}
                </Button>
              ))}
            </Stack>
            {tendered > 0 && tendered >= owed ? (
              <Alert severity="success">{`Change: ${usd(tendered - owed)}`}</Alert>
            ) : tendered > 0 ? (
              <Alert severity="info">{`Offline sales take the whole total in cash: ${usd(owed - tendered)} more.`}</Alert>
            ) : null}
            {failed ? (
              <Alert severity="error">
                {'This register could not save the sale. Do not take the cash; try again.'}
              </Alert>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        {rung ? (
          <>
            <Button onClick={() => print(true)} sx={{ minHeight: POS_TOUCH_PX }}>
              {'Gift receipt'}
            </Button>
            <Button onClick={() => print(false)} sx={{ minHeight: POS_TOUCH_PX }}>
              {'Print receipt'}
            </Button>
            <Button variant="contained" onClick={props.onDone} sx={{ minHeight: POS_TOUCH_PX }}>
              {'New sale'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={props.onClose} sx={{ minHeight: POS_TOUCH_PX }}>
              {'Cancel'}
            </Button>
            <Button
              variant="contained"
              disabled={busy || !totals || overLimit || tendered < owed}
              onClick={() => void take()}
              sx={{ minHeight: POS_TOUCH_PX }}
            >
              {busy ? 'Saving…' : 'Take cash'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
PosOfflineCheckout.displayName = 'PosOfflineCheckout'

function Row(props: { label: string; value: string; strong?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant={props.strong ? 'subtitle1' : 'body2'}>{props.label}</Typography>
      <Typography variant={props.strong ? 'subtitle1' : 'body2'}>{props.value}</Typography>
    </Box>
  )
}
