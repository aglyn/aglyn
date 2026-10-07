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

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, ListRow, Notice, Screen, Skeleton, SplitView, Text, TextField, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Firestore } from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { takeBookingPayment } from './in-person-payment-client'
import { centsFromText, type CounterBooking, formatUsd, loadCounterBookings } from './today-bookings'

/*==========================================
 * TODAY'S BOOKINGS AT THE COUNTER (AGL-3618), Aglyn POS's Bookings tab.
 *
 * The day's appointments, earliest first. One that is still to pay opens a
 * charge panel: the amount (the service's fixed price when it has one, or
 * whatever staff type for a price that varies), then the card on this
 * device's reader. The server prices the tax, makes the payment and records
 * it on the booking; this screen only presents the card.
 *=========================================*/

const STATE_LABEL: Record<CounterBooking['state'], string> = {
  paid: 'Paid',
  canceled: 'Canceled',
  'awaiting-online': 'Paying online',
  collecting: 'Card in progress',
  payable: 'To pay',
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function newAttemptKey(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `booking-pos:${random}`
}

export default function BookingsTodayScreen({ context }: MobileScreenProps) {
  const layout = useLayout()
  const hostId = context.hostId
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const bookings = useQuery({
    queryKey: ['bookings', hostId, 'pos', 'today'],
    queryFn: () => loadCounterBookings(context.firestore as Firestore, hostId!),
    enabled: Boolean(hostId),
    refetchInterval: 60_000,
  })
  if (!hostId) return <EmptyState icon="calendar-outline" title="Choose a store" />
  const list = bookings.data ?? []
  const selected = list.find((entry) => entry.id === selectedId) ?? null

  const listView = (
    <Screen padded={false}>
      {context.online === false ? (
        <View style={{ padding: 8 }}>
          <Notice tone="warning" message="Offline. Bookings refresh and payments resume when the connection is back." />
        </View>
      ) : null}
      {bookings.isPending ? (
        <View style={{ padding: 16, gap: 8 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      ) : bookings.isError ? (
        <View style={{ padding: 16 }}>
          <Notice tone="error" message="Today’s bookings could not be loaded." action={{ label: 'Retry', onPress: () => void bookings.refetch() }} />
        </View>
      ) : !list.length ? (
        <EmptyState icon="calendar-outline" title="No bookings today" />
      ) : (
        list.map((booking) => (
          <ListRow
            key={booking.id}
            testID={`booking-${booking.id}`}
            title={`${time(booking.startsAtMs)} · ${booking.name}`}
            subtitle={`${booking.serviceName} · ${STATE_LABEL[booking.state]}${
              booking.state === 'paid' && booking.paidAmountCents ? ` ${formatUsd(booking.paidAmountCents)}` : ''
            }`}
            icon={booking.state === 'paid' ? 'checkmark-circle-outline' : 'time-outline'}
            selected={booking.id === selectedId}
            onPress={() => setSelectedId(booking.id)}
          />
        ))
      )}
    </Screen>
  )

  const detail = selected ? (
    <ChargePanel
      key={selected.id}
      booking={selected}
      context={context}
      hostId={hostId}
      onDone={() => {
        void bookings.refetch()
      }}
      onClose={() => setSelectedId(null)}
    />
  ) : (
    <EmptyState icon="card-outline" title="Pick a booking" body="Choose one to take its payment." />
  )

  if (layout.split) return <SplitView list={listView} detail={detail} listWidth={380} />
  return (
    <>
      {listView}
      <Modal visible={Boolean(selected)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedId(null)}>
        <SafeAreaView style={{ flex: 1 }}>{detail}</SafeAreaView>
      </Modal>
    </>
  )
}

function ChargePanel(props: {
  booking: CounterBooking
  context: MobileScreenProps['context']
  hostId: string
  onDone: () => void
  onClose: () => void
}) {
  const theme = useMobileTheme()
  const client = useQueryClient()
  const { booking, context } = props
  const reader = context.cardReader ?? null
  const [amount, setAmount] = useState(booking.suggestedCents ? (booking.suggestedCents / 100).toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [priced, setPriced] = useState<{ amountCents: number; taxCents: number } | null>(null)
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const attempt = useRef<string | null>(null)
  useEffect(() => {
    attempt.current = null
  }, [amount])

  const serviceCents = centsFromText(amount)
  const offline = context.online === false

  const charge = async () => {
    if (!reader || serviceCents === null) return
    if (!reader.state.connected) {
      reader.manage()
      return
    }
    attempt.current = attempt.current ?? newAttemptKey()
    setBusy(true)
    setResult(null)
    try {
      const outcome = await takeBookingPayment({
        api: context.api,
        reader,
        hostId: props.hostId,
        bookingId: booking.id,
        serviceCents,
        attemptKey: attempt.current,
        onPriced: setPriced,
      })
      if (outcome.status === 'paid') {
        attempt.current = null
        setResult({ tone: 'success', message: `Paid ${formatUsd(outcome.amountCents)}.` })
        await client.invalidateQueries({ queryKey: ['bookings', props.hostId] })
        props.onDone()
      } else if (outcome.status === 'canceled') {
        attempt.current = null
        setResult({ tone: 'warning', message: 'The payment was canceled. Nobody was charged.' })
      } else {
        attempt.current = null
        setResult({ tone: 'error', message: outcome.message })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space(2), gap: theme.space(2) }} testID="booking-charge">
      <Card
        title={booking.name}
        actions={<Button title="Close" variant="text" onPress={props.onClose} />}
      >
        <Text tone="secondary">
          {booking.serviceName} · {time(booking.startsAtMs)}
        </Text>
        <Text variant="label">{STATE_LABEL[booking.state]}</Text>
      </Card>
      {booking.state === 'collecting' ? (
        <Notice
          tone="warning"
          message="A card payment was started for this booking and not finished. Charging again releases it first."
        />
      ) : null}
      {booking.state === 'payable' || booking.state === 'collecting' ? (
        <Card title="Take payment">
          <TextField
            label="Amount for the service, before tax"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
          />
          {priced ? (
            <Text tone="secondary">
              Charging {formatUsd(priced.amountCents)}
              {priced.taxCents ? `, ${formatUsd(priced.taxCents)} of it tax` : ''}.
            </Text>
          ) : null}
          {reader ? (
            <Button
              testID="booking-charge-card"
              title={reader.state.connected ? `Charge on ${reader.state.label ?? 'the card reader'}` : 'Connect a card reader'}
              icon="card-outline"
              busy={busy}
              disabled={offline || (reader.state.connected && serviceCents === null)}
              onPress={() => void charge()}
            />
          ) : (
            <Notice tone="info" message="Card payments for bookings are taken on Aglyn POS with a card reader." />
          )}
          {busy && reader?.state.prompt ? <Text tone="secondary">{reader.state.prompt}</Text> : null}
        </Card>
      ) : null}
      {result ? <Notice tone={result.tone} message={result.message} testID="booking-result" /> : null}
    </ScrollView>
  )
}
