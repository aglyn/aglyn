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
import { escapeHtml } from '../../../utils/escape-html'
import { posTender, PosRequestError, usd, type PosRegisterContext, type PosSaleSummary } from './pos-api'
import type { RegisterLine } from './pos-cart-panel.component'
import { POS_TOUCH_PX } from './pos-product-grid.component'
import type { PosDisplayControl } from './use-pos-display'

type User = Parameters<typeof posTender>[0]

/**
 * Prints a receipt through the browser (any printer with a system driver).
 * ESCAPED (AGL-2283) and printed from the opener, never from a script written
 * into the receipt: the popup inherits the console's CSP (AGL-523).
 */
export function printPosReceipt(input: {
  lines: RegisterLine[]
  sale: PosSaleSummary
}): void {
  const win = window.open('', '_blank', 'width=320,height=600')
  if (!win) return
  const payments = input.sale.payments
    .filter((payment) => payment.status === 'succeeded')
    .map((payment) => escapeHtml(CommerceModel.describeOrderPayment({ ...payment, atMs: 0 })))
  const change = input.sale.payments.reduce((sum, payment) => sum + (payment.changeCents ?? 0), 0)
  win.document.write(
    `<pre style="font-family:monospace;font-size:12px">` +
      input.lines
        .map(
          (line) =>
            `${escapeHtml(line.quantity)}x ${escapeHtml(line.name)}` +
            `${line.variantLabel ? ` (${escapeHtml(line.variantLabel)})` : ''}` +
            `  ${usd(line.unitAmountCents * line.quantity)}`,
        )
        .join('\n') +
      `\n\nTOTAL  ${usd(input.sale.totalCents)}` +
      (input.sale.tipCents ? `\nTIP    ${usd(input.sale.tipCents)}` : '') +
      `\n${payments.join('\n')}` +
      (change ? `\nCHANGE ${usd(change)}` : '') +
      `\n${escapeHtml(new Date().toLocaleString())}` +
      `</pre>`,
  )
  win.document.close()
  win.focus()
  win.print()
}

export interface PosReceiptPanelProps {
  user: User
  hostId: string
  sale: PosSaleSummary
  lines: RegisterLine[]
  context: PosRegisterContext | null
  display: PosDisplayControl
  onNewSale: () => void
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
  const [sent, setSent] = useState('')
  const asked = useRef(false)
  const settings = props.context?.settings
  const change = sale.payments.reduce((sum, payment) => sum + (payment.changeCents ?? 0), 0)

  const sendEmail = useCallback(
    async (to: string, marketingOptIn = false) => {
      try {
        await posTender(user, hostId, sale.orderId, 'receipt', { channel: 'email', to, marketingOptIn })
        setSent(to)
        setEmail('')
        notify('Receipt sent', 'success')
      } catch (error) {
        notify(error instanceof PosRequestError ? error.message : 'The receipt was not sent', 'error')
      }
    },
    [user, hostId, sale.orderId, notify],
  )

  // Once per sale: print when the store always prints, or hand the choice to
  // the customer's screen when it asks and a display is paired.
  useEffect(() => {
    if (asked.current || !settings) return
    asked.current = true
    if (settings.receiptDefault === 'print') {
      printPosReceipt({ lines: props.lines, sale })
      return
    }
    if (settings.receiptDefault === 'ask' && display.connected) {
      void (async () => {
        const answer = await display.ask({
          mode: 'receipt',
          receipt: {
            channels: ['email', ...(props.context?.smsReceipts ? (['sms'] as const) : []), 'print', 'none'],
            offerMarketing: settings.displayMarketingOptIn,
          },
        })
        if (!answer) return
        if (answer.receiptChannel === 'email' && answer.email) {
          await sendEmail(answer.email, answer.marketingOptIn === true)
        } else if (answer.receiptChannel === 'print') {
          printPosReceipt({ lines: props.lines, sale })
        } else if (answer.receiptChannel === 'none') {
          await posTender(user, hostId, sale.orderId, 'receipt', { channel: 'none' }).catch(() => undefined)
        }
      })()
    }
  }, [settings, display, props.lines, sale, sendEmail, props.context, user, hostId])

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
          {`Receipt emailed to ${sent}`}
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
          onClick={() => void sendEmail(email.trim())}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Send'}
        </Button>
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          onClick={() => printPosReceipt({ lines: props.lines, sale })}
          sx={{ minHeight: POS_TOUCH_PX, flex: 1 }}
        >
          {'Print receipt'}
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
