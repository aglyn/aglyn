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

import { listConsoleWidgets } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * Where a CRM record came from, drawn by whichever plugin can say.
 *
 * A contact's page and a lead's history both have a place for "which campaign
 * or link brought this person". The CRM keeps the person; it does not keep
 * campaigns, and it used to import the marketing plugin's component to fill
 * the gap. It hosts this zone instead and hands it the record's identity, and
 * a plugin that credits conversions draws what it knows.
 */
export interface CrmRecordAttributionZoneProps {
  hostId: string
  /** What the record is, in the CRM's own words. */
  recordKind: 'contact' | 'lead'
  recordId: string
}

export const CRM_RECORD_ATTRIBUTION_ZONE =
  definePluginZone<CrmRecordAttributionZoneProps>('crmRecordAttribution')

/** Whether anything registered for the zone, for a caption that introduces it. */
export function useHasCrmRecordAttribution(): boolean {
  const Slot = useConsoleWidgetSlot()
  return (
    Slot !== null &&
    listConsoleWidgets(CRM_RECORD_ATTRIBUTION_ZONE.id).length > 0
  )
}

export function CrmRecordAttributionZone(props: CrmRecordAttributionZoneProps) {
  const Slot = useConsoleWidgetSlot()
  if (!Slot) return null
  return <Slot slot={CRM_RECORD_ATTRIBUTION_ZONE.id} {...props} />
}
CrmRecordAttributionZone.displayName = 'CrmRecordAttributionZone'
