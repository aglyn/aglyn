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
import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Screen, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { formatBookingWhen } from '../lib/model/booking-time'
import {
  bookingQuery,
  bookingsKeys,
  bookingsSiteQuery,
  cancelBooking,
  formatUsd,
  servicesQuery,
  setCheckedIn,
} from './data/bookings'
import { formatTime } from './data/calendar'
import { type BookingsMobileContext, bookingsContextOf, errorText } from './data/context'
import { RescheduleSheet } from './reschedule-sheet'
import { BookingPill, confirmAction, Fact, showError } from './ui'

/*
 * One booking (AGL-3621): who, when, what they paid, and what the front desk
 * does with it — check the guest in, move it, cancel it. Each action is
 * offered from the same pure rule the route asks again in its transaction,
 * so a stale screen can offer only what the route then refuses.
 */

export function BookingDetailPanel({
  context,
  bookings,
  bookingId,
}: {
  context: MobilePluginContext
  bookings: BookingsMobileContext
  bookingId: string
}) {
  const theme = useMobileTheme()
  const client = useQueryClient()
  const booking = useQuery(bookingQuery(bookings, bookingId))
  const site = useQuery(bookingsSiteQuery(bookings))
  const services = useQuery(servicesQuery(bookings))
  const [moving, setMoving] = useState(false)

  const refresh = () => client.invalidateQueries({ queryKey: bookingsKeys.all(bookings.hostId) })
  const checkIn = useMutation({
    mutationFn: (checkedIn: boolean) => setCheckedIn(bookings, bookingId, checkedIn),
    onSuccess: () => refresh(),
    onError: (error) => showError('That did not go through', errorText(error)),
  })
  const cancel = useMutation({
    mutationFn: (row: NonNullable<typeof booking.data>) => cancelBooking(bookings, row),
    onSuccess: (result) => {
      void refresh()
      Alert.alert(
        'Booking canceled',
        result.refundedCents ? `${formatUsd(result.refundedCents)} is on its way back to the guest.` : 'The time is open again.',
      )
    },
    onError: (error) => showError('The booking was not canceled', errorText(error)),
  })

  const row = booking.data
  const timeZone = row?.timeZone ?? site.data?.timeZone ?? 'UTC'
  const service = useMemo(
    () => services.data?.find((entry) => entry.id === row?.serviceId)?.service ?? null,
    [services.data, row?.serviceId],
  )

  if (booking.isPending) {
    return (
      <Screen>
        <Skeleton height={120} />
        <Skeleton height={96} />
      </Screen>
    )
  }
  if (!row) {
    return (
      <Screen>
        <EmptyState
          icon="calendar-outline"
          title={booking.isError ? 'Could not load this booking' : 'This booking is gone'}
          body={booking.isError ? errorText(booking.error) : undefined}
          action={booking.isError ? <Button title="Try again" onPress={() => void booking.refetch()} /> : undefined}
        />
      </Screen>
    )
  }

  const { actions } = row
  const minutes = Math.max(0, Math.round((row.endsAtMs - row.startsAtMs) / 60_000))
  return (
    <Screen>
      <Card title={row.name}>
        <BookingPill row={row} />
        <Text variant="heading" testID="booking-when">
          {formatBookingWhen(row.startsAtMs, timeZone)}
        </Text>
        <Text tone="secondary">{`${row.serviceName} · ${minutes} min · ${timeZone}`}</Text>
        {row.checkedInAtMs ? (
          <Text tone="secondary" testID="booking-checked-in">{`Checked in at ${formatTime(row.checkedInAtMs, timeZone)}`}</Text>
        ) : null}
      </Card>

      <Card title="Guest">
        {row.email ? (
          <Button title={row.email} variant="text" icon="mail-outline" onPress={() => void Linking.openURL(`mailto:${row.email}`)} />
        ) : null}
        {row.phone ? (
          <Button title={row.phone} variant="text" icon="call-outline" onPress={() => void Linking.openURL(`tel:${row.phone}`)} />
        ) : null}
        {row.address ? (
          <Button
            title={row.address}
            variant="text"
            icon="navigate-outline"
            onPress={() => void Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(row.address ?? '')}`)}
          />
        ) : null}
      </Card>

      {row.paidCents ? (
        <Card title="Payment">
          <Fact label="Paid" value={formatUsd(row.paidCents)} />
          {row.refundedCents ? <Fact label="Refunded" value={`−${formatUsd(row.refundedCents)}`} /> : null}
        </Card>
      ) : null}

      <View style={{ gap: theme.space(1) }}>
        {actions.checkIn ? (
          <Button
            testID="booking-check-in"
            title="Check in"
            icon="checkmark-circle-outline"
            busy={checkIn.isPending}
            onPress={() => checkIn.mutate(true)}
          />
        ) : null}
        {actions.undoCheckIn ? (
          <Button
            testID="booking-undo-check-in"
            title="Undo check-in"
            variant="text"
            icon="arrow-undo-outline"
            busy={checkIn.isPending}
            onPress={() => checkIn.mutate(false)}
          />
        ) : null}
        {actions.reschedule ? (
          <Button testID="booking-move" title="Move" variant="outlined" icon="swap-horizontal-outline" onPress={() => setMoving(true)} />
        ) : null}
        {actions.cancel ? (
          <Button
            testID="booking-cancel"
            title={actions.refundCents ? 'Cancel and refund' : 'Cancel booking'}
            variant="text"
            icon="close-circle-outline"
            busy={cancel.isPending}
            onPress={async () => {
              const yes = await confirmAction({
                title: 'Cancel this booking?',
                body:
                  `${row.name}'s time opens up again.` +
                  (actions.refundCents ? ` ${formatUsd(actions.refundCents)} is refunded to them.` : ''),
                confirm: actions.refundCents ? 'Cancel and refund' : 'Cancel booking',
                destructive: true,
              })
              if (yes) cancel.mutate(row)
            }}
          />
        ) : null}
        <Button
          title="Open in the console"
          variant="text"
          icon="open-outline"
          onPress={() => context.openConsolePath('/bookings', 'site')}
        />
      </View>

      <RescheduleSheet
        visible={moving}
        bookings={bookings}
        booking={row}
        service={service}
        timeZone={timeZone}
        onClose={() => setMoving(false)}
        onDone={() => {
          setMoving(false)
          void refresh()
        }}
      />
    </Screen>
  )
}

/** The booking on its own screen, as a phone opens it from the calendar or a notification. */
export default function BookingScreen({ context, params }: MobileScreenProps) {
  const bookings = useMemo(() => bookingsContextOf(context), [context])
  const bookingId = params['bookingId']
  if (!bookings || !bookingId) return <EmptyState icon="calendar-outline" title="This booking could not be opened" />
  return <BookingDetailPanel context={context} bookings={bookings} bookingId={bookingId} />
}
