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
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useCallback, useState } from 'react'
import type { EventCategory } from '../model/event-categories'
import {
  googleCalendarLink,
  occurrenceJsonLd,
  type CalendarOccurrence,
  type CalendarTicket,
} from '../model/event-calendar-feed'

/**
 * WHAT THE CALENDAR AND THE EVENT DETAILS ELEMENTS SHARE (AGL-4252): how an
 * occurrence's date reads, its ticket button, its add-to-calendar links, and
 * its full details. Client-only, imported by the two site elements.
 */

/** "Thu, Nov 5", on the site's clock. */
export function occurrenceDayText(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** "6:00 PM – 9:00 PM", on the site's clock. */
export function occurrenceTimeText(
  occurrence: Pick<CalendarOccurrence, 'startsAtMs' | 'endsAtMs'>,
  timeZone: string,
): string {
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    })
  return occurrence.endsAtMs > occurrence.startsAtMs
    ? `${time(occurrence.startsAtMs)} – ${time(occurrence.endsAtMs)}`
    : time(occurrence.startsAtMs)
}

/** The color an occurrence wears: its first category's, else none. */
export function occurrenceColor(
  occurrence: Pick<CalendarOccurrence, 'categoryIds'>,
  categories: readonly EventCategory[],
): string | null {
  for (const id of occurrence.categoryIds) {
    const category = categories.find((one) => one.$id === id)
    if (category) return category.color
  }
  return null
}

/** A category's name in its own color. */
export function CategoryTag(props: { category: EventCategory }) {
  const { category } = props
  return (
    <Chip
      size="small"
      label={category.name}
      variant="outlined"
      icon={
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: category.color,
            ml: '8px !important',
          }}
        />
      }
    />
  )
}

/**
 * The ticket button. A link opens the page; a post goes to the owning
 * plugin's own door from this browser, with the visitor's own cookie, then
 * says what happened.
 */
export function TicketButton(props: {
  ticket: CalendarTicket
  size?: 'small' | 'medium'
}) {
  const { ticket, size = 'small' } = props
  const siteFetch = Aglyn.useSiteFetch()
  const [state, setState] = useState<{ busy: boolean; message: string | null }>(
    { busy: false, message: null },
  )
  const press = useCallback(async () => {
    const action = ticket.action
    if (action.kind === 'link') {
      window.location.assign(action.href)
      return
    }
    setState({ busy: true, message: null })
    try {
      const response = await siteFetch(action.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.body),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setState({
          busy: false,
          message: String(payload?.error ?? 'That did not work. Try again.'),
        })
        return
      }
      if (action.notify) window.dispatchEvent(new Event(action.notify))
      setState({ busy: false, message: action.done ?? 'Done' })
      if (action.then) window.location.assign(action.then)
    } catch {
      setState({ busy: false, message: 'That did not work. Try again.' })
    }
  }, [siteFetch, ticket.action])
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
    >
      <Button
        variant="contained"
        size={size}
        disabled={state.busy}
        onClick={() => void press()}
      >
        {ticket.label}
      </Button>
      {ticket.caption ? (
        <Typography variant="body2" color="text.secondary">
          {ticket.caption}
        </Typography>
      ) : null}
      {state.message ? (
        <Typography variant="body2" role="status">
          {state.message}
        </Typography>
      ) : null}
    </Stack>
  )
}

/** The `.ics` download for one date. */
export function icsHref(
  hostId: string,
  occurrence: Pick<CalendarOccurrence, 'eventId' | 'dayKey'>,
): string {
  const query = new URLSearchParams({
    hostId,
    event: occurrence.eventId,
    on: occurrence.dayKey,
  })
  return `/api/events/ics?${query.toString()}`
}

