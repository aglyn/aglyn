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
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as CommerceModel from '../../../model'
import {
  centsFromInput,
  newAttemptKey,
  posCreditLookup,
  posGiftCardBalance,
  posNativeBridge,
  posTender,
  PosRequestError,
  usd,
  type PosRegisterContext,
  type PosSaleSummary,
  type PosTenderAction,
  type PosTenderResult,
} from './pos-api'
import { POS_TOUCH_PX } from './pos-product-grid.component'
import {
  PosCashDialog,
  PosCreditDialog,
  PosFolioDialog,
  PosGiftCardDialog,
  PosKeyedCardDialog,
  PosQrDialog,
} from './pos-tender-dialogs.component'
import type { PosDisplayControl } from './use-pos-display'

type User = Parameters<typeof posTender>[0]

const STATUS_LABEL: Record<CommerceModel.OrderPaymentStatus, string> = {
  pending: 'Waiting',
  succeeded: 'Approved',
  failed: 'Declined',
  canceled: 'Canceled',
  reversed: 'Returned',
}

const STATUS_COLOR: Record<
  CommerceModel.OrderPaymentStatus,
  'default' | 'success' | 'error' | 'warning' | 'info'
> = {
  pending: 'info',
  succeeded: 'success',
  failed: 'error',
  canceled: 'default',
  reversed: 'warning',
}

export interface PosTenderPanelProps {
  user: User
  hostId: string
  registerId: string
  sale: PosSaleSummary
  context: PosRegisterContext | null
  stays: any[]
  display: PosDisplayControl
  onSale: (sale: PosSaleSummary) => void
  /** The sale is voided: the basket is the cashier's again. */
  onVoided: () => void
  /** The tip chosen for the next payment, before it is taken. */
  onTipChange?: (tipCents: number) => void
  /** A PIN-switched cashier (AGL-3609) takes each payment they start. */
  cashierAssertion?: string
  notify: (message: string, variant: 'success' | 'error' | 'warning' | 'info') => void
  /**
   * The register is offline (AGL-3625). Every tender here is the server's —
   * the card reader, the typed card, the QR link, the gift card, the room
   * charge and this sale's own cash — so each is off until it returns.
   */
  offline?: boolean
  /** Rings this basket as an offline cash sale instead; offered while nothing is paid. */
  onSellOffline?: () => void
}

/**
 * Taking payment on an open sale (AGL-3607): the balance due, every payment
 * taken so far with its live status, and the tenders. A sale can take as many
 * payments as it needs; it is paid when the balance reaches zero, and only
 * then does the server take the stock and complete it.
 */
