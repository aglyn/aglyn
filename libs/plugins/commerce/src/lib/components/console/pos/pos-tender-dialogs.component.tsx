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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
// `/pure`: the Stripe script loads when a typed card is actually taken, not
// whenever the register mounts (the AGL-2486 reasoning).
import { loadStripe } from '@stripe/stripe-js/pure'
import type { Stripe } from '@stripe/stripe-js'
import { QRCodeSVG } from 'qrcode.react'
import { useMemo, useState } from 'react'
import { centsFromInput, usd } from './pos-api'
import { POS_TOUCH_PX } from './pos-product-grid.component'

/*==========================================
 * The register's tender dialogs (AGL-3607). Each collects what its tender
 * needs and hands it to the tender panel, which owns the request.
 *=========================================*/

/** Cash: what the customer handed over, with one-tap round-ups. */
export function PosCashDialog(props: {
  open: boolean
  dueCents: number
  tipCents: number
  busy: boolean
  onClose: () => void
  onTake: (tenderedCents: number) => void
}) {
  const [received, setReceived] = useState('')
  const owed = props.dueCents + props.tipCents
  const tendered = centsFromInput(received)
  const quick = [...new Set([owed, Math.ceil(owed / 500) * 500, Math.ceil(owed / 1000) * 1000, Math.ceil(owed / 2000) * 2000])]
    .filter((value) => value >= owed)
    .slice(0, 4)
  const close = () => {
    setReceived('')
    props.onClose()
  }
  return (
    <Dialog open={props.open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{`Cash — ${usd(owed)}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Cash received ($)"
          value={received}
          onChange={(event) => setReceived(event.target.value.replace(/[^0-9.]/g, ''))}
          autoFocus
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
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
        ) : tendered > 0 && tendered < owed ? (
          <Alert severity="info">
            {`Takes ${usd(Math.max(0, tendered - props.tipCents))} toward the sale; ${usd(owed - tendered)} left to pay.`}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={props.busy || tendered <= props.tipCents}
          onClick={() => {
            props.onTake(tendered)
            setReceived('')
          }}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Take cash'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** A gift card: type or scan the code, see the balance, apply it. */
export function PosGiftCardDialog(props: {
  open: boolean
  busy: boolean
  onClose: () => void
  onCheck: (code: string) => Promise<{ availableCents: number; frozen: boolean; voided: boolean } | null>
  onApply: (code: string) => void
}) {
  const [code, setCode] = useState('')
  const [balance, setBalance] = useState<string | null>(null)
  const close = () => {
    setCode('')
    setBalance(null)
    props.onClose()
  }
  return (
    <Dialog open={props.open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{'Gift card'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Gift card code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase())
            setBalance(null)
          }}
          onKeyDown={async (event) => {
            if (event.key !== 'Enter' || !code.trim()) return
            const answer = await props.onCheck(code)
            setBalance(
              answer
                ? answer.frozen
                  ? 'This card is on hold.'
                  : answer.voided
                    ? 'This card was voided.'
                    : `Available: ${usd(answer.availableCents)}`
                : null,
            )
          }}
          autoFocus
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { autoComplete: 'off', autoCapitalize: 'characters' } }}
        />
        {balance ? <Alert severity="info">{balance}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Cancel'}
        </Button>
        <Button
          disabled={!code.trim()}
          onClick={async () => {
            const answer = await props.onCheck(code)
            setBalance(
              answer
                ? answer.frozen
                  ? 'This card is on hold.'
                  : `Available: ${usd(answer.availableCents)}`
                : null,
            )
          }}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Check balance'}
        </Button>
        <Button
          variant="contained"
          disabled={props.busy || !code.trim()}
          onClick={() => {
            props.onApply(code)
            setCode('')
            setBalance(null)
          }}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Apply card'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Charge to a checked-in stay's folio. */
export function PosFolioDialog(props: {
  open: boolean
  amountCents: number
  stays: any[]
  busy: boolean
  onClose: () => void
  onCharge: (reservationId: string) => void
}) {
  const [stay, setStay] = useState('')
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Charge to room — ${usd(props.amountCents)}`}</DialogTitle>
      <DialogContent>
        <TextField
          label="Checked-in stay"
          value={stay}
          onChange={(event) => setStay(event.target.value)}
          select
          fullWidth
          sx={{ mt: 1 }}
        >
          {props.stays.map((entry: any) => (
            <MenuItem key={entry.$id} value={entry.$id}>
              {entry.guestName ?? entry.guestEmail ?? entry.$id}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={props.busy || !stay}
          onClick={() => props.onCharge(stay)}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {'Charge folio'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The QR payment page. Encoded in this browser, never fetched (AGL-1671): a
 * live payment URL in a third party's query string is a link that pays the
 * sale for whoever opens it.
 */
export function PosQrDialog(props: { url: string; amountCents: number; onClose: () => void }) {
  return (
    <Dialog open={Boolean(props.url)} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Scan to pay ${usd(props.amountCents)}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {'The customer scans this and pays on their phone. The payment shows ' +
            'here as soon as it goes through.'}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <QRCodeSVG value={props.url} size={256} level="L" marginSize={4} title="Payment QR" role="img" />
        </Box>
        <Button href={props.url} target="_blank" rel="noopener noreferrer">
          {'Open payment page'}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Close'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const stripePromises = new Map<string, Promise<Stripe | null>>()

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  let promise = stripePromises.get(publishableKey)
  if (!promise) {
    promise = loadStripe(publishableKey)
    stripePromises.set(publishableKey, promise)
  }
  return promise
}

/**
 * A card typed in by staff (card not present). The card goes into Stripe's
 * own Payment Element and never touches the register; the server created the
 * PaymentIntent and records the payment from Stripe, never from this form's
 * say-so.
 */
export function PosKeyedCardDialog(props: {
  clientSecret: string
  publishableKey: string
  amountCents: number
  onClose: () => void
  onConfirmed: () => void
}) {
  const stripe = useMemo(
    () => (props.publishableKey ? stripeFor(props.publishableKey) : null),
    [props.publishableKey],
  )
  return (
    <Dialog open={Boolean(props.clientSecret)} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{`Type a card — ${usd(props.amountCents)}`}</DialogTitle>
      {props.clientSecret && stripe ? (
        <Elements stripe={stripe} options={{ clientSecret: props.clientSecret }}>
          <KeyedCardForm onClose={props.onClose} onConfirmed={props.onConfirmed} />
        </Elements>
      ) : null}
    </Dialog>
  )
}

function KeyedCardForm(props: { onClose: () => void; onConfirmed: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <PaymentElement options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } }} />
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy} sx={{ minHeight: POS_TOUCH_PX }}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !stripe || !elements}
          onClick={async () => {
            if (!stripe || !elements) return
            setBusy(true)
            setError('')
            const result = await stripe.confirmPayment({
              elements,
              redirect: 'if_required',
              confirmParams: { return_url: window.location.href },
            })
            setBusy(false)
            if (result.error) {
              setError(result.error.message ?? 'The card was not accepted.')
              return
            }
            props.onConfirmed()
          }}
          sx={{ minHeight: POS_TOUCH_PX }}
        >
          {busy ? 'Charging…' : 'Charge card'}
        </Button>
      </DialogActions>
    </>
  )
}
