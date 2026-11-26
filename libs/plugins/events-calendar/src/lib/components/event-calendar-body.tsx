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

import * as Aglyn from '@aglyn/aglyn'
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import {
  monthGridDays,
  stepAnchor,
  viewRange,
  viewTitle,
  weekDays,
  dayKeyDate,
  type CalendarView,
} from '../model/calendar-grid'
import type {
  CalendarOccurrence,
  CalendarRangeResponse,
} from '../model/event-calendar-feed'
import type { EventCategory } from '../model/event-categories'
import {
  OccurrenceDetails,
  OccurrenceJsonLd,
  TicketButton,
  occurrenceColor,
  occurrenceTimeText,
} from './calendar-parts'

export interface EventCalendarProps {
  heading?: string
  /** The view a wide screen opens on; a phone always shows the list. */
  defaultView?: CalendarView
  /** Days the list view shows at once (default 60). */
  listDays?: number
  hideCategories?: boolean
  hideSearch?: boolean
  hideSubscribe?: boolean
}

/** The most dates one month cell shows before "+N more". */
const CELL_MAX = 3
const SEARCH_DEBOUNCE_MS = 300

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The page's `?event=` and `?on=`, read once on mount. */
function linkedEvent(): { eventId: string; on: string } | null {
  if (typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search)
  const eventId = query.get('event')
  return eventId ? { eventId, on: query.get('on') ?? '' } : null
}

/**
 * Calendar (AGL-4252, Event Calendar add-on, calendar v2): the site's
 * published events by month, week or as a list, filtered by the owner's
 * categories and by what a visitor types. A phone gets the list (an agenda
 * by day), since seven columns do not fit 375 px. Each date opens its
 * details: tickets, add to calendar, more dates. Renders nothing where the
 * workspace does not have calendar v2.
 */
