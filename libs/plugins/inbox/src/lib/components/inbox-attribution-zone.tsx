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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * Where a lead or a submission came from, drawn by whichever plugin can say.
 *
 * The Inbox lists what arrived; which campaign or link brought it is a
 * question for a plugin that credits conversions. The Inbox used to import
 * the marketing plugin's component to answer it. It hosts this zone instead,
 * in a lead's "Where this came from" dialog and under an open submission, and
 * hands it the record's identity.
 */
export interface InboxRecordAttributionZoneProps {
  hostId: string
  /** What the record is, in the Inbox's own words. */
  recordKind: 'lead' | 'form'
  recordId: string
}

export const INBOX_RECORD_ATTRIBUTION_ZONE =
  definePluginZone<InboxRecordAttributionZoneProps>('inboxRecordAttribution')

export function InboxRecordAttributionZone(
  props: InboxRecordAttributionZoneProps,
) {
  const Slot = useConsoleWidgetSlot()
  if (!Slot) return null
  return <Slot slot={INBOX_RECORD_ATTRIBUTION_ZONE.id} {...props} />
}
InboxRecordAttributionZone.displayName = 'InboxRecordAttributionZone'
