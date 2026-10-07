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
import type { MobileWidgetProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { View } from 'react-native'
import { bookingsRangeQuery, bookingsSiteQuery } from './data/bookings'
import { calendarRange, formatTime } from './data/calendar'
import { type BookingsMobileContext, bookingsContextOf, nowOf } from './data/context'
import { BOOKINGS_BOOKING_SCREEN, BOOKINGS_CALENDAR_SCREEN } from './screen-ids'

/*
 * Today's bookings on the app's home (AGL-3621): how many, how many are in,
 * and who is next, each opening the screen that answers the next question.
 */

export default function TodayBookingsWidget({ context }: MobileWidgetProps) {
  const bookings = useMemo(() => bookingsContextOf(context), [context])
  if (!bookings) return null
  return <TodayCard context={context} bookings={bookings} />
}

function TodayCard({ context, bookings }: MobileWidgetProps & { bookings: BookingsMobileContext }) {
  const theme = useMobileTheme()
  const site = useQuery(bookingsSiteQuery(bookings))
  const timeZone = site.data?.timeZone ?? 'UTC'
  const range = useMemo(() => calendarRange('day', nowOf(bookings), timeZone), [bookings, timeZone])
  const today = useQuery({
    ...bookingsRangeQuery(bookings, { fromMs: range.fromMs, toMs: range.toMs }),
    enabled: site.isSuccess,
  })
  const live = (today.data?.rows ?? []).filter((row) => row.state === 'confirmed')
  const checkedIn = live.filter((row) => row.checkedInAtMs).length
  const nowMs = nowOf(bookings)
  const next = live.find((row) => !row.checkedInAtMs && row.endsAtMs > nowMs)

  return (
    <Card title="Bookings today">
      {!today.data ? (
        <Skeleton height={56} />
      ) : (
        <View style={{ gap: theme.space(0.5) }}>
          <Text variant="title" testID="bookings-today-count">
            {String(live.length)}
          </Text>
          <Text tone="secondary">{live.length ? `${checkedIn} checked in` : 'Nothing booked today'}</Text>
          {next ? (
            <Button
              testID="bookings-today-next"
              title={`Next: ${formatTime(next.startsAtMs, timeZone)} ${next.name}`}
              variant="text"
              icon="person-outline"
              onPress={() => context.navigate(BOOKINGS_BOOKING_SCREEN, { bookingId: next.id })}
            />
          ) : null}
          <Button
            testID="bookings-today-open"
            title="Open calendar"
            variant="text"
            icon="calendar-outline"
            onPress={() => context.navigate(BOOKINGS_CALENDAR_SCREEN, { view: 'day' })}
          />
        </View>
      )}
    </Card>
  )
}
