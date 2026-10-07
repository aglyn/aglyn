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
import { Button, EmptyState, ListRow, Skeleton, SplitView, Text, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { RefreshControl, SectionList, Share, View } from 'react-native'
import { BookingDetailPanel } from './booking-detail'
import {
  type BookingRow,
  bookingsRangeQuery,
  bookingsSiteQuery,
  bookingSubtitle,
  serviceBookingLink,
  servicesQuery,
} from './data/bookings'
import {
  CALENDAR_VIEWS,
  calendarRange,
  type CalendarView,
  formatDay,
  formatTime,
  groupByDay,
  rangeHolds,
  rangeTitle,
  shiftAnchor,
} from './data/calendar'
import { type BookingsMobileContext, bookingsContextOf, errorText, nowOf } from './data/context'
import { BOOKINGS_BOOKING_SCREEN } from './screen-ids'
import { BookingPill, Chips, IconAction } from './ui'

/*
 * The bookings calendar (AGL-3621): a day, a week or the next two weeks of
 * appointments in the site's own time zone, narrowed to one service when
 * asked. On a tablet the selected booking opens beside the calendar; on a
 * phone it opens as its own screen.
 */

const ALL_SERVICES = 'all'

export function BookingsCalendar({
  bookings,
  initialView = 'day',
  selectedId,
  onOpen,
}: {
  bookings: BookingsMobileContext
  initialView?: CalendarView
  selectedId: string | null
  onOpen: (bookingId: string) => void
}) {
  const theme = useMobileTheme()
  const [view, setView] = useState<CalendarView>(initialView)
  const [anchorMs, setAnchorMs] = useState(() => nowOf(bookings))
  const [serviceId, setServiceId] = useState<string>(ALL_SERVICES)
  const site = useQuery(bookingsSiteQuery(bookings))
  const services = useQuery(servicesQuery(bookings))
  const timeZone = site.data?.timeZone ?? 'UTC'
  const range = useMemo(() => calendarRange(view, anchorMs, timeZone), [view, anchorMs, timeZone])
  const rows = useQuery({
    ...bookingsRangeQuery(bookings, {
      fromMs: range.fromMs,
      toMs: range.toMs,
      serviceId: serviceId === ALL_SERVICES ? null : serviceId,
    }),
    enabled: site.isSuccess,
  })

  const sections = useMemo(() => {
    const grouped = groupByDay(rows.data?.rows ?? [], range)
    return grouped
      .filter((entry) => view !== 'agenda' || entry.rows.length)
      .map((entry) => ({ key: entry.day.key, title: formatDay(entry.day.startMs, timeZone), data: entry.rows }))
  }, [rows.data, range, view, timeZone])

  const serviceOptions = useMemo(
    () => [{ id: ALL_SERVICES, label: 'All services' }, ...(services.data ?? []).map((entry) => ({ id: entry.id, label: entry.name }))],
    [services.data],
  )
  const link = site.data && serviceId !== ALL_SERVICES ? serviceBookingLink(site.data, serviceId) : null
  const showsToday = rangeHolds(range, nowOf(bookings))

  const header = (
    <View>
      <Chips testID="calendar-view" options={CALENDAR_VIEWS} value={view} onChange={setView} />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space(2), gap: theme.space(1) }}>
        <IconAction
          testID="calendar-previous"
          icon="chevron-back"
          label="Earlier"
          onPress={() => setAnchorMs((current) => shiftAnchor(view, current, -1, timeZone))}
        />
        <Text variant="label" testID="calendar-title" style={{ flex: 1, textAlign: 'center' }}>
          {rangeTitle(range, timeZone)}
        </Text>
        <IconAction
          testID="calendar-next"
          icon="chevron-forward"
          label="Later"
          onPress={() => setAnchorMs((current) => shiftAnchor(view, current, 1, timeZone))}
        />
        {link ? (
          <IconAction
            testID="calendar-share-link"
            icon="share-outline"
            label="Share booking link"
            onPress={() => void Share.share({ message: link, url: link }).catch(() => undefined)}
          />
        ) : null}
      </View>
      {!showsToday ? (
        <View style={{ alignItems: 'center' }}>
          <Button testID="calendar-today" title="Today" variant="text" icon="today-outline" onPress={() => setAnchorMs(nowOf(bookings))} />
        </View>
      ) : null}
      {serviceOptions.length > 2 ? (
        <Chips testID="calendar-service" options={serviceOptions} value={serviceId} onChange={setServiceId} />
      ) : null}
      {rows.data?.truncated ? (
        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2) }}>
          This range holds more bookings than one view shows. Pick a shorter view or one service.
        </Text>
      ) : null}
    </View>
  )

  if (site.isPending || rows.isPending) {
    return (
      <View testID="calendar-loading">
        {header}
        <View style={{ padding: theme.space(2), gap: theme.space(1.5) }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      </View>
    )
  }
  if (rows.isError) {
    return (
      <View>
        {header}
        <EmptyState icon="warning-outline" title="Could not load bookings" body={errorText(rows.error)} />
      </View>
    )
  }

  const renderRow = (row: BookingRow) => (
    <ListRow
      testID={`booking-${row.id}`}
      icon={row.checkedInAtMs ? 'checkmark-circle-outline' : 'time-outline'}
      title={`${formatTime(row.startsAtMs, timeZone)} · ${row.name}`}
      subtitle={bookingSubtitle(row)}
      selected={row.id === selectedId}
      onPress={() => onOpen(row.id)}
      trailing={row.state === 'confirmed' && !row.checkedInAtMs ? undefined : <BookingPill row={row} />}
    />
  )

  return (
    <SectionList
      testID="calendar-list"
      sections={sections}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) =>
        view === 'day' ? null : (
          <View
            style={{
              paddingHorizontal: theme.space(2),
              paddingVertical: theme.space(0.5),
              backgroundColor: theme.colors.background.default,
            }}
          >
            <Text variant="label" tone="secondary">
              {section.title}
            </Text>
          </View>
        )
      }
      renderSectionFooter={({ section }) =>
        view === 'week' && !section.data.length ? (
          <Text variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2), paddingBottom: theme.space(1) }}>
            No bookings
          </Text>
        ) : null
      }
      renderItem={({ item }) => renderRow(item)}
      ListEmptyComponent={
        view === 'week' ? null : (
          <EmptyState
            icon="calendar-outline"
            title={view === 'day' ? 'No bookings this day' : 'No bookings in these two weeks'}
            body="Bookings from your site show up here."
          />
        )
      }
      refreshControl={<RefreshControl refreshing={rows.isRefetching} onRefresh={() => void rows.refetch()} />}
    />
  )
}

