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
 * A person, a company and a deal are records of the workspace's record
 * system, and what happened with them — an email sent, a reply received, a
 * call to make — belongs on their timeline, whichever plugin it happened in.
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
 *    system, is refused — answered, never thrown.
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

/** The record an entry is filed on: any of the four, as the owner links them. */
export interface PluginRecordLink {
  contactId?: string
  companyId?: string
  dealId?: string
  /**
   * A lead not yet converted (AGL-3234) — the record system's own id for
   * it, addressed under `hostId`. A sequence's emails and tasks land on the
   * lead's page while the person is one, and follow the lead to the contact
   * it becomes.
   */
  leadId?: string
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
  /** The member it is for, or `''` for nobody. */
  assigneeUid: string
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

export interface PluginRecordTimelineWriter {
  logActivity(request: PluginRecordActivityRequest): Promise<PluginRecordWrite>
  createTask(request: PluginRecordTaskRequest): Promise<PluginRecordWrite>
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
