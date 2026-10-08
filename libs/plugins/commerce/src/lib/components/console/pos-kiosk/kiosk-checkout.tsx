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

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type * as CommerceModel from '../../../model'
import { displayMoney } from '../pos-display/pos-display-api'
import { posDisplayTouchSx } from '../pos-display/tip-screen'

/** How the customer can pay, from the kiosk's context and the device. */
export interface KioskPayOptions {
  reader: boolean
  tap: boolean
  counter: boolean
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'h5' : 'body1'} component="span">
        {label}
      </Typography>
      <Typography variant={strong ? 'h5' : 'body1'} component="span">
        {value}
      </Typography>
    </Stack>
  )
}

/**
 * The priced order (AGL-3623): every line, the server's subtotal, discount,
 * tax and total, and the ways to pay. Nothing here was computed on the kiosk.
 */
export function KioskReview({
  sale,
  currency,
  pay,
  busy,
  notice,
  onPay,
  onCounter,
  onBack,
}: {
  sale: CommerceModel.PosKioskSale
  currency: string
  pay: KioskPayOptions
  busy: boolean
  notice: string | null
  onPay: (method: 'reader' | 'tap') => void
  onCounter: () => void
  onBack: () => void
}) {
  const money = (cents: number) => displayMoney(cents, currency)
  const none = !pay.reader && !pay.tap && !pay.counter
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          {'Review your order'}
        </Typography>
        <Stack spacing={1} divider={<Divider flexItem />}>
          {sale.lines.map((line, index) => (
            <Stack key={index} direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="subtitle1">{`${line.quantity} × ${line.name}`}</Typography>
                {line.variantLabel ? (
                  <Typography variant="body2" color="text.secondary">
                    {line.variantLabel}
                  </Typography>
                ) : null}
              </Box>
              <Typography variant="subtitle1">{money(line.amountCents)}</Typography>
            </Stack>
          ))}
        </Stack>
        <Divider />
        <Stack spacing={1}>
          <Row label="Subtotal" value={money(sale.itemsCents)} />
          {sale.discountCents > 0 ? <Row label="Discount" value={`−${money(sale.discountCents)}`} /> : null}
          <Row label="Tax" value={money(sale.taxCents)} />
          <Row label="Total" value={money(sale.totalCents)} strong />
        </Stack>
        {notice ? <Alert severity="warning">{notice}</Alert> : null}
        {none ? (
          <Alert severity="info">{'Payment is not set up on this kiosk yet. Please order at the counter.'}</Alert>
        ) : null}
        {pay.reader ? (
          <Button variant="contained" size="large" disabled={busy} onClick={() => onPay('reader')} sx={posDisplayTouchSx}>
            {'Pay with card'}
          </Button>
        ) : null}
        {pay.tap ? (
          <Button
            variant={pay.reader ? 'outlined' : 'contained'}
            size="large"
            disabled={busy}
            onClick={() => onPay('tap')}
            sx={posDisplayTouchSx}
          >
            {'Tap to Pay'}
          </Button>
        ) : null}
        {pay.counter ? (
          <Button
            variant={pay.reader || pay.tap ? 'outlined' : 'contained'}
            size="large"
            disabled={busy}
            onClick={onCounter}
            sx={posDisplayTouchSx}
          >
            {'Pay at counter'}
          </Button>
        ) : null}
        <Button size="large" disabled={busy} onClick={onBack} sx={(theme) => ({ minHeight: theme.spacing(7) })}>
          {'Back to menu'}
        </Button>
      </Stack>
    </Container>
  )
}

/** Waiting on the card: the reader's prompt, or the device's Tap to Pay. */
export function KioskPaying({
  chargeCents,
  currency,
  method,
  failure,
  testMode,
  busy,
  onCancel,
  onRetry,
  onCounter,
  onSimulate,
}: {
  /** What the card is charged: the order's balance and the tip chosen. */
  chargeCents: number
  currency: string
  method: 'reader' | 'tap'
  failure: string | null
  testMode: boolean
  busy: boolean
  onCancel: () => void
  onRetry: () => void
  onCounter: (() => void) | null
  onSimulate: (() => void) | null
}) {
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={4} sx={{ alignItems: 'stretch', textAlign: 'center' }}>
        <Typography variant="h3" component="h1">
          {failure
            ? 'The card did not go through'
            : method === 'reader'
              ? 'Tap, insert or swipe your card on the reader'
              : 'Hold your card near the device'}
        </Typography>
        <Typography variant="h5" component="p" color="text.secondary">
          {`Total ${displayMoney(chargeCents, currency)}`}
        </Typography>
        {failure ? <Alert severity="error">{failure}</Alert> : null}
        {failure ? (
          <Button variant="contained" size="large" disabled={busy} onClick={onRetry} sx={posDisplayTouchSx}>
            {'Try again'}
          </Button>
        ) : null}
        {failure && onCounter ? (
          <Button variant="outlined" size="large" disabled={busy} onClick={onCounter} sx={posDisplayTouchSx}>
            {'Pay at counter'}
          </Button>
        ) : null}
        {!failure && testMode && onSimulate ? (
          <Button variant="outlined" disabled={busy} onClick={onSimulate}>
            {'Test mode: tap a test card'}
          </Button>
        ) : null}
        <Button size="large" disabled={busy} onClick={onCancel} sx={(theme) => ({ minHeight: theme.spacing(7) })}>
          {failure ? 'Back to my order' : 'Cancel'}
        </Button>
      </Stack>
    </Container>
  )
}

/** The order number the customer is called by, paid or to pay at the counter. */
export function KioskDone({
  sale,
  currency,
  onDone,
}: {
  sale: CommerceModel.PosKioskSale
  currency: string
  onDone: () => void
}) {
  const queued = sale.status === 'queued'
  return (
    <Stack
      spacing={4}
      sx={{ minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}
    >
      <Typography variant="h5" component="p" color="text.secondary">
        {'Your order number'}
      </Typography>
      <Typography variant="h1" component="p" aria-label="Order number">
        {sale.number}
      </Typography>
      <Typography variant="h4" component="h1">
        {queued ? 'Please pay at the counter' : 'Thank you!'}
      </Typography>
      <Typography variant="h6" component="p" color="text.secondary">
        {queued
          ? `Show this number at the counter. Total ${displayMoney(sale.totalCents, currency)}.`
          : 'We’ll call your number when your order is ready.'}
      </Typography>
      <Button variant="contained" size="large" onClick={onDone} sx={posDisplayTouchSx}>
        {'Done'}
      </Button>
    </Stack>
  )
}
