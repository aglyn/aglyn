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
import { mdiCalendarMonth } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import type { EventCalendarProps } from './event-calendar-body'

export type { EventCalendarProps } from './event-calendar-body'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'eventCalendar'

/**
 * The element's body loads when a page draws it (AGL-4252), so a page that
 * places only the Event List never fetches the calendar's code.
 */
const Body = lazy(() => import('./event-calendar-body'))

const EventCalendar = forwardRef<HTMLDivElement, EventCalendarProps>(
  (props, ref) => (
    <Suspense fallback={<Box ref={ref} />}>
      <Body ref={ref} {...props} />
    </Suspense>
  ),
)
EventCalendar.displayName = 'EventCalendar'

export const schema: Aglyn.ComponentSchema<EventCalendarProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Calendar',
  description:
    'Your published events by month, week or list, with category filters, search, tickets and add to calendar.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCalendarMonth.path, sx: { color: '#7b1fa2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      description: 'Heading above the calendar; empty hides it.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Heading',
    },
    {
      name: 'defaultView',
      description:
        'The view a computer or tablet opens on. Phones always show the list.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Opens on',
      options: [
        { value: '', label: 'Month (default)' },
        { value: 'week', label: 'Week' },
        { value: 'list', label: 'List' },
      ],
    },
    {
      name: 'listDays',
      description: 'How many days the list shows at once (default 60).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'List days',
      type: 'number',
    },
    {
      name: 'hideCategories',
      label: 'Hide category filters',
      description: 'Hides the row of category chips above the calendar.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'hideSearch',
      label: 'Hide search',
      description: 'Hides the box visitors search the events with.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'hideSubscribe',
      label: 'Hide subscribe link',
      description:
        'Hides the link that adds the whole calendar to a visitor’s calendar app.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Calendar',
    pluginId: BUNDLE_ID,
    description: 'Month, week and list views of your events (add-on)',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCalendarMonth.path, sx: { color: '#7b1fa2' } },
    data: { $id: null, componentId: ID, pluginId: BUNDLE_ID, props: {} },
  },
]

export default EventCalendar
