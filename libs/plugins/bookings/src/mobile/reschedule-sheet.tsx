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
import { Button, EmptyState, Sheet, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import type { HostBookingService } from '../lib/model/bookings'
import { type BookingRow, openSlotsQuery, rescheduleBooking } from './data/bookings'
import { formatDay, formatTime } from './data/calendar'
import { type BookingsMobileContext, errorText } from './data/context'
import { Chips, showError } from './ui'

/*
 * Moving a booking (AGL-3621): the open times of its service, a day at a
 * time, with the booking's own time counted as free. The route checks the
 * chosen time again in a transaction and tells the guest by email.
 */

export function RescheduleSheet({
  visible,
  bookings,
  booking,
  service,
  timeZone,
  onClose,
  onDone,
}: {
  visible: boolean
  bookings: BookingsMobileContext
  booking: BookingRow
  service: HostBookingService | null
  timeZone: string
  onClose: () => void
  onDone: () => void
}) {
  const theme = useMobileTheme()
  const [fromMs, setFromMs] = useState(0)
  const [day, setDay] = useState<string>('')
  const [picked, setPicked] = useState<number | null>(null)
  const slots = useQuery({ ...openSlotsQuery(bookings, { booking, service, fromMs }), enabled: visible && Boolean(service) })

  useEffect(() => {
    if (!visible) return
    setFromMs(0)
    setPicked(null)
    setDay('')
  }, [visible])

  const days = useMemo(() => {
    const byDay = new Map<string, number[]>()
    for (const slot of slots.data?.slots ?? []) {
      const key = formatDay(slot.startsAtMs, timeZone)
      byDay.set(key, [...(byDay.get(key) ?? []), slot.startsAtMs])
    }
    return [...byDay.entries()].map(([label, starts]) => ({ id: label, label, starts }))
  }, [slots.data, timeZone])
  const current = days.find((entry) => entry.id === day) ?? days[0]

  const move = useMutation({
    mutationFn: (startsAtMs: number) => rescheduleBooking(bookings, booking.id, startsAtMs),
    onSuccess: (result) => {
      onDone()
      Alert.alert(
        'Booking moved',
        result.notified ? `${booking.name} was emailed the new time.` : `Let ${booking.name} know the new time; no email went out.`,
      )
    },
    onError: (error) => showError('The booking did not move', errorText(error)),
  })

  return (
    <Sheet visible={visible} onClose={onClose} title="Move booking">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        <Text tone="secondary">
          {`${booking.serviceName} with ${booking.name}, now ${formatDay(booking.startsAtMs, timeZone)} at ${formatTime(booking.startsAtMs, timeZone)}.`}
        </Text>
        {!service ? (
          <EmptyState icon="alert-circle-outline" title="This booking’s service is gone" body="A booking moves within its service’s hours." />
        ) : slots.isPending ? (
          <View style={{ gap: theme.space(1) }}>
            <Skeleton height={32} />
            <Skeleton height={96} />
          </View>
        ) : slots.isError ? (
          <EmptyState icon="warning-outline" title="Could not load open times" body={errorText(slots.error)} />
        ) : !days.length ? (
          <EmptyState icon="calendar-outline" title="No open times in these two weeks" />
        ) : (
          <View style={{ gap: theme.space(1.5) }}>
            <View style={{ marginHorizontal: -theme.space(2) }}>
              <Chips
                testID="reschedule-day"
                options={days}
                value={current?.id ?? ''}
                onChange={(next) => {
                  setDay(next)
                  setPicked(null)
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
              {(current?.starts ?? []).map((startsAtMs) => {
                const selected = startsAtMs === picked
                return (
                  <Pressable
                    key={startsAtMs}
                    testID={`slot-${startsAtMs}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPicked(startsAtMs)}
                    style={{
                      minWidth: 88,
                      paddingVertical: theme.space(1),
                      paddingHorizontal: theme.space(1.5),
                      borderWidth: 1,
                      borderRadius: theme.radius,
                      alignItems: 'center',
                      borderColor: selected ? theme.colors.primary.main : theme.colors.divider,
                      backgroundColor: selected ? theme.colors.primary.main : theme.colors.background.paper,
                    }}
                  >
                    <Text tone={selected ? 'inverse' : 'primary'}>{formatTime(startsAtMs, timeZone)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )}
        {slots.data?.nextFromMs ? (
          <Button
            testID="reschedule-later"
            title="Later dates"
            variant="text"
            icon="arrow-forward-outline"
            onPress={() => {
              setFromMs(slots.data?.nextFromMs ?? 0)
              setDay('')
              setPicked(null)
            }}
          />
        ) : null}
        <Button
          testID="reschedule-confirm"
          title={picked ? `Move to ${formatDay(picked, timeZone)}, ${formatTime(picked, timeZone)}` : 'Pick a new time'}
          icon="swap-horizontal-outline"
          disabled={!picked}
          busy={move.isPending}
          onPress={() => picked && move.mutate(picked)}
        />
      </View>
    </Sheet>
  )
}
