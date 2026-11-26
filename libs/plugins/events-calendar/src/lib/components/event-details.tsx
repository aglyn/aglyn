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
import { mdiCalendarText } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import type { EventDetailsProps } from './event-details-body'

export type { EventDetailsProps } from './event-details-body'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'eventDetails'

/**
 * The element's body loads when a page draws it (AGL-4252), so a page that
 * places only the Event List never fetches the calendar's code.
 */
const Body = lazy(() => import('./event-details-body'))

const EventDetails = forwardRef<HTMLDivElement, EventDetailsProps>(
  (props, ref) => (
    <Suspense fallback={<Box ref={ref} />}>
      <Body ref={ref} {...props} />
    </Suspense>
  ),
)
EventDetails.displayName = 'EventDetails'

export const schema: Aglyn.ComponentSchema<EventDetailsProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Event details',
  description:
    'The event a calendar link opens: its date, place, tickets, add to calendar and next dates. Place it on your event page.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCalendarText.path, sx: { color: '#7b1fa2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'emptyText',
      description:
        'Shown when the link names no event, or one no longer on the calendar.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'When there is no event',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Event details',
    pluginId: BUNDLE_ID,
    description: 'One event, opened from the calendar (add-on)',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCalendarText.path, sx: { color: '#7b1fa2' } },
    data: { $id: null, componentId: ID, pluginId: BUNDLE_ID, props: {} },
  },
]

export default EventDetails
