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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * An entry one plugin files on a record another plugin keeps (AGL-2981).
 *
 * A person and the company they work for are records of the workspace's
 * record system, and what happened with them — an email sent, a reply
 * received, a call to make — belongs on their timeline, whichever plugin it
 * happened in.
 * A plugin that sends mail or books a meeting must not write the record
 * system's documents itself: it would restate the owner's rules — where an
 * entry lives, who may see it, how a copy of the same email is told apart,
 * how many entries a record may carry — and drift from them the day the
 * owner changes one. Nor may it import the owner, which the package map
 * forbids.
 *
 * So the record system registers a WRITER here, from its server surfaces,
 * and a caller asks for it. Every rule stays the owner's:
 *
 *  - the entry is stamped with the scope a record made on the site would
 *    carry, so it is visible to exactly who sees the record;
 *  - an EMAIL is filed once per `Message-ID`, under the id the owner files a
 *    copy of the same message by through any other door — a copy the rep
 *    forwarded to a capture address is the same entry, not a second one;
 *  - any other entry, and every task, is filed once per the caller's own
 *    `dedupeKey`, so a caller that runs again finds what it wrote rather
 *    than writing it twice;
 *  - a record whose log is full, or a workspace whose plan carries no record
 *    system, is refused — answered, never thrown;
 *  - a caller that knows a record only as the owner handed it over — a kind
 *    and an id carried on a link — or knows only the person's address is
 *    answered with the record the owner finds for it, on that site, or
 *    refused with a 404 when it finds none.
 *
 * A single-implementation contract: a workspace keeps one record system.
 *
 * ## The caller proves who is asking
 *
 * Like `plugin-resource-drafts`, the registry authenticates nobody. The
 * caller decides, in its own terms and before it asks, that the entry is
 * the workspace's to write — that the record is one it acted on, for the
 * member it acted for.
 */

/**
 * The record an entry is filed on: the person (a contact, or a lead not yet
 * one) and the company they work for, as the owner links them — or, from a
 * caller that holds no id of the owner's, how to find the record.
 *
 * The ids win where given, and are filed on as named. Otherwise `record`,
 * then `email`: the owner looks the record up as the entry's site sees it,
 * links whatever it groups that record under itself, and refuses the entry
 * with a 404 when it finds nothing.
 */
export interface PluginRecordLink {
  contactId?: string
  companyId?: string
  /**
   * A lead not yet converted (AGL-3234) — the record system's own id for
   * it, addressed under `hostId`. A sequence's emails and tasks land on the
   * lead's page while the person is one, and follow the lead to the contact
   * it becomes.
   */
  leadId?: string
  /**
   * A record the owner handed the caller, by its kind and id in the owner's
   * own words, and carried back unread (AGL-2660): the record a booking link
   * was dropped from, through the zone the owner drew it in. A kind the
   * owner does not keep, or a record the site cannot see, is passed over for
   * `email` rather than refused.
   */
  record?: { kind: string; id: string } | null
  /**
   * The person at this address, as the entry's site knows them: what the
   * entry lands on when nothing above names a record the owner finds — a
   * booking taken off the widget cold.
   */
  email?: string | null
}

/** Where an entry is filed, and by which plugin. */
export interface PluginRecordEntryContext {
  orgId: string
  /** The site whose scope the entry carries: as if a member made it there. */
  hostId: string
  link: PluginRecordLink
  /** The plugin filing it, recorded on the entry. */
  sourcePluginId: string
}

/** What an activity is, in the record system's own words. */
export type PluginRecordActivityKind = 'email' | 'call' | 'meeting' | 'note' | 'other'

/** The message an `email` activity is about. */
export interface PluginRecordEmail {
  /** `outbound` for one the workspace wrote; `inbound` for one written to it. */
  direction: 'outbound' | 'inbound'
  subject: string
  /** The address on the message's From. */
  from: string
  /** The address it was written to, when one is worth showing. */
  to: string | null
  /** The `Message-ID` header, angle brackets included: what files it once. */
  messageId: string
  /** The `Message-ID` it answered, when it answered one. */
  inReplyTo?: string | null
}

