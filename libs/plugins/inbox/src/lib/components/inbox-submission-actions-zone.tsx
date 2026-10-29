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
 * Something to DO with an open submission, drawn by the plugin that does it
 * (AGL-4098): "Start a quote" on a quote request, from the plugin that makes
 * quotes. The Inbox lists what arrived and may not import that plugin, so it
 * hosts this zone among the open submission's actions and hands it what the
 * submission is; a widget decides for itself whether it has anything to offer
 * (a quote for a `quote` request, nothing for an ordinary message).
 *
 * The widget reads anything more it needs through the forms plugin's facts
 * reader on the server, under its own permission, and writes nothing through
 * the Inbox.
 */
export interface InboxSubmissionActionsZoneProps {
  /** The site the submission was sent on. */
  hostId: string
  submissionId: string
  /** What the submission asks for (`quote`), or null for an ordinary message. */
  requestKind: string | null
  /** The form it was sent to, as it was called when it arrived. */
  formName: string
}

export const INBOX_SUBMISSION_ACTIONS_ZONE =
  definePluginZone<InboxSubmissionActionsZoneProps>('inboxSubmissionActions')

/** One control among the open submission's actions: the zone is `bare`. */
export function InboxSubmissionActionsZone(props: InboxSubmissionActionsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  if (!Slot) return null
  return <Slot slot={INBOX_SUBMISSION_ACTIONS_ZONE.id} {...props} />
}
InboxSubmissionActionsZone.displayName = 'InboxSubmissionActionsZone'