export default function CalendarScreen({ context, params }: MobileScreenProps) {
  const bookings = useMemo(() => bookingsContextOf(context), [context])
  const { split } = useLayout()
  const [selected, setSelected] = useState<string | null>(params['bookingId'] ?? null)
  const initialView = CALENDAR_VIEWS.some((entry) => entry.id === params['view']) ? (params['view'] as CalendarView) : undefined
  if (!bookings) return <EmptyState icon="globe-outline" title="Pick a site to see its bookings" />
  const open = (bookingId: string) => {
    if (split) setSelected(bookingId)
    else context.navigate(BOOKINGS_BOOKING_SCREEN, { bookingId })
  }
  return (
    <SplitView
      listWidth={400}
      list={<BookingsCalendar bookings={bookings} initialView={initialView ?? (split ? 'week' : 'day')} selectedId={split ? selected : null} onOpen={open} />}
      detail={<CalendarDetail context={context} bookings={bookings} bookingId={selected} />}
    />
  )
}

function CalendarDetail({
  context,
  bookings,
  bookingId,
}: {
  context: MobilePluginContext
  bookings: BookingsMobileContext
  bookingId: string | null
}) {
  if (!bookingId) return <EmptyState icon="calendar-outline" title="Pick a booking to see it here" />
  return <BookingDetailPanel key={bookingId} context={context} bookings={bookings} bookingId={bookingId} />
}