export interface PluginRecordActivityRequest extends PluginRecordEntryContext {
  kind: PluginRecordActivityKind
  /** When it happened, epoch ms. */
  atMs: number
  /** Plain text: an email's excerpt, a note's words. The owner bounds it. */
  body: string
  /** The member it is by, or `''` for none. */
  byUid: string
  byName?: string | null
  /** Required for an `email`, and read only for one. */
  email?: PluginRecordEmail | null
  /** Required for every kind but `email`: the caller's id for this entry. */
  dedupeKey?: string | null
}

/** What a task is, in the record system's own words. */
export type PluginRecordTaskKind = 'call' | 'email' | 'meeting' | 'todo'

export interface PluginRecordTaskRequest extends PluginRecordEntryContext {
  /** The caller's id for this task: the same key never makes a second task. */
  dedupeKey: string
  title: string
  notes?: string | null
  kind: PluginRecordTaskKind
  /** When it is due, epoch ms. */
  dueAtMs: number
  /**
   * The member it is for, `''` for nobody, or `null` for whoever holds the
   * record it lands on — the caller that found the record by `record` or
   * `email` does not know who that is.
   */
  assigneeUid: string | null
  /** The member who made it happen, or `''` when nobody did. */
  createdByUid: string
}

/**
 * The owner's answer. `created: false` is the entry a previous write — or a
 * copy through another door — already filed, under the same `id`.
 */
export type PluginRecordWrite =
  | { ok: true; id: string; created: boolean }
  | {
      ok: false
      status: 400 | 403 | 404 | 409
      /** Customer-safe: a caller may show or log it as it stands. */
      error: string
    }

/**
 * What became of an email a plugin filed (AGL-3245): the receiving server
 * bounced it, or the recipient reported it. Addressed by the `Message-ID`
 * the send was filed under, so the verdict lands on the send's own entry
 * and the record reads Sent, then Bounced.
 */
export interface PluginRecordDeliveryRequest {
  orgId: string
  /** The `Message-ID` header of the send, angle brackets included. */
  messageId: string
  state: 'bounced' | 'complained'
  /** When it happened, epoch ms. */
  atMs: number
  /** What the server said, scrubbed of the address; the owner bounds it. */
  detail?: string | null
}

/**
 * An email a plugin is about to send to a person (AGL-3080), offered to the
 * record system BEFORE it goes so the entry it files can follow the
 * message's delivery: the record system answers with the provider tags the
 * message has to carry for the delivery webhook to find the entry, and with
 * how to file it once the provider has accepted it.
 *
 * Only a message addressed to the person `link` names — the person an
 * automation's event is about — earns an entry: an alert routed to the
 * merchant's own inbox would put that inbox on a customer's history.
 */
export interface PluginRecordEmailPrepareRequest {
  orgId: string
  /** The site the message goes out as: the entry carries its scope. */
  hostId: string
  /** The address the message is sent to, raw. */
  to: string
  /** The person the sender means: by id where it holds one, else by address. */
  link: Pick<PluginRecordLink, 'contactId' | 'email'>
  /**
   * The organization's billing document, when the caller already read it —
   * the record system's plan gate and scope read it; absent, the owner reads
   * it itself.
   */
  org?: unknown
}

/** The message as it was sent, for the entry the record system files. */
export interface PluginRecordEmailSent {
  subject: string
  body: string
  to: string
  /** When it was accepted, epoch ms; now when absent. */
  atMs?: number
  /** The sender's own id for what sent it — an automation's id. */
  sourceRef: string
}

/** What the record system answered a prepared email with. */
export interface PluginRecordPreparedEmail {
  /** Provider tags the message must carry for its delivery to reach the entry. */
  tags: ReadonlyArray<{ name: string; value: string }>
  /** Files the entry, once the provider accepted the message. Never throws. */
  file(sent: PluginRecordEmailSent): Promise<void>
}

/**
 * A delivery event the provider reported for a message that carried tags
 * (AGL-2615, AGL-3080), handed over by the webhook that heard it. The record
 * system filed the entry the tags name when the message was prepared
 * (`prepareEmail`, or its own send), so only it can read them: the webhook
 * hands every tag the message carried and the event in the delivery log's
 * own vocabulary, and the record system moves the entry the tags name, if
 * any, to that state.
 */
