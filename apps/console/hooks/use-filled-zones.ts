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

import type { ConsoleNavSection } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { useSlotWidgets } from '../components/plugin-widget-slot.component'

const NO_ZONES: readonly string[] = []

/**
 * The zones a hub's zone-only sections name that have a widget for this
 * reader (AGL-3713) — what `resolveHubSections` reads as `filledZones`.
 *
 * Asked through `useSlotWidgets`, the gate `PluginWidgetSlot` renders from,
 * so a section is offered exactly when its page would draw something: the
 * same registration, enablement, entitlement, permission and release
 * verdicts, and the same rule that a table column is not a card. Withheld
 * (an empty set) until every gate has settled, so a section is never drawn
 * and then taken away.
 *
 * Loads the zones' plugins, which is what lets it answer. A hub that
 * declares no `onlyWithZones` asks for nothing and loads nothing.
 */
export function useFilledZones(
  sections: readonly ConsoleNavSection[] | undefined,
): ReadonlySet<string> {
  const zones = useMemo(() => {
    const named = new Set<string>()
    for (const section of sections ?? [])
      for (const zone of section.onlyWithZones ?? []) named.add(zone)
    return named.size ? [...named].sort() : NO_ZONES
  }, [sections])
  const { widgets, ready } = useSlotWidgets(zones)
  // Keyed by the answer, not by the array: `useSlotWidgets` builds a new list
  // every render, and a new set every render would re-resolve the rail.
  const key = ready
    ? [
        ...new Set(
          widgets
            .filter((widget) => widget.column === undefined)
            .map((widget) => widget.slot),
        ),
      ]
        .sort()
        .join('\n')
    : ''
  return useMemo(() => new Set(key ? key.split('\n') : []), [key])
}