/** Google Calendar and an `.ics` file (Apple Calendar, Outlook) for one date. */
export function AddToCalendar(props: {
  hostId: string
  occurrence: CalendarOccurrence
  pageUrl?: string
}) {
  const { hostId, occurrence, pageUrl } = props
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button
        size="small"
        variant="outlined"
        href={googleCalendarLink(occurrence, pageUrl)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {'Add to Google Calendar'}
      </Button>
      <Button
        size="small"
        variant="outlined"
        href={icsHref(hostId, occurrence)}
        download
      >
        {'Apple or Outlook (.ics)'}
      </Button>
    </Stack>
  )
}

/** The occurrence's `schema.org/Event` markup. */
export function OccurrenceJsonLd(props: {
  occurrence: CalendarOccurrence
  url?: string
}) {
  const offerUrl =
    props.occurrence.ticket?.action.kind === 'link' &&
    typeof window !== 'undefined'
      ? new URL(
          props.occurrence.ticket.action.href,
          window.location.origin,
        ).toString()
      : props.url
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: Aglyn.safeJsonLd(
          occurrenceJsonLd(props.occurrence, { url: props.url, offerUrl }),
        ),
      }}
    />
  )
}

/** Everything about one date of an event: the dialog's body and the Event details element's. */
export function OccurrenceDetails(props: {
  hostId: string
  occurrence: CalendarOccurrence
  categories: readonly EventCategory[]
  timeZone: string
  /** More dates of the same event, after this one. */
  moreDates?: readonly CalendarOccurrence[]
  onPickDate?: (occurrence: CalendarOccurrence) => void
  headingComponent?: 'h1' | 'h2' | 'h3'
}) {
  const { hostId, occurrence, categories, timeZone, moreDates, onPickDate } =
    props
  const tags = categories.filter((category) =>
    occurrence.categoryIds.includes(category.$id),
  )
  const pageUrl =
    typeof window !== 'undefined' ? window.location.href : undefined
  return (
    <Stack spacing={2}>
      {occurrence.coverImage &&
      !Aglyn.isRefusedAuthorImageSrc(occurrence.coverImage) ? (
        <Box
          component="img"
          src={occurrence.coverImage}
          alt={Aglyn.renderedMediaAlt(occurrence.coverImageAlt)}
          sx={{
            width: '100%',
            maxHeight: 320,
            objectFit: 'cover',
            borderRadius: 1,
          }}
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : null}
      <Stack spacing={0.5}>
        <Typography variant="h5" component={props.headingComponent ?? 'h2'}>
          {occurrence.title}
        </Typography>
        <Typography variant="body1">
          {`${occurrenceDayText(occurrence.startsAtMs, timeZone)} · ${occurrenceTimeText(occurrence, timeZone)}`}
        </Typography>
        {occurrence.repeatText ? (
          <Typography variant="body2" color="text.secondary">
            {occurrence.repeatText}
          </Typography>
        ) : null}
        {occurrence.location || occurrence.organizer ? (
          <Typography variant="body2" color="text.secondary">
            {[occurrence.location, occurrence.organizer]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        ) : null}
      </Stack>
      {tags.length ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {tags.map((category) => (
            <CategoryTag key={category.$id} category={category} />
          ))}
        </Stack>
      ) : null}
      {occurrence.description ? (
        <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>
          {occurrence.description}
        </Typography>
      ) : null}
      {occurrence.ticket ? (
        <TicketButton ticket={occurrence.ticket} size="medium" />
      ) : null}
      <AddToCalendar
        hostId={hostId}
        occurrence={occurrence}
        pageUrl={pageUrl}
      />
      {moreDates?.length ? (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{'More dates'}</Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            {moreDates.map((date) => (
              <Chip
                key={date.id}
                label={occurrenceDayText(date.startsAtMs, timeZone)}
                onClick={onPickDate ? () => onPickDate(date) : undefined}
                variant="outlined"
              />
            ))}
          </Stack>
        </Stack>
      ) : null}
      <OccurrenceJsonLd occurrence={occurrence} url={pageUrl} />
    </Stack>
  )
}
