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
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import type { CalendarOccurrence } from '../model/event-calendar-feed'
import type { EventCategory } from '../model/event-categories'
import { OccurrenceDetails } from './calendar-parts'

export interface EventDetailsProps {
  /** What the element says when the link names no event, or one that is gone. */
  emptyText?: string
}

interface EventAnswer {
  enabled: boolean
  timeZone?: string
  categories?: EventCategory[]
  occurrences?: CalendarOccurrence[]
}

/**
 * Event details (AGL-4252, calendar v2): the one event the page's link names
 * (`?event=…&on=YYYY-MM-DD`), for an event page the owner designs once and
 * every event opens on — set as the Events Calendar's "Event details page
 * path". Its date, place, description, tickets, add to calendar and its next
 * dates, with `schema.org/Event` markup for that date.
 */
const EventDetails = forwardRef<HTMLDivElement, EventDetailsProps>(
  (props, ref) => {
    const { emptyText, ...rest } = props
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId, preview } = Aglyn.useSite()
    const [link, setLink] = useState<{ eventId: string; on: string } | null>(
      null,
    )
    const [answer, setAnswer] = useState<EventAnswer | null>(null)

    useEffect(() => {
      const query = new URLSearchParams(window.location.search)
      setLink({ eventId: query.get('event') ?? '', on: query.get('on') ?? '' })
    }, [])

    useEffect(() => {
      if (!hostId || !link) return
      if (!link.eventId) {
        setAnswer({ enabled: true, occurrences: [] })
        return
      }
      let active = true
      const params = new URLSearchParams({
        hostId,
        id: link.eventId,
        ...(link.on ? { on: link.on } : {}),
      })
      void fetch(`/api/events/event?${params.toString()}`)
        .then((response) =>
          response.ok ? response.json() : { enabled: true, occurrences: [] },
        )
        .then((payload: EventAnswer) => {
          if (active) setAnswer(payload)
        })
        .catch(() => {
          if (active) setAnswer({ enabled: true, occurrences: [] })
        })
      return () => {
        active = false
      }
    }, [hostId, link])

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
            'Event details — the event a calendar link opens shows here (Event Calendar add-on)'
          }
        </Box>
      )
    }
    if (!answer) {
      return (
        <Box ref={ref} {...rest} sx={[{ p: 2 }, ...nodeSx]}>
          <CircularProgress size={24} />
        </Box>
      )
    }
    if (!answer.enabled) {
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
    const [first, ...more] = answer.occurrences ?? []
    if (!first) {
      return (
        <Box ref={ref} {...rest} sx={nodeSx}>
          <Typography variant="body1" color="text.secondary">
            {emptyText || 'This event is not on the calendar.'}
          </Typography>
        </Box>
      )
    }
    return (
      <Box ref={ref} {...rest} sx={nodeSx}>
        <OccurrenceDetails
          hostId={hostId}
          occurrence={first}
          categories={answer.categories ?? []}
          timeZone={answer.timeZone ?? first.timeZone}
          moreDates={more}
          onPickDate={(date) => {
            const query = new URLSearchParams(window.location.search)
            query.set('on', date.dayKey)
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}?${query.toString()}`,
            )
            setLink({ eventId: date.eventId, on: date.dayKey })
          }}
          headingComponent="h1"
        />
      </Box>
    )
  },
)
EventDetails.displayName = 'EventDetails'

export default EventDetails