const EventCalendar = forwardRef<HTMLDivElement, EventCalendarProps>(
  (props, ref) => {
    const {
      heading,
      defaultView,
      listDays: listDaysProp,
      hideCategories,
      hideSearch,
      hideSubscribe,
      ...rest
    } = props
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId, preview } = Aglyn.useSite()
    const theme = useTheme()
    const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
    const listDays = Number(listDaysProp) > 0 ? Number(listDaysProp) : 60
    const [chosenView, setView] = useState<CalendarView>(
      defaultView === 'week' || defaultView === 'list' ? defaultView : 'month',
    )
    const view: CalendarView = phone ? 'list' : chosenView
    const [timeZone, setTimeZone] = useState<string>(browserTimeZone)
    const [anchor, setAnchor] = useState<string>(() =>
      zonedDayKey(Date.now(), browserTimeZone()),
    )
    const [category, setCategory] = useState<string>('')
    const [typed, setTyped] = useState('')
    const [query, setQuery] = useState('')
    const [data, setData] = useState<CalendarRangeResponse | null>(null)
    const [categories, setCategories] = useState<EventCategory[]>([])
    const [open, setOpen] = useState<CalendarOccurrence | null>(null)
    const [linked] = useState(linkedEvent)

    useEffect(() => {
      const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_DEBOUNCE_MS)
      return () => clearTimeout(timer)
    }, [typed])

    const range = useMemo(
      () => viewRange(view, view === 'month' ? anchor : anchor, listDays),
      [view, anchor, listDays],
    )

    useEffect(() => {
      if (!hostId) return
      let active = true
      const params = new URLSearchParams({
        hostId,
        from: range.from,
        to: range.to,
      })
      if (category) params.set('category', category)
      if (query) params.set('q', query)
      void fetch(`/api/events/occurrences?${params.toString()}`)
        .then((response) => response.json())
        .then((payload: CalendarRangeResponse) => {
          if (!active) return
          setData(payload)
          if (payload?.categories?.length || !category)
            setCategories(payload?.categories ?? [])
          if (payload?.timeZone && payload.timeZone !== timeZone) {
            // The site's own clock decides what "today" is.
            setTimeZone(payload.timeZone)
            setAnchor((current) =>
              current === zonedDayKey(Date.now(), timeZone)
                ? zonedDayKey(Date.now(), payload.timeZone)
                : current,
            )
          }
        })
        .catch(() => {
          if (active)
            setData({
              enabled: false,
              timeZone,
              categories: [],
              occurrences: [],
            })
        })
      return () => {
        active = false
      }
      // `timeZone` is read for the first answer only; it is not a reason to read again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hostId, range.from, range.to, category, query])

    // An event the link names opens once its date is known.
    useEffect(() => {
      if (!hostId || !linked) return
      let active = true
      const params = new URLSearchParams({
        hostId,
        id: linked.eventId,
        ...(linked.on ? { on: linked.on } : {}),
      })
      void fetch(`/api/events/event?${params.toString()}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const first = payload?.occurrences?.[0]
          if (active && first) setOpen(first)
        })
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [hostId, linked])

    const byDay = useMemo(() => {
      const map = new Map<string, CalendarOccurrence[]>()
      for (const occurrence of data?.occurrences ?? []) {
        const key = zonedDayKey(occurrence.startsAtMs, timeZone)
        const list = map.get(key) ?? []
        list.push(occurrence)
        map.set(key, list)
      }
      return map
    }, [data, timeZone])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              p: 3,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
            },
            ...nodeSx,
          ]}
        >
          {
            'Calendar — your published events by month, week or list (Event Calendar add-on)'
          }
        </Box>
      )
    }
    if (data === null) {
      return (
        <Box ref={ref} {...rest} sx={[{ p: 2 }, ...nodeSx]}>
          <CircularProgress size={24} />
        </Box>
      )
    }
    if (!data.enabled) {
      // Only Preview says why it is empty; a visitor sees nothing.
      return preview ? (
        <Box
          ref={ref}
          {...rest}
          sx={[{ p: 2, color: 'text.secondary', fontSize: 13 }, ...nodeSx]}
        >
          {
            'This element shows your events once the new events calendar is on for your workspace.'
          }
        </Box>
      ) : (
        <Box ref={ref} {...rest} />
      )
    }

    const today = zonedDayKey(Date.now(), timeZone)
    const subscribeHref =
      typeof window !== 'undefined'
        ? `webcal://${window.location.host}/api/events/ics?${new URLSearchParams({ hostId, ...(category ? { category } : {}) }).toString()}`
        : ''

    const dot = (occurrence: CalendarOccurrence) =>
      occurrenceColor(occurrence, categories) ?? theme.palette.primary.main

    const occurrenceLine = (
      occurrence: CalendarOccurrence,
      compact: boolean,
    ) => (
      <ButtonBase
        key={occurrence.id}
        onClick={() => setOpen(occurrence)}
        sx={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: 0.75,
          width: '100%',
          textAlign: 'left',
          borderRadius: 0.5,
          px: 0.5,
          py: compact ? 0.25 : 0.5,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: dot(occurrence),
          }}
        />
        <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
          {compact
            ? occurrence.title
            : `${new Date(occurrence.startsAtMs).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })} ${occurrence.title}`}
        </Typography>
      </ButtonBase>
    )

    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    const monthView = () => {
      const days = monthGridDays(anchor)
      const month = anchor.slice(0, 7)
      return (
        <Box
          role="grid"
          aria-label={viewTitle('month', anchor)}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {weekdayNames.map((name) => (
            <Typography
              key={name}
              role="columnheader"
              variant="caption"
              sx={{
                p: 0.75,
                fontWeight: 600,
                textAlign: 'center',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              {name}
            </Typography>
          ))}
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            const outside = !day.startsWith(month)
            return (
              <Box
                key={day}
                role="gridcell"
                aria-label={dayKeyDate(day).toLocaleDateString('en-US', {
                  timeZone: 'UTC',
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
                sx={{
                  minHeight: 96,
                  p: 0.5,
                  borderRight: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                  opacity: outside ? 0.55 : 1,
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    display: 'inline-flex',
                    justifyContent: 'center',
                    minWidth: 22,
                    borderRadius: 11,
                    fontWeight: day === today ? 700 : 400,
                    ...(day === today
                      ? {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                        }
                      : {}),
                  }}
                >
                  {Number(day.slice(8))}
                </Typography>
                <Stack spacing={0.25}>
                  {list
                    .slice(0, CELL_MAX)
                    .map((occurrence) => occurrenceLine(occurrence, true))}
                  {list.length > CELL_MAX ? (
                    <ButtonBase
                      onClick={() => {
                        setAnchor(day)
                        setView('list')
                      }}
                      sx={{ justifyContent: 'flex-start', px: 0.5 }}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >{`+${list.length - CELL_MAX} more`}</Typography>
                    </ButtonBase>
                  ) : null}
                </Stack>
              </Box>
            )
          })}
        </Box>
      )
    }

    const weekView = () => (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 1,
        }}
      >
        {weekDays(anchor).map((day) => (
          <Stack key={day} spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: day === today ? 700 : 500,
                color: day === today ? 'primary.main' : undefined,
              }}
            >
              {dayKeyDate(day).toLocaleDateString('en-US', {
                timeZone: 'UTC',
                weekday: 'short',
                day: 'numeric',
              })}
            </Typography>
            {(byDay.get(day) ?? []).map((occurrence) =>
              occurrenceLine(occurrence, false),
            )}
          </Stack>
        ))}
      </Box>
    )

    const listView = () => {
      const days = [...byDay.keys()].sort()
      if (!days.length) {
        return (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {query || category
              ? 'No events match.'
              : 'No events in these dates.'}
          </Typography>
        )
      }
      return (
        <Stack spacing={2}>
          {days.map((day) => (
            <Stack key={day} spacing={1}>
              <Typography
                variant="subtitle1"
                component="h3"
                sx={{ fontWeight: 600 }}
              >
                {day === today
                  ? 'Today'
                  : dayKeyDate(day).toLocaleDateString('en-US', {
                      timeZone: 'UTC',
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
              </Typography>
              {(byDay.get(day) ?? []).map((occurrence) => (
                <Stack
                  key={occurrence.id}
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: 'flex-start',
                    borderLeft: 4,
                    borderColor: dot(occurrence),
                    pl: 1.5,
                  }}
                >
                  <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                    <ButtonBase
                      onClick={() => setOpen(occurrence)}
                      sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    >
                      <Typography
                        variant="h6"
                        component="span"
                        sx={{ fontSize: '1.05rem' }}
                      >
                        {occurrence.title}
                      </Typography>
                    </ButtonBase>
                    <Typography variant="body2" color="text.secondary">
                      {[
                        occurrenceTimeText(occurrence, timeZone),
                        occurrence.location,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                    {occurrence.ticket ? (
                      <TicketButton ticket={occurrence.ticket} />
                    ) : null}
                  </Stack>
                  <OccurrenceJsonLd occurrence={occurrence} />
                </Stack>
              ))}
            </Stack>
          ))}
        </Stack>
      )
    }

    return (
      <Stack ref={ref} spacing={2} {...rest} sx={[{ minWidth: 0 }, ...nodeSx]}>
        {heading ? <Typography variant="h5">{heading}</Typography> : null}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setAnchor(today)}
            >
              {'Today'}
            </Button>
            <Button
              size="small"
              aria-label="Previous"
              onClick={() =>
                setAnchor((current) => stepAnchor(view, current, -1, listDays))
              }
            >
              {'‹'}
            </Button>
            <Button
              size="small"
              aria-label="Next"
              onClick={() =>
                setAnchor((current) => stepAnchor(view, current, 1, listDays))
              }
            >
              {'›'}
            </Button>
            <Typography
              variant="subtitle1"
              component="h2"
              sx={{ fontWeight: 600 }}
              aria-live="polite"
            >
              {viewTitle(view, anchor, listDays)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {hideSearch ? null : (
              <TextField
                size="small"
                type="search"
                placeholder="Search events"
                value={typed}
                onChange={(event) => setTyped(event.target.value.slice(0, 100))}
                slotProps={{ htmlInput: { 'aria-label': 'Search events' } }}
                sx={{ flex: { xs: 1, sm: 'none' }, width: { sm: 200 } }}
              />
            )}
            {phone ? null : (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_, next: CalendarView | null) =>
                  next && setView(next)
                }
                aria-label="Calendar view"
              >
                <ToggleButton value="month">{'Month'}</ToggleButton>
                <ToggleButton value="week">{'Week'}</ToggleButton>
                <ToggleButton value="list">{'List'}</ToggleButton>
              </ToggleButtonGroup>
            )}
          </Stack>
        </Stack>
        {hideCategories || !categories.length ? null : (
          <Stack
            direction="row"
            spacing={1}
            role="group"
            aria-label="Event categories"
            sx={{
              overflowX: 'auto',
              pb: 0.5,
              flexWrap: { xs: 'nowrap', sm: 'wrap' },
              rowGap: 1,
            }}
          >
            <Chip
              label="All"
              color={category ? 'default' : 'primary'}
              variant={category ? 'outlined' : 'filled'}
              onClick={() => setCategory('')}
              aria-pressed={!category}
            />
            {categories.map((one) => {
              const on = category === one.$id
              return (
                <Chip
                  key={one.$id}
                  label={one.name}
                  onClick={() => setCategory(on ? '' : one.$id)}
                  aria-pressed={on}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{
                    flexShrink: 0,
                    borderColor: one.color,
                    ...(on
                      ? {
                          bgcolor: one.color,
                          color: theme.palette.getContrastText(one.color),
                          '&:hover': { bgcolor: one.color },
                        }
                      : {}),
                  }}
                  icon={
                    on ? undefined : (
                      <Box
                        component="span"
                        aria-hidden
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: one.color,
                          ml: '8px !important',
                        }}
                      />
                    )
                  }
                />
              )
            })}
          </Stack>
        )}
        {view === 'month'
          ? monthView()
          : view === 'week'
            ? weekView()
            : listView()}
        {hideSubscribe || !subscribeHref ? null : (
          <Box>
            <Button size="small" href={subscribeHref}>
              {'Subscribe to this calendar'}
            </Button>
          </Box>
        )}
        <Dialog
          open={Boolean(open)}
          onClose={() => setOpen(null)}
          maxWidth="sm"
          fullWidth
          fullScreen={phone}
          aria-label={open?.title}
        >
          <DialogContent>
            {open ? (
              <OccurrenceDetails
                hostId={hostId}
                occurrence={open}
                categories={categories}
                timeZone={timeZone}
                moreDates={(data.occurrences ?? [])
                  .filter(
                    (one) =>
                      one.eventId === open.eventId &&
                      one.startsAtMs > open.startsAtMs,
                  )
                  .slice(0, 5)}
                onPickDate={setOpen}
              />
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(null)}>{'Close'}</Button>
          </DialogActions>
        </Dialog>
      </Stack>
    )
  },
)
EventCalendar.displayName = 'EventCalendar'

export default EventCalendar