export interface PluginRecordTaggedDeliveryRequest {
  /** Every tag the message carried, by name, as the provider echoed them. */
  tags: Readonly<Record<string, string>>
  /** The normalized event — `delivered`, `opened`, `clicked`, `bounced`, `complained`. */
  event: string
  /** When the provider says it happened, epoch ms. */
  atMs: number
}

export interface PluginRecordTimelineWriter {
  logActivity(request: PluginRecordActivityRequest): Promise<PluginRecordWrite>
  createTask(request: PluginRecordTaskRequest): Promise<PluginRecordWrite>
  /**
   * Prepares the entry an email to a person will earn (AGL-3080). Optional:
   * a record system that files no sent mail answers nothing. `null` for a
   * message that earns no entry. Never throws.
   */
  prepareEmail?(request: PluginRecordEmailPrepareRequest): Promise<PluginRecordPreparedEmail | null>
  /**
   * Moves the entry a delivered message's tags name to the event's state
   * (AGL-3080). Optional: a record system that files no sent mail answers
   * nothing. Tags that name no entry of its own are its to ignore. Never
   * throws.
   */
  recordTaggedDelivery?(request: PluginRecordTaggedDeliveryRequest): Promise<void>
  /**
   * Marks a filed email bounced or reported (AGL-3245). Optional: a record
   * system that keeps no delivery state answers nothing, and the caller's
   * entry stands as filed.
   */
  recordEmailDelivery?(request: PluginRecordDeliveryRequest): Promise<PluginRecordWrite>
}

export const PLUGIN_RECORD_TIMELINE = definePluginServiceContract<PluginRecordTimelineWriter>(
  'core.record-timeline',
  { multiple: false },
)

/**
 * Registers the workspace's record timeline writer. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with neither
 * the registration throws, and a second plugin's writer is refused naming
 * both — the incumbent keeps serving.
 */
export function registerPluginRecordTimelineWriter(
  writer: PluginRecordTimelineWriter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_RECORD_TIMELINE, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

export interface ResolvedPluginRecordTimelineWriter {
  /** The plugin that keeps the records. */
  pluginId: string
  writer: PluginRecordTimelineWriter
}

/** The writer, with its owner, or `null` when no plugin keeps records here. */
export function pluginRecordTimelineWriter(): ResolvedPluginRecordTimelineWriter | null {
  const entry = resolvePluginServices(PLUGIN_RECORD_TIMELINE)[0]
  return entry ? { pluginId: entry.pluginId, writer: entry.impl } : null
}

/**
 * Asks whichever plugin keeps records to prepare the entry an email to a
 * person will earn, or answers `null` when none does, the one that does
 * files no sent mail, or this message earns no entry. Never throws: the
 * entry is bookkeeping beside a send, and a lookup that failed must not
 * become a message that never left.
 */
export async function preparePluginRecordEmail(
  request: PluginRecordEmailPrepareRequest,
): Promise<PluginRecordPreparedEmail | null> {
  const resolved = pluginRecordTimelineWriter()
  if (!resolved?.writer.prepareEmail) return null
  try {
    return await resolved.writer.prepareEmail(request)
  } catch (error) {
    console.error('[record-timeline] the record system could not prepare an email entry', error)
    return null
  }
}

/**
 * Hands a delivery event to whichever plugin keeps records, for the entry the
 * message's tags name (AGL-3080). Does nothing when no plugin keeps records or
 * the one that does files no sent mail. Never throws: the webhook answers the
 * provider whatever happens here.
 */
export async function recordPluginTaggedEmailDelivery(
  request: PluginRecordTaggedDeliveryRequest,
): Promise<void> {
  const resolved = pluginRecordTimelineWriter()
  if (!resolved?.writer.recordTaggedDelivery) return
  try {
    await resolved.writer.recordTaggedDelivery(request)
  } catch (error) {
    console.error('[record-timeline] the record system could not record a delivery', error)
  }
}
