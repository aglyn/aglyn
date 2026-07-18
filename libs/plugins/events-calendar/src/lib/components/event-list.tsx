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
import { mdiCalendarStar } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'eventList'

export interface EventListProps {
  /** 'upcoming' (default) or 'past'. */
  mode?: 'upcoming' | 'past'
  /** Heading above the list; empty hides it. */
  heading?: string
  /** Max events shown (default 10). */
  maxItems?: number
}

interface EventItem {
  $id: string
  title: string
  startsAtMs: number
  endsAtMs: number
  location?: string | null
  organizer?: string | null
  description?: string | null
  coverImage?: string | null
}

/**
 * Event List (AGL-145, Event Calendar add-on): published events from the
 * public tenant API with schema.org Event JSON-LD per item (ties into the
 * AGL-143 structured-data work). Editor placeholder without a site
 * context; empty add-on hosts render nothing live.
 */
const EventList = forwardRef<HTMLDivElement, EventListProps>((props, ref) => {
  const { mode, heading, maxItems, ...rest } = props
  const { hostId } = Aglyn.useSite()
  const [events, setEvents] = useState<EventItem[] | null>(null)

  useEffect(() => {
    if (!hostId) return
    let active = true
    void fetch(
      `/api/events/list?hostId=${encodeURIComponent(hostId)}` +
        `&mode=${mode === 'past' ? 'past' : 'upcoming'}`,
    )
      .then((response) => response.json())
      .then((payload) => {
        if (active) setEvents(payload?.events ?? [])
      })
      .catch(() => {
        if (active) setEvents([])
      })
    return () => {
      active = false
    }
  }, [hostId, mode])

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          p: 3,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          color: 'text.secondary',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Event list — published events render here (Event Calendar add-on)'}
      </Box>
    )
  }
  if (events === null) {
    return (
      <Box ref={ref} {...rest} sx={{ p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }
  const visible = events.slice(0, maxItems && maxItems > 0 ? maxItems : 10)
  if (!visible.length) return <Box ref={ref} {...rest} />

  return (
    <Stack ref={ref} spacing={2} {...rest}>
      {heading ? <Typography variant="h5">{heading}</Typography> : null}
      {visible.map((event) => (
        <Stack
          key={event.$id}
          direction="row"
          spacing={2}
          sx={{ alignItems: 'flex-start' }}
        >
          {event.coverImage ? (
            <Box
              component="img"
              src={event.coverImage}
              alt=""
              sx={{
                width: 96,
                height: 96,
                objectFit: 'cover',
                borderRadius: 1,
                flexShrink: 0,
              }}
            />
          ) : null}
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography variant="h6">{event.title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {new Date(event.startsAtMs).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {event.location ? ` · ${event.location}` : ''}
              {event.organizer ? ` · ${event.organizer}` : ''}
            </Typography>
            {event.description ? (
              <Typography variant="body2">{event.description}</Typography>
            ) : null}
          </Stack>
          {/* schema.org Event (AGL-143/145). */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: Aglyn.safeJsonLd({
                '@context': 'https://schema.org',
                '@type': 'Event',
                name: event.title,
                startDate: new Date(event.startsAtMs).toISOString(),
                ...(event.endsAtMs && {
                  endDate: new Date(event.endsAtMs).toISOString(),
                }),
                ...(event.location && {
                  location: { '@type': 'Place', name: event.location },
                }),
                ...(event.organizer && {
                  organizer: {
                    '@type': 'Organization',
                    name: event.organizer,
                  },
                }),
                ...(event.description && {
                  description: event.description,
                }),
                ...(event.coverImage && { image: [event.coverImage] }),
              }),
            }}
          />
        </Stack>
      ))}
    </Stack>
  )
})
EventList.displayName = 'EventList'

export const schema: Aglyn.ComponentSchema<EventListProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Event List',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: {
    path: mdiCalendarStar.path,
    sx: { color: '#7b1fa2' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'heading',
      description: 'Heading above the list; empty hides it.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Heading',
    },
    {
      name: 'mode',
      description: 'Which events to show.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Show',
      options: [
        { value: '', label: 'Upcoming (default)' },
        { value: 'past', label: 'Past events' },
      ],
    },
    {
      name: 'maxItems',
      description: 'Maximum events shown (default 10).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Max items',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Event List',
    pluginId: BUNDLE_ID,
    description: 'Published events with SEO Event markup (add-on)',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: {
      path: mdiCalendarStar.path,
      sx: { color: '#7b1fa2' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default EventList
