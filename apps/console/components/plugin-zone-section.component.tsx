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

'use client'

import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { Box } from '@mui/material'
import PluginWidgetSlot from './plugin-widget-slot.component'

/**
 * A hub section that is nothing but a plugin zone (AGL-3711).
 *
 * A hub draws its sections in a content column beside the rail. A zone that
 * the hub's LAYOUT rendered sat outside that column — under the rail, at full
 * width, on every section — so a zone that belongs to the hub as a whole gets
 * a section of its own, and this is its body: the zone, inside the column,
 * where the hub's own cards are.
 *
 * The rail offers the section only while the zone has a card for this reader
 * (`useSlotHasWidgets`). A card can still decide to draw nothing — a
 * deployment that cannot hold the connection it manages — so when the zone
 * renders no card at all, or a stack every card of which drew nothing (`:empty`),
 * the fallback says so instead of leaving a blank page. The check is CSS, not
 * state: a widget's choice to draw nothing is made inside its own render, and
 * nothing outside it can read that choice.
 */
export default function PluginZoneSection({
  slot,
  emptyLabel,
  emptyDescription,
  ...zoneProps
}: {
  slot: string
  emptyLabel: string
  emptyDescription?: string
} & Record<string, unknown>) {
  return (
    <Box
      data-zone-section={slot}
      sx={{
        '& > [data-widget-zone]:not(:empty) ~ [data-zone-fallback]': {
          display: 'none',
        },
      }}
    >
      <PluginWidgetSlot slot={slot} {...zoneProps} />
      <Box data-zone-fallback="">
        <EmptyStateComponent
          compact
          label={emptyLabel}
          description={emptyDescription}
        />
      </Box>
    </Box>
  )
}
