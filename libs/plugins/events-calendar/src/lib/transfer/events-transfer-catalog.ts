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

import type {
  MatchKeySpec,
  TransferAliasDictionary,
  TransferCatalogInput,
} from '@aglyn/aglyn/data-transfer'
import {
  EVENT_COVER_ALT_MAX_LENGTH,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_ORGANIZER_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
} from '../model/event-write'

/**
 * What an events file can carry, and how a row finds its event: data only,
 * so the console's boot declarations read the match keys and the aliases
 * synchronously without loading the transfer core or the Admin SDK.
 */

/** The field ids an event is written through, in catalog order. */
export const EVENT_CONTENT_FIELD_IDS = [
  'title',
  'startsAt',
  'endsAt',
  'location',
  'organizer',
  'description',
  'coverImage',
  'coverImageAlt',
  'status',
] as const
export type EventContentFieldId = (typeof EVENT_CONTENT_FIELD_IDS)[number]

/**
 * Every field of an event. `startsAt` and `endsAt` are moments (ISO in a
 * file, epoch milliseconds as stored); the length caps are the editor's,
 * so a longer cell is cut — and flagged — before the dry run shows it.
 */
export const EVENTS_CATALOG: TransferCatalogInput = {
  groups: [
    { id: 'event', label: 'Event' },
    { id: 'cover', label: 'Cover image' },
  ],
  standard: [
    {
      id: 'title',
      label: 'Title',
      group: 'event',
      type: 'text',
      required: true,
      maxLength: EVENT_TITLE_MAX_LENGTH,
      aliases: ['Name', 'Event', 'Event title', 'Summary'],
    },
    {
      id: 'startsAt',
      label: 'Starts',
      group: 'event',
      type: 'datetime',
      required: true,
      aliases: [
        'Start',
        'Start date',
        'Starts at',
        'Start date and time',
        'Begins',
      ],
    },
    {
      id: 'endsAt',
      label: 'Ends',
      group: 'event',
      type: 'datetime',
      aliases: ['End', 'End date', 'Ends at', 'End date and time'],
      description: 'Blank, or not after the start, gives the event one hour.',
    },
    {
      id: 'location',
      label: 'Location',
      group: 'event',
      type: 'text',
      maxLength: EVENT_LOCATION_MAX_LENGTH,
      aliases: ['Venue', 'Place', 'Where'],
    },
    {
      id: 'organizer',
      label: 'Organizer',
      group: 'event',
      type: 'text',
      maxLength: EVENT_ORGANIZER_MAX_LENGTH,
      aliases: ['Organiser', 'Hosted by'],
    },
    {
      id: 'description',
      label: 'Description',
      group: 'event',
      type: 'longText',
      maxLength: EVENT_DESCRIPTION_MAX_LENGTH,
      aliases: ['Details', 'About'],
    },
    {
      id: 'status',
      label: 'Status',
      group: 'event',
      type: 'text',
      aliases: ['Event status'],
      description: 'draft or published. A new event without one is a draft.',
    },
    {
      id: 'coverImage',
      label: 'Cover image',
      group: 'cover',
      type: 'text',
      aliases: ['Cover image URL', 'Image', 'Image URL', 'Featured image'],
      description: 'A web address, or a path on this site.',
    },
    {
      id: 'coverImageAlt',
      label: 'Cover image alt text',
      group: 'cover',
      type: 'text',
      maxLength: EVENT_COVER_ALT_MAX_LENGTH,
      aliases: ['Cover image description', 'Image alt text', 'Alt text'],
      description: 'Kept only beside a cover image.',
    },
  ],
  system: [
    { id: 'createdAt', label: 'Created', type: 'datetime', readOnly: true },
    { id: 'updatedAt', label: 'Updated', type: 'datetime', readOnly: true },
  ],
}

/**
 * How a row finds its event: the Aglyn ID (`id`, the core's
 * `TRANSFER_ID_FIELD`), then the title and the start together — a weekly
 * class is several events under one title, so neither alone is an event.
 */
export const EVENTS_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
  {
    fieldId: 'title',
    normalizer: 'name',
    with: [{ fieldId: 'startsAt', normalizer: 'instant' }],
  },
]

/**
 * Other products' export headers. A calendar that splits the day and the
 * time into two columns (Google Calendar's "Start Date" and "Start Time")
 * cannot be joined into one moment here: its date column maps, and the
 * event starts at midnight unless the cell carries a time.
 */
export const EVENTS_ALIASES: readonly TransferAliasDictionary[] = [
  {
    source: 'Google Calendar',
    aliases: {
      title: ['Subject'],
      startsAt: ['Start Date'],
      endsAt: ['End Date'],
      location: ['Location'],
      description: ['Description'],
    },
  },
  {
    source: 'iCalendar',
    aliases: {
      title: ['SUMMARY'],
      startsAt: ['DTSTART'],
      endsAt: ['DTEND'],
      location: ['LOCATION'],
      description: ['DESCRIPTION'],
    },
  },
  {
    source: 'The Events Calendar (WordPress)',
    aliases: {
      title: ['Event Name'],
      startsAt: ['Event Start Date'],
      endsAt: ['Event End Date'],
      location: ['Event Venue Name'],
      organizer: ['Event Organizer Name'],
      description: ['Event Description'],
      coverImage: ['Event Featured Image'],
    },
  },
]