export function PosTenderPanel(props: PosTenderPanelProps) {
  const { user, hostId, sale, context, display, onSale, notify } = props
  const settings = context?.settings
  const [amount, setAmount] = useState('')
  const [tipCents, setTipCents] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'cash' | 'gift' | 'folio' | 'credit' | null>(null)
  // The store-credit provider whose dialog is open (AGL-3640).
  const [creditProvider, setCreditProvider] = useState<{ providerId: string; label: string; lookup: boolean } | null>(
    null,
  )
  const [qr, setQr] = useState<{ url: string; amountCents: number } | null>(null)
  const [keyed, setKeyed] = useState<{ clientSecret: string; amountCents: number; paymentId: string } | null>(
    null,
  )
  const [readerId, setReaderId] = useState('')
  const inFlight = useRef(false)
  const { confirm } = useConfirmationContext()
  const { onTipChange } = props
  useEffect(() => {
    onTipChange?.(tipCents)
  }, [onTipChange, tipCents])

  const readers = (context?.readers ?? []).filter(
    (reader) => !reader.registerId || reader.registerId === props.registerId,
  )
  useEffect(() => {
    if (!readerId && readers.length) {
      setReaderId(readers.find((reader) => reader.registerId === props.registerId)?.id ?? readers[0].id)
    }
  }, [readerId, readers, props.registerId])

  // The amount defaults to whatever is still open; a split is the cashier
  // typing less than that.
  const typedCents = centsFromInput(amount)
  const chargeCents = typedCents > 0 ? Math.min(typedCents, sale.tenderableCents) : sale.tenderableCents
  const paid = sale.status === 'paid'
  const offline = props.offline === true

  const run = useCallback(
    async (
      action: PosTenderAction,
      body: Record<string, unknown> = {},
      starts = false,
    ): Promise<PosTenderResult | null> => {
      if (inFlight.current) return null
      inFlight.current = true
      setBusy(true)
      try {
        const result = await posTender(
          user,
          hostId,
          sale.orderId,
          action,
          starts && props.cashierAssertion ? { ...body, cashierAssertion: props.cashierAssertion } : body,
          starts ? newAttemptKey() : undefined,
        )
        onSale(result.sale)
        if (starts) {
          setAmount('')
          setTipCents(0)
        }
        return result
      } catch (error) {
        notify(error instanceof PosRequestError ? error.message : 'Something went wrong', 'error')
        return null
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [user, hostId, sale.orderId, onSale, notify, props.cashierAssertion],
  )

  // Card payments still waiting are checked every two seconds: the reader,
  // the QR page and the typed card all settle on the server, and this is the
  // register's view of it (the webhook does the same thing when it lands).
  const pending = sale.payments.filter(
    (payment) => payment.status === 'pending' && CommerceModel.isCardPaymentMethod(payment.method),
  )
  const pendingKey = pending.map((payment) => payment.id).join(',')
  const latest = useRef({ user, onSale })
  latest.current = { user, onSale }
  useEffect(() => {
    if (!pendingKey) return undefined
    const timer = setInterval(async () => {
      for (const id of pendingKey.split(',')) {
        try {
          const result = await posTender(latest.current.user, hostId, sale.orderId, 'status', {
            paymentId: id,
          })
          latest.current.onSale(result.sale)
        } catch {
          // The next tick asks again.
        }
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [pendingKey, hostId, sale.orderId])

  // The display shows "tap your card" while a reader payment waits, and the
  // running balance otherwise.
  const readerWaiting = pending.some((payment) => payment.method === 'card_present')
  useEffect(() => {
    if (!display.connected || display.asking) return
    if (readerWaiting) {
      void display.show({ mode: 'processing', processing: { message: 'Tap, insert or swipe your card on the reader.' } })
    }
  }, [readerWaiting, display])

  const askTip = useCallback(async () => {
    const base = chargeCents
    if (!(base > 0) || !settings) return
    const answer = await display.ask({
      mode: 'tip',
      tip: { baseCents: base, percentages: settings.tipPercentages, allowCustom: true },
    })
    if (answer) {
      setTipCents(answer.tipCents ?? 0)
      notify(answer.tipCents ? `Tip: ${usd(answer.tipCents)}` : 'No tip', 'info')
    }
  }, [chargeCents, settings, display, notify])

  const startCardPresent = useCallback(async () => {
    if (!readerId) return
    await run('card-present', { amountCents: chargeCents, tipCents, readerId }, true)
  }, [run, chargeCents, tipCents, readerId])

  const startBridge = useCallback(async () => {
    const bridge = posNativeBridge()
    if (!bridge) return
    const amountCents = chargeCents
    const result = await run('card-present-sdk', { amountCents, tipCents }, true)
    if (!result?.paymentIntentId || !result.clientSecret || !result.paymentId) return
    try {
      const collected = await bridge.collectCardPayment({
        paymentIntentId: result.paymentIntentId,
        clientSecret: result.clientSecret,
        amountCents: amountCents + tipCents,
      })
      if (collected.status !== 'collected') {
        notify(collected.message ?? 'The card was not taken.', 'warning')
      }
    } finally {
      // Settled by the server either way: the status poll captures an
      // authorized tap and records a decline or a cancel.
      await run('status', { paymentId: result.paymentId })
    }
  }, [run, chargeCents, tipCents, notify])

  const startKeyed = useCallback(async () => {
    const amountCents = chargeCents
    const result = await run('card-keyed', { amountCents, tipCents }, true)
    if (result?.clientSecret && result.paymentId) {
      setKeyed({ clientSecret: result.clientSecret, amountCents: amountCents + tipCents, paymentId: result.paymentId })
    }
  }, [run, chargeCents, tipCents])

  const startLink = useCallback(async () => {
    const amountCents = chargeCents
    const result = await run('card-link', { amountCents, tipCents }, true)
    const url = result?.sale.payments.find((payment) => payment.id === result.paymentId)?.checkoutUrl
    if (url) setQr({ url, amountCents: amountCents + tipCents })
  }, [run, chargeCents, tipCents])

  const tipOn = Boolean(settings?.tippingEnabled) && !paid

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="h6">{paid ? 'Paid' : 'Balance due'}</Typography>
        <Typography variant="h4" component="p">
          {usd(paid ? sale.totalCents : sale.dueCents)}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {`Total ${usd(sale.totalCents)} · paid ${usd(sale.paidCents)}` +
          (sale.tipCents ? ` · tips ${usd(sale.tipCents)}` : '')}
      </Typography>

      {sale.payments.length ? (
        <Stack spacing={1} aria-label="Payments">
          {sale.payments.map((payment) => (
            <Box key={payment.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                {CommerceModel.describeOrderPayment({ ...payment, atMs: 0 })}
                {payment.changeCents ? ` · change ${usd(payment.changeCents)}` : ''}
              </Typography>
              <Chip size="small" label={STATUS_LABEL[payment.status]} color={STATUS_COLOR[payment.status]} />
              {payment.status === 'pending' && CommerceModel.isCardPaymentMethod(payment.method) ? (
                <>
                  {payment.method === 'card_link' && payment.checkoutUrl ? (
                    <Button
                      size="small"
                      onClick={() => setQr({ url: payment.checkoutUrl as string, amountCents: payment.amountCents })}
                    >
                      {'Show QR'}
                    </Button>
                  ) : null}
                  {payment.method === 'card_present' && payment.livemode === false && context?.terminal?.testMode ? (
                    <Button size="small" onClick={() => void run('simulate', { paymentId: payment.id })}>
                      {'Simulate tap'}
                    </Button>
                  ) : null}
                  <Button size="small" color="error" onClick={() => void run('cancel', { paymentId: payment.id })}>
                    {'Cancel'}
                  </Button>
                </>
              ) : null}
              {payment.status === 'failed' && payment.method === 'card_present' && !paid ? (
                <Button size="small" onClick={() => void run('retry', { paymentId: payment.id })}>
                  {'Retry'}
                </Button>
              ) : null}
              {payment.failureMessage && payment.status === 'failed' ? (
                <Typography variant="caption" color="error" sx={{ width: 1 }}>
                  {payment.failureMessage}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Stack>
      ) : null}

      {offline && !paid ? (
        <Alert
          severity="warning"
          action={
            props.onSellOffline && sale.payments.length === 0 ? (
              <Button color="inherit" size="small" onClick={props.onSellOffline}>
                {'Sell for cash offline'}
              </Button>
            ) : null
          }
        >
          {sale.payments.length === 0
            ? 'Offline: card readers, typed cards, the QR link, gift cards and room charges are off. ' +
              'Take this basket as an offline cash sale, or wait for the connection.'
            : 'Offline: this sale has a payment on it and finishes when the connection returns. ' +
              'Card readers, typed cards, the QR link, gift cards and room charges are off.'}
        </Alert>
      ) : null}
      {!paid ? (
        <>
          <Divider />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              label="Amount to charge ($)"
              placeholder={(sale.tenderableCents / 100).toFixed(2)}
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
              sx={{ flex: 1 }}
              helperText={
                typedCents > 0 && typedCents < sale.tenderableCents
                  ? `Split: ${usd(sale.tenderableCents - typedCents)} stays open`
                  : ' '
              }
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
          {tipOn ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <Typography variant="body2" sx={{ mr: 1 }}>
                {`Tip ${usd(tipCents)}`}
              </Typography>
              {display.connected ? (
                <Button
                  variant="outlined"
                  onClick={() => void askTip()}
                  disabled={offline || busy || Boolean(display.asking)}
                  sx={{ minHeight: POS_TOUCH_PX }}
                >
                  {display.asking === 'tip' ? 'Waiting for customer…' : 'Ask on display'}
                </Button>
              ) : null}
              {(settings?.tipPercentages ?? []).map((pct) => (
                <Button
                  key={pct}
                  variant={tipCents === CommerceModel.posTipFromPercent(chargeCents, pct) && tipCents > 0 ? 'contained' : 'outlined'}
                  onClick={() => setTipCents(CommerceModel.posTipFromPercent(chargeCents, pct))}
                  sx={{ minHeight: POS_TOUCH_PX }}
                >
                  {`${pct}%`}
                </Button>
              ))}
              <Button onClick={() => setTipCents(0)} sx={{ minHeight: POS_TOUCH_PX }}>
                {'No tip'}
              </Button>
            </Stack>
          ) : null}
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            }}
          >
            <Button
              variant="contained"
              disabled={offline || busy || chargeCents <= 0}
              onClick={() => setDialog('cash')}
              sx={{ minHeight: 56 }}
            >
              {'Cash'}
            </Button>
            {context?.terminal?.available && readers.length ? (
              <Button
                variant="contained"
                disabled={offline || busy || chargeCents <= 0 || !readerId}
                onClick={() => void startCardPresent()}
                sx={{ minHeight: 56 }}
              >
                {'Card reader'}
              </Button>
            ) : null}
            {posNativeBridge() ? (
              <Button
                variant="contained"
                disabled={offline || busy || chargeCents <= 0}
                onClick={() => void startBridge()}
                sx={{ minHeight: 56 }}
              >
                {'Tap to Pay / Bluetooth reader'}
              </Button>
            ) : null}
            {context?.publishableKey ? (
              <Button
                variant="outlined"
                disabled={offline || busy || chargeCents <= 0}
                onClick={() => void startKeyed()}
                sx={{ minHeight: 56 }}
              >
                {'Type card'}
              </Button>
            ) : null}
            <Button
              variant="outlined"
              disabled={offline || busy || chargeCents <= 0}
              onClick={() => void startLink()}
              sx={{ minHeight: 56 }}
            >
              {'Card (QR)'}
            </Button>
            <Button
              variant="outlined"
              disabled={offline || busy || chargeCents <= 0}
              onClick={() => setDialog('gift')}
              sx={{ minHeight: 56 }}
            >
              {'Gift card'}
            </Button>
            {(context?.credits ?? []).map((credit) => (
              <Button
                key={credit.providerId}
                variant="outlined"
                disabled={busy || chargeCents <= 0}
                onClick={() => {
                  setCreditProvider(credit)
                  setDialog('credit')
                }}
                sx={{ minHeight: 56 }}
              >
                {credit.label}
              </Button>
            ))}
            {props.stays.length ? (
              <Button
                variant="outlined"
                disabled={offline || busy || chargeCents <= 0}
                onClick={() => setDialog('folio')}
                sx={{ minHeight: 56 }}
              >
                {'Room'}
              </Button>
            ) : null}
          </Box>
          {context?.terminal?.available && readers.length > 1 ? (
            <TextField
              select
              size="small"
              label="Card reader"
              value={readerId}
              onChange={(event) => setReaderId(event.target.value)}
            >
              {readers.map((reader) => (
                <MenuItem key={reader.id} value={reader.id}>
                  {`${reader.label}${reader.status === 'online' ? '' : ' (offline)'}`}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {readers.some((reader) => reader.id === readerId && reader.status !== 'online') ? (
            <Alert severity="warning">{'The selected card reader looks offline.'}</Alert>
          ) : null}
          <Button
            color="error"
            disabled={offline || busy}
            onClick={async () => {
              const confirmed = await confirm({
                title: 'Void this sale?',
                description:
                  'Every payment taken on it is handed back: cards are refunded, gift ' +
                  'cards and store credit re-credited and room charges removed. Hand back any cash.',
                confirmationText: 'Void sale',
                confirmationButtonProps: { color: 'error' },
              })
                .then(() => true)
                .catch(() => false)
              if (!confirmed) return
              const result = await run('void')
              if (result) {
                notify('Sale voided', 'info')
                props.onVoided()
              }
            }}
            sx={{ minHeight: POS_TOUCH_PX, alignSelf: 'flex-start' }}
          >
            {'Void sale'}
          </Button>
        </>
      ) : null}

      <PosCashDialog
        open={dialog === 'cash'}
        dueCents={chargeCents}
        tipCents={tipCents}
        busy={busy}
        onClose={() => setDialog(null)}
        onTake={async (tenderedCents) => {
          const result = await run(
            'cash',
            {
              tenderedCents,
              ...(typedCents > 0 ? { amountCents: chargeCents } : {}),
              tipCents,
            },
            true,
          )
          if (result) {
            setDialog(null)
            const change = result.sale.payments.find((payment) => payment.id === result.paymentId)?.changeCents
            if (change) notify(`Change due: ${usd(change)}`, 'success')
          }
        }}
      />
      <PosGiftCardDialog
        open={dialog === 'gift'}
        busy={busy}
        onClose={() => setDialog(null)}
        onCheck={async (code) => {
          try {
            return await posGiftCardBalance(user, hostId, code)
          } catch (error) {
            notify(error instanceof PosRequestError ? error.message : 'Could not read that card', 'warning')
            return null
          }
        }}
        onApply={async (code) => {
          const result = await run('gift-card', { code, ...(typedCents > 0 ? { amountCents: chargeCents } : {}) }, true)
          if (result) setDialog(null)
        }}
      />
      <PosCreditDialog
        open={dialog === 'credit' && Boolean(creditProvider)}
        label={creditProvider?.label ?? 'Store credit'}
        canLookup={Boolean(creditProvider?.lookup)}
        busy={busy}
        onClose={() => setDialog(null)}
        onLookup={async (query) => {
          if (!creditProvider) return null
          try {
            return (await posCreditLookup(user, hostId, creditProvider.providerId, query)).accounts
          } catch (error) {
            notify(error instanceof PosRequestError ? error.message : 'Could not look that up', 'warning')
            return null
          }
        }}
        onApplyCode={async (code) => {
          const result = await run('credit', { code, ...(typedCents > 0 ? { amountCents: chargeCents } : {}) }, true)
          if (result) setDialog(null)
        }}
        onApplyAccount={async (account) => {
          if (!creditProvider) return
          const result = await run(
            'credit',
            {
              providerId: creditProvider.providerId,
              reference: account.reference,
              ...(typedCents > 0 ? { amountCents: chargeCents } : {}),
            },
            true,
          )
          if (result) setDialog(null)
        }}
      />
      <PosFolioDialog
        open={dialog === 'folio'}
        amountCents={chargeCents}
        stays={props.stays}
        busy={busy}
        onClose={() => setDialog(null)}
        onCharge={async (reservationId) => {
          const result = await run(
            'folio',
            { reservationId, ...(typedCents > 0 ? { amountCents: chargeCents } : {}) },
            true,
          )
          if (result) setDialog(null)
        }}
      />
      <PosQrDialog url={qr?.url ?? ''} amountCents={qr?.amountCents ?? 0} onClose={() => setQr(null)} />
      <PosKeyedCardDialog
        clientSecret={keyed?.clientSecret ?? ''}
        publishableKey={context?.publishableKey ?? ''}
        amountCents={keyed?.amountCents ?? 0}
        onClose={async () => {
          const open = keyed
          setKeyed(null)
          // Closing without paying releases the amount for another tender.
          if (open) await run('cancel', { paymentId: open.paymentId })
        }}
        onConfirmed={async () => {
          const open = keyed
          setKeyed(null)
          if (open) await run('status', { paymentId: open.paymentId })
        }}
      />
    </Stack>
  )
}
PosTenderPanel.displayName = 'PosTenderPanel'
