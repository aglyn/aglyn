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

import type { MobileApiClient, MobileCardReader } from '@aglyn/mobile-plugin-host'
import { Button, Card, Notice, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { newAttemptKey } from '../data/context'
import type { PosContext, PosOpenedSale, PosSale, PosSmartReader } from './sale-api'
import { salePayment } from './sale-api'
import {
  cancelCardPayment,
  cashQuickAmounts,
  centsFromText,
  payCash,
  payWithDeviceReader,
  pollSmartReader,
  startSmartReader,
  type TenderOutcome,
  tipChoices,
} from './tender'

/*==========================================
 * CHECKOUT (AGL-3618).
 *
 * The server has priced the sale; this takes the money. A tip first when the
 * store asks for one, then a tender: this phone's own reader (Tap to Pay or a
 * Bluetooth reader), a smart reader on the counter, or cash. A tender may
 * cover part of the balance (a split), and the sale stays open until the
 * balance is zero. Then the receipt, by email or text.
 *
 * Each tender press mints ONE attempt key and keeps it until an answer
 * arrives, so pressing again after a dropped connection resumes the same
 * payment instead of starting a second.
 *=========================================*/

type Step =
  | { kind: 'tender' }
  | { kind: 'cash' }
  | { kind: 'device'; label: string }
  | { kind: 'smart'; reader: PosSmartReader; paymentId: string | null }
  | { kind: 'receipt'; changeCents: number }

export interface CheckoutProps {
  api: MobileApiClient
  hostId: string
  opened: PosOpenedSale
  context: PosContext | null
  cardReader: MobileCardReader | null | undefined
  online: boolean
  money: (cents: number) => string
  customerEmail: string
  /** The sale is paid and the receipt chosen: start the next one. */
  onFinished: () => void
  /** The sale was voided; the basket stays for another try. */
  onVoided: () => void
}

function saleFromOpened(opened: PosOpenedSale): PosSale {
  return {
    orderId: opened.orderId,
    status: 'pending',
    totalCents: opened.totals.totalCents,
    paidCents: 0,
    dueCents: opened.dueCents,
    tenderableCents: opened.dueCents,
    tipCents: 0,
    payments: [],
  }
}

export function Checkout(props: CheckoutProps) {
  const theme = useMobileTheme()
  const [sale, setSale] = useState<PosSale>(() => saleFromOpened(props.opened))
  const [step, setStep] = useState<Step>({ kind: 'tender' })
  const [tipCents, setTipCents] = useState(0)
  const [tipId, setTipId] = useState('none')
  const [customTip, setCustomTip] = useState('')
  const [partText, setPartText] = useState('')
  const [cashText, setCashText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning' | 'success'; message: string } | null>(null)
  const [lost, setLost] = useState(false)
  const [receiptTo, setReceiptTo] = useState(props.customerEmail)
  const [receiptPhone, setReceiptPhone] = useState('')
  /** The key of the tender in flight, kept until an answer arrives. */
  const attempt = useRef<{ tender: string; key: string } | null>(null)

  const deps = useMemo(
    () => ({ api: props.api, hostId: props.hostId, orderId: props.opened.orderId }),
    [props.api, props.hostId, props.opened.orderId],
  )
  const due = sale.tenderableCents
  const partCents = centsFromText(partText)
  const amountCents = partCents && partCents > 0 && partCents < due ? partCents : due
  const settings = props.context?.settings
  const tips = settings?.tippingEnabled ? tipChoices(amountCents, settings.tipPercentages) : []
  const opened = props.opened.totals

  const keyFor = (tender: string): string => {
    if (attempt.current?.tender !== tender) attempt.current = { tender, key: newAttemptKey('pos-app') }
    return attempt.current.key
  }

  /** Applies one tender's outcome to the sale and the screen. */
  const apply = useCallback(
    (outcome: TenderOutcome, changeCents = 0) => {
      if (outcome.kind === 'unknown') {
        setLost(true)
        setNotice({ tone: 'warning', message: outcome.message })
        return
      }
      attempt.current = null
      setLost(false)
      if (outcome.answer) setSale(outcome.answer.sale)
      if (outcome.kind === 'settled') {
        const completed = outcome.answer.completed || outcome.answer.sale.dueCents <= 0
        const change = outcome.payment?.changeCents ?? changeCents
        setTipCents(0)
        setTipId('none')
        setPartText('')
        setCashText('')
        if (completed) {
          setNotice(null)
          setStep({ kind: 'receipt', changeCents: change })
        } else {
          setNotice({
            tone: 'success',
            message: `Paid ${props.money(outcome.payment?.amountCents ?? 0)}. ${props.money(
              outcome.answer.sale.dueCents,
            )} is left to pay.`,
          })
          setStep({ kind: 'tender' })
        }
        return
      }
      setStep({ kind: 'tender' })
      setNotice(
        outcome.kind === 'canceled'
          ? { tone: 'warning', message: 'The payment was canceled. Nobody was charged.' }
          : { tone: 'error', message: outcome.message },
      )
    },
    [props],
  )

  const recheck = useCallback(async () => {
    setBusy(true)
    try {
      const answer = await salePayment({ ...deps, step: { action: 'sale' } })
      setSale(answer.sale)
      setLost(false)
      setNotice(null)
      if (answer.completed || answer.sale.status === 'paid') {
        attempt.current = null
        setStep({ kind: 'receipt', changeCents: 0 })
      }
    } catch {
      setNotice({ tone: 'warning', message: 'Still offline. The sale is safe; check it again when you reconnect.' })
    } finally {
      setBusy(false)
    }
  }, [deps])

  const payOnDevice = async () => {
    const reader = props.cardReader
    if (!reader) return
    if (!reader.state.connected) {
      reader.manage()
      return
    }
    setBusy(true)
    setNotice(null)
    setStep({ kind: 'device', label: reader.state.label ?? 'the card reader' })
    try {
      apply(
        await payWithDeviceReader({
          ...deps,
          reader,
          amountCents,
          tipCents,
          attemptKey: keyFor(`device:${amountCents}:${tipCents}`),
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const payOnSmartReader = async (reader: PosSmartReader) => {
    setBusy(true)
    setNotice(null)
    try {
      const started = await startSmartReader({
        ...deps,
        readerId: reader.id,
        amountCents,
        tipCents,
        attemptKey: keyFor(`smart:${reader.id}:${amountCents}:${tipCents}`),
      })
      if (started.kind === 'waiting') {
        setSale(started.answer.sale)
        setStep({ kind: 'smart', reader, paymentId: started.paymentId })
      } else {
        apply(started)
      }
    } finally {
      setBusy(false)
    }
  }

  // A smart reader answers through the server: read it until it does.
  const smartPaymentId = step.kind === 'smart' ? step.paymentId : null
  useEffect(() => {
    if (!smartPaymentId) return
    let active = true
    const timer = setInterval(async () => {
      const outcome = await pollSmartReader(deps, smartPaymentId)
      if (active && outcome) {
        clearInterval(timer)
        apply(outcome)
      }
    }, 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [apply, deps, smartPaymentId])

  const payWithCash = async (tenderedCents: number) => {
    setBusy(true)
    setNotice(null)
    try {
      apply(
        await payCash({
          ...deps,
          tenderedCents,
          tipCents,
          ...(amountCents < due ? { amountCents } : {}),
          attemptKey: keyFor(`cash:${tenderedCents}:${amountCents}:${tipCents}`),
        }),
        Math.max(0, tenderedCents - amountCents - tipCents),
      )
    } finally {
      setBusy(false)
    }
  }

  const voidSale = async () => {
    setBusy(true)
    try {
      await salePayment({ ...deps, step: { action: 'void' } })
      props.onVoided()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The sale could not be canceled.' })
    } finally {
      setBusy(false)
    }
  }

  const sendReceipt = async (channel: 'email' | 'sms' | 'none') => {
    if (channel === 'none') {
      // The sale is paid; "no receipt" is a note, never a reason to hold the
      // next customer when the network is down.
      void salePayment({ ...deps, step: { action: 'receipt', channel } }).catch(() => undefined)
      props.onFinished()
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await salePayment({
        ...deps,
        step: { action: 'receipt', channel, to: channel === 'email' ? receiptTo.trim() : receiptPhone.trim() },
      })
      props.onFinished()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The receipt could not be sent.' })
    } finally {
      setBusy(false)
    }
  }

  const row = (label: string, value: string, strong = false) => (
    <View style={styles.row} key={label}>
      <Text variant={strong ? 'label' : 'body'} tone={strong ? 'primary' : 'secondary'} style={styles.flex}>
        {label}
      </Text>
      <Text variant={strong ? 'heading' : 'body'}>{value}</Text>
    </View>
  )

  const reader = props.cardReader
  const smartReaders = (props.context?.readers ?? []).filter((entry) => entry.status === 'online')
  const offline = !props.online

  return (
    <ScrollView
      testID="pos-checkout"
      contentContainerStyle={{ padding: theme.space(2), gap: theme.space(2) }}
      keyboardShouldPersistTaps="handled"
    >
      <Card title={step.kind === 'receipt' ? 'Paid' : 'Total due'}>
        {opened.subtotalCents !== undefined ? row('Subtotal', props.money(opened.subtotalCents)) : null}
        {opened.discountCents ? row('Discount', `−${props.money(opened.discountCents)}`) : null}
        {opened.taxCents !== undefined ? row('Tax', props.money(opened.taxCents)) : null}
        {row('Total', props.money(sale.totalCents), true)}
        {sale.paidCents ? row('Paid', props.money(sale.paidCents)) : null}
        {sale.tipCents ? row('Tips', props.money(sale.tipCents)) : null}
        {step.kind !== 'receipt' && sale.paidCents ? row('Left to pay', props.money(due), true) : null}
        {props.context?.testMode ? (
          <Notice tone="warning" message="Test mode: use a test card or a simulated reader. Nobody is charged." />
        ) : null}
      </Card>

      {offline ? (
        <Notice
          tone="warning"
          testID="checkout-offline"
          message="No connection. The sale is kept; take payment when the device is back online."
        />
      ) : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} testID="checkout-notice" /> : null}
      {lost ? <Button title="Check the sale" variant="outlined" icon="refresh" busy={busy} onPress={() => void recheck()} /> : null}

      {step.kind === 'tender' ? (
        <>
          {tips.length ? (
            <Card title="Tip">
              <View style={[styles.wrap, { gap: theme.space(1) }]}>
                {tips.map((choice) => (
                  <Button
                    key={choice.id}
                    testID={`tip-${choice.id}`}
                    title={choice.cents ? `${choice.label} · ${props.money(choice.cents)}` : choice.label}
                    variant={tipId === choice.id ? 'contained' : 'outlined'}
                    onPress={() => {
                      setTipId(choice.id)
                      setTipCents(choice.cents)
                      setCustomTip('')
                    }}
                  />
                ))}
              </View>
              <TextField
                label="Another amount"
                keyboardType="decimal-pad"
                value={customTip}
                placeholder="0.00"
                onChangeText={(text) => {
                  setCustomTip(text)
                  const cents = centsFromText(text)
                  setTipId('custom')
                  setTipCents(cents ?? 0)
                }}
              />
            </Card>
          ) : null}

          <Card title={`Charge ${props.money(amountCents + tipCents)}`}>
            {reader ? (
              <Button
                testID="tender-device"
                title={
                  reader.state.connected
                    ? `${reader.state.kind === 'tapToPay' ? 'Tap to Pay' : 'Card reader'} · ${props.money(amountCents + tipCents)}`
                    : 'Connect a card reader'
                }
                icon={reader.state.kind === 'tapToPay' ? 'phone-portrait-outline' : 'card-outline'}
                disabled={offline || busy}
                onPress={() => void payOnDevice()}
              />
            ) : null}
            {smartReaders.map((entry) => (
              <Button
                key={entry.id}
                testID={`tender-smart-${entry.id}`}
                title={`Send to ${entry.label}`}
                variant="outlined"
                icon="hardware-chip-outline"
                disabled={offline || busy}
                onPress={() => void payOnSmartReader(entry)}
              />
            ))}
            <Button
              testID="tender-cash"
              title="Cash"
              variant="outlined"
              icon="cash-outline"
              disabled={offline || busy}
              onPress={() => setStep({ kind: 'cash' })}
            />
            <TextField
              label={`Charge part of it (split). Leave empty for ${props.money(due)}.`}
              keyboardType="decimal-pad"
              value={partText}
              placeholder={(due / 100).toFixed(2)}
              onChangeText={setPartText}
            />
          </Card>
          {!sale.paidCents ? (
            <Button title="Cancel sale" variant="text" disabled={busy || offline} onPress={() => void voidSale()} />
          ) : null}
        </>
      ) : null}

      {step.kind === 'cash' ? (
        <Card title={`Cash · ${props.money(amountCents + tipCents)} due`}>
          <View style={[styles.wrap, { gap: theme.space(1) }]}>
            {cashQuickAmounts(amountCents + tipCents).map((cents) => (
              <Button
                key={cents}
                testID={`cash-${cents}`}
                title={props.money(cents)}
                variant="outlined"
                disabled={busy || offline}
                onPress={() => void payWithCash(cents)}
              />
            ))}
          </View>
          <TextField
            label="Cash received"
            keyboardType="decimal-pad"
            value={cashText}
            placeholder="0.00"
            onChangeText={setCashText}
          />
          {centsFromText(cashText) !== null && (centsFromText(cashText) ?? 0) >= amountCents + tipCents ? (
            <Text variant="label">Change: {props.money((centsFromText(cashText) ?? 0) - amountCents - tipCents)}</Text>
          ) : null}
          <Button
            testID="cash-take"
            title="Take cash"
            busy={busy}
            disabled={offline || (centsFromText(cashText) ?? 0) < amountCents + tipCents}
            onPress={() => void payWithCash(centsFromText(cashText) ?? 0)}
          />
          <Button title="Back" variant="text" onPress={() => setStep({ kind: 'tender' })} />
        </Card>
      ) : null}

      {step.kind === 'device' ? (
        <Card title={`Present the card · ${props.money(amountCents + tipCents)}`}>
          <ActivityIndicator />
          <Text tone="secondary" style={styles.center}>
            {reader?.state.prompt ?? `Waiting for ${step.label}.`}
          </Text>
          <Button title="Cancel" variant="outlined" onPress={() => void reader?.cancel()} />
        </Card>
      ) : null}

      {step.kind === 'smart' ? (
        <Card title={`On ${step.reader.label}`}>
          <ActivityIndicator />
          <Text tone="secondary" style={styles.center}>
            The customer pays on the reader.
          </Text>
          {props.context?.testMode && step.paymentId ? (
            <Button
              title="Simulate a tap (test mode)"
              variant="outlined"
              onPress={() =>
                void salePayment({ ...deps, step: { action: 'simulate', paymentId: step.paymentId! } }).catch(() => undefined)
              }
            />
          ) : null}
          <Button
            title="Cancel"
            variant="text"
            onPress={() => {
              if (step.paymentId) void cancelCardPayment(deps, step.paymentId)
              setStep({ kind: 'tender' })
            }}
          />
        </Card>
      ) : null}

      {step.kind === 'receipt' ? (
        <Card title="Receipt">
          {step.changeCents > 0 ? (
            <Text variant="heading" testID="checkout-change">
              Change due: {props.money(step.changeCents)}
            </Text>
          ) : null}
          <TextField
            label="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={receiptTo}
            onChangeText={setReceiptTo}
            placeholder="customer@example.com"
          />
          <Button
            testID="receipt-email"
            title="Email the receipt"
            busy={busy}
            disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(receiptTo.trim()) || offline}
            onPress={() => void sendReceipt('email')}
          />
          {props.context?.smsReceipts ? (
            <>
              <TextField
                label="Mobile number"
                keyboardType="phone-pad"
                autoComplete="tel"
                value={receiptPhone}
                onChangeText={setReceiptPhone}
                placeholder="+1 555 123 4567"
              />
              <Button
                testID="receipt-sms"
                title="Text the receipt"
                variant="outlined"
                busy={busy}
                disabled={receiptPhone.replace(/\D/g, '').length < 7 || offline}
                onPress={() => void sendReceipt('sms')}
              />
            </>
          ) : null}
          <Button testID="receipt-none" title="No receipt" variant="text" onPress={() => void sendReceipt('none')} />
        </Card>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  center: { textAlign: 'center' },
})
