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

import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * Another way to write to the person, drawn before **Send email** by
 * whichever plugin keeps a conversation with them (AGL-4020).
 *
 * The CRM's one-to-one composer starts a NEW message from the site's sending
 * address. A person who answered a sequence email is in a thread another
 * plugin keeps, in a member's own mailbox, and the answer belongs in that
 * thread from that mailbox — which only that plugin can send. So the record
 * header hosts this zone ahead of its own button and hands it the person; a
 * plugin with a thread to answer draws its control here, and where none has
 * one the header shows Send email alone.
 */
export type CrmEmailActionsRecordKind = 'contact' | 'lead'

export interface CrmRecordEmailActionsZoneProps {
  /** The site the page is under, or the record's capturing site; `null` at the organization level for a record no site captured. */
  hostId: string | null
  /** The organization the record belongs to; `undefined` while it resolves. */
  orgId: string | undefined
  kind: CrmEmailActionsRecordKind
  recordId: string
  /** The record's name as the page shows it. */
  name: string
  /** The record's address, `null` for one that has none. */
  email: string | null
}

export const CRM_RECORD_EMAIL_ACTIONS_ZONE =
  definePluginZone<CrmRecordEmailActionsZoneProps>('crmRecordEmailActions')

/**
 * Something another plugin does WITH a person, drawn in a contact's header
 * among its actions (AGL-4098): "Start a quote" from the plugin that makes
 * quotes. The CRM may not import it, so the header hosts this zone and hands
 * it the person as the page shows them; a widget decides for itself whether it
 * has anything to offer and writes nothing through the CRM.
 *
 * Unlike `crmRecordEmailActions`, which is another way to WRITE to the person,
 * this zone is for any other act on them.
 */
export interface CrmRecordActionsZoneProps {
  /** The site the page is under, or the record's capturing site; `null` at the organization level for a record no site captured. */
  hostId: string | null
  /** The organization the record belongs to; `undefined` while it resolves. */
  orgId: string | undefined
  kind: 'contact' | 'lead'
  recordId: string
  /** The person as the page shows them; each empty when the record has none. */
  name: string
  email: string | null
  phone: string
  company: string
}

export const CRM_RECORD_ACTIONS_ZONE = definePluginZone<CrmRecordActionsZoneProps>('crmRecordActions')
