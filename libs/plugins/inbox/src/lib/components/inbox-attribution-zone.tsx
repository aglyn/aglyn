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

import { listConsoleWidgets, type ConsolePluginOrgMount } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { Alert, AlertTitle } from '@mui/material'
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

/**
 * The Inbox's Campaigns section: a place, not a table.
 *
 * What arrived and who it came from sit beside what was sent to them, so the
 * Inbox keeps a Campaigns tab. The campaigns themselves belong to a plugin
 * that sends them, which draws its own card here; the Inbox hands it the site
 * and nothing else.
 *
 * On the organization's Inbox there is no site (AGL-3303): `hostId` is
 * `null` and `orgMount` names the organization and its sites, which is the
 * shell's own shape for a surface mounted with no site. A widget lists every
 * site's campaigns then, the way the organization's Marketing page does.
 */
export interface InboxCampaignsZoneProps {
  hostId: string | null
  /** Present exactly when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
}

export const INBOX_CAMPAIGNS_ZONE =
  definePluginZone<InboxCampaignsZoneProps>('inboxCampaigns')

export function InboxCampaignsZone(props: InboxCampaignsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  // Read at render, after the shell has loaded its plugins.
  if (!Slot || listConsoleWidgets(INBOX_CAMPAIGNS_ZONE.id).length === 0) {
    return (
      <Alert severity="info">
        <AlertTitle>{'Campaigns are part of Marketing'}</AlertTitle>
        {props.hostId == null
          ? 'Marketing is switched off for this workspace, so there are no ' +
            'campaigns to show here.'
          : 'Marketing is switched off for this workspace or this site, so ' +
            'there are no campaigns to show here.'}
      </Alert>
    )
  }
  return <Slot slot={INBOX_CAMPAIGNS_ZONE.id} {...props} />
}
InboxCampaignsZone.displayName = 'InboxCampaignsZone'
