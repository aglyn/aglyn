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

import type {
  PluginRecordLink,
  PluginRecordTaskKind,
  PluginRecordWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { OUTREACH_PLUGIN_ID } from '../constants/bundle-common'
import type { OutreachTaskKind } from '../model/outreach.types'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * OUTREACH ON THE CONTACT'S TIMELINE (AGL-2981).
 *
 * Every email a sequence sends, every reply it reads, and every task it
 * asks of the rep goes onto the contact's record through the core's
 * record-timeline seam — whichever plugin keeps the workspace's records —
 * never by writing that plugin's documents. An email is filed once per
 * `Message-ID`, under the id the capture address would file a forwarded copy
 * by; a task once per the key given here.
 *
 * The timeline is bookkeeping beside the act: an email has already left
 * when it is filed, so a writer that refuses or fails is logged and the
 * send stands. A workspace with no record system files nothing.
 */

/** The record system's word for a step's task kind. */
export const OUTREACH_TASK_KIND_TO_RECORD: Record<OutreachTaskKind, PluginRecordTaskKind> = {
  call: 'call',
  linkedin: 'todo',
  todo: 'todo',
}

/** Files one email on a person's record — the contact, or the lead while they are one (AGL-3234); never throws. */
export async function fileOutreachEmail(
  deps: Pick<OutreachRuntimeDeps, 'timeline'>,
  input: {
    orgId: string
    hostId: string
    /** The record the entry lands on: `{ contactId }` or `{ leadId }`. */
    link: PluginRecordLink
    direction: 'outbound' | 'inbound'
    subject: string
    from: string
    to: string | null
    messageId: string
    inReplyTo?: string | null
    body: string
    atMs: number
    byUid: string
    byName?: string | null
  },
): Promise<PluginRecordWrite | null> {
  const writer = deps.timeline()
  if (!writer) return null
  try {
    const written = await writer.logActivity({
      orgId: input.orgId,
      hostId: input.hostId,
      link: input.link,
      sourcePluginId: OUTREACH_PLUGIN_ID,
      kind: 'email',
      atMs: input.atMs,
      body: input.body,
      byUid: input.byUid,
      byName: input.byName ?? null,
      email: {
        direction: input.direction,
        subject: input.subject,
        from: input.from,
        to: input.to,
        messageId: input.messageId,
        inReplyTo: input.inReplyTo ?? null,
      },
    })
    if (written.ok === false) console.warn(`[outreach] the record system did not file an email: ${written.error}`)
    return written
  } catch (error) {
    console.error('[outreach] filing an email on the record failed', error)
    return null
  }
}

/**
 * Files one task on a contact. Answers the record system's answer, `null`
 * when the workspace keeps no records; a writer that THROWS is the caller's,
 * which a step waits out rather than completing without its task.
 */
export async function fileOutreachTask(
  deps: Pick<OutreachRuntimeDeps, 'timeline'>,
  input: {
    orgId: string
    hostId: string
    /** The record the task lands on: `{ contactId }` or `{ leadId }`. */
    link: PluginRecordLink
    dedupeKey: string
    title: string
    notes?: string | null
    kind: PluginRecordTaskKind
    dueAtMs: number
    assigneeUid: string
  },
): Promise<PluginRecordWrite | null> {
  const writer = deps.timeline()
  if (!writer) return null
  return writer.createTask({
    orgId: input.orgId,
    hostId: input.hostId,
    link: input.link,
    sourcePluginId: OUTREACH_PLUGIN_ID,
    dedupeKey: input.dedupeKey,
    title: input.title,
    notes: input.notes ?? null,
    kind: input.kind,
    dueAtMs: input.dueAtMs,
    assigneeUid: input.assigneeUid,
    createdByUid: '',
  })
}
