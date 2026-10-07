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

import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as CommerceModel from '../../../model'
import { usePosRegisterHasPrinter, usePosSaleReceipt } from '../pos-ops/register-ops'
import { posTender, PosRequestError, usd, type PosRegisterContext, type PosSaleSummary } from './pos-api'
import { POS_TOUCH_PX } from './pos-product-grid.component'
import type { PosDisplayControl } from './use-pos-display'

type User = Parameters<typeof posTender>[0]

export interface PosReceiptPanelProps {
  user: User
  hostId: string
  sale: PosSaleSummary
  context: PosRegisterContext | null
  display: PosDisplayControl
  onNewSale: () => void
  /** The register the sale rang on, for its receipt printer and header. */
  registerId?: string
  registerName?: string
  /** The cashier a PIN switched in (AGL-3609), as the receipt prints them. */
  cashierName?: string
  notify: (message: string, variant: 'success' | 'error' | 'warning' | 'info') => void
}

/**
 * The sale is paid (AGL-3607, AGL-3608): change due, then the receipt — on
 * the customer display when one is paired and the store asks, otherwise by
 * the cashier — and a new sale.
 */
export function PosReceiptPanel(props: PosReceiptPanelProps) {
  const { user, hostId, sale, display, notify } = props
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState('')
  const asked = useRef(false)
  const settings = props.context?.settings
  // The 80 mm receipt the register's operations print (AGL-3609), read back
  // from the stored sale; on a register with a cloud printer the server
  // prints it there instead of the browser.
  const receipt = usePosSaleReceipt({
    hostId,
    orderId: sale.orderId,
    ...(props.registerName ? { registerName: props.registerName } : {}),
    ...(props.cashierName ? { cashierName: props.cashierName } : {}),
  })
  const hasPrinter = usePosRegisterHasPrinter(hostId, props.registerId)
  const change = sale.payments.reduce((sum, payment) => sum + (payment.changeCents ?? 0), 0)

  // A text receipt is offered only when the store can send one (AGL-3610).
  const smsReceipts = props.context?.smsReceipts === true

  /**
   * Sends (email, text) or records (print, none) the receipt choice. The
   * server also ends the customer's turn on the display: it says thank you
   * and forgets the address or number they typed (AGL-3608).
   */
  const sendReceipt = useCallback(
    async (channel: CommerceModel.PosReceiptChannel, to = '', marketingOptIn = false) => {
      try {
        await posTender(user, hostId, sale.orderId, 'receipt', {
          channel,
          ...(to ? { to } : {}),
          ...(marketingOptIn ? { marketingOptIn: true } : {}),
        })
        if (channel === 'email' || channel === 'sms') {
          setSent(channel === 'sms' ? `Receipt texted to ${to}` : `Receipt emailed to ${to}`)
          if (channel === 'sms') setPhone('')
          else setEmail('')
          notify('Receipt sent', 'success')
        }
      } catch (error) {
        if (channel === 'email' || channel === 'sms') {
          notify(error instanceof PosRequestError ? error.message : 'The receipt was not sent', 'error')
        }
      }
    },
    [user, hostId, sale.orderId, notify],
  )

  /** Prints on the register's cloud printer when it has one, else in the browser. */
  const printReceipt = useCallback(async () => {
    if (!hasPrinter) receipt.print()
    await sendReceipt('print')
  }, [hasPrinter, receipt, sendReceipt])

  // Once per sale: print when the store always prints, or hand the choice to
  // the customer's screen when it asks and a display is paired.
  useEffect(() => {
    if (asked.current || !settings) return
    if (settings.receiptDefault === 'print') {
      // The receipt prints from the stored sale, so it waits for that read.
      if (!receipt.order) return
      asked.current = true
      void printReceipt()
      return
    }
    asked.current = true
    if (settings.receiptDefault === 'ask' && display.connected) {
      void (async () => {
        const answer = await display.ask({
          mode: 'receipt',
          receipt: {
            channels: ['email', ...(smsReceipts ? (['sms'] as const) : []), 'print', 'none'],
            offerMarketing: settings.displayMarketingOptIn,
          },
        })
        if (!answer) {
          // The cashier took the receipt over, or the customer walked away:
          // the screen still ends on its thank-you, not a stale prompt.
          await display.show({ mode: 'thanks' })
          return
        }
        if (answer.receiptChannel === 'email' && answer.email) {
          await sendReceipt('email', answer.email, answer.marketingOptIn === true)
        } else if (answer.receiptChannel === 'sms' && answer.phone) {
          await sendReceipt('sms', answer.phone)
        } else if (answer.receiptChannel === 'print') {
          await printReceipt()
        } else {
          await sendReceipt('none')
        }
      })()
    }
  }, [settings, display, receipt.order, printReceipt, sendReceipt, smsReceipts])

  return (
    <Stack spacing={1.5}>
      <Alert severity="success">
        {`Paid ${usd(sale.totalCents)}` + (sale.tipCents ? ` + ${usd(sale.tipCents)} tip` : '')}
      </Alert>
      {change ? (
        <Typography variant="h5" component="p">
          {`Change due: ${usd(change)}`}
        </Typography>
      ) : null}
      {display.asking === 'receipt' ? (
        <Typography variant="body2" color="text.secondary">
          {'The customer is choosing a receipt on the display…'}
        </Typography>
      ) : null}
      {sent ? (
        <Typography variant="body2" color="text.secondary">
          {sent}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1}>
        <TextField
          label="Email receipt to"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { inputMode: 'email', autoComplete: 'off' } }}
        />
        <Button
          variant="outlined"
          disabled={!CommerceModel.posDisplayEmail(email)}
          onClick={() => {
            display.cancelAsk()
            void sendReceipt('email', email.trim())
          }}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Send'}
        </Button>
      </Stack>
      {smsReceipts ? (
        <Stack direction="row" spacing={1}>
          <TextField
            label="Text receipt to"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { inputMode: 'tel', autoComplete: 'off' } }}
          />
          <Button
            variant="outlined"
            disabled={!CommerceModel.posDisplayPhone(phone)}
            onClick={() => {
              display.cancelAsk()
              void sendReceipt('sms', phone.trim())
            }}
            sx={{ minHeight: POS_TOUCH_PX }}
          >
            {'Text'}
          </Button>
        </Stack>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          disabled={!receipt.order}
          onClick={() => {
            // The cashier answers for the customer: the display's receipt
            // prompt ends with a thank-you rather than waiting it out.
            display.cancelAsk()
            void printReceipt()
          }}
          sx={{ minHeight: POS_TOUCH_PX, flex: 1 }}
        >
          {'Print receipt'}
        </Button>
        <Button
          variant="outlined"
          disabled={!receipt.order}
          onClick={() => receipt.print(true)}
          sx={{ minHeight: POS_TOUCH_PX, flex: 1 }}
        >
          {'Gift receipt'}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            display.cancelAsk()
            props.onNewSale()
          }}
          sx={{ minHeight: POS_TOUCH_PX, flex: 1 }}
        >
          {'New sale'}
        </Button>
      </Stack>
    </Stack>
  )
}
PosReceiptPanel.displayName = 'PosReceiptPanel'
