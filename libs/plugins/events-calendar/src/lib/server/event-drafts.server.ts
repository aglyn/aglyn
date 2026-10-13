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

import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  checkEventDraftContent,
  eventDraftWallText,
  readEventDraftContent,
} from '../model/event-draft-content'
import { eventWrite } from '../model/event-write'

/**
 * AN EVENT ANOTHER PLUGIN ASKS FOR (AGL-3743).
 *
 * The draft writer this plugin registers for the `event` resource on the
 * core's resource-drafts seam. A plugin that sets a site up from a brief —
 * an AI build — asks for the writer by name and gets this plugin's rules:
 *
 *  - THE DOCUMENT is a `hosts/{hostId}/events/{id}` event stored through
 *    `eventWrite`, the one rule the Events page's editor and the events
 *    import write through, born `status: 'draft'`. A draft is listed nowhere
 *    on the site — the public listing asks for `status == 'published'` —
 *    until a person sets it published on the Events page.
 *  - THE PLAN is the `eventCalendar` add-on the Events page is gated on, read
 *    from the workspace's own document the way the listing and the import
 *    read it. There is no allowance to count.
 *  - THE ROLE is a member who may write the site's content.
 *  - THE START is after the write. A draft that would open on the Events page
 *    already over is a mistake in what was asked, so it is refused rather
 *    than stored.
 *
 * Nothing is published. The writer touches the one new document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The refusal for a member who may not write the site. */
export const EVENT_DRAFT_ROLE_REFUSAL = 'Editing requires the editor role'

/** The refusal for a workspace without the add-on, in the Events page's words. */
export const EVENT_DRAFT_PLAN_REFUSAL =
  'The Event Calendar is a paid add-on: enable it from Billing → Add-ons'

/** The refusal for a start that is not after the write. */
export function eventDraftPastRefusal(wallText: string): string {
  return `A drafted event starts in the future: ${wallText} has already passed`
}

function isDeleted(data: Readonly<Record<string, unknown>> | undefined): boolean {
  return Boolean(data?.['deletedAt']) || data?.['status'] === 'deleted'
}

function recordOf(event: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (event.data() ?? {}) as Record<string, unknown>
  return {
    id: event.id,
    name: String(data['title'] ?? ''),
    versionId: null,
    facts: {
      status: data['status'] === 'published' ? 'published' : 'draft',
      startsAtMs: Number(data['startsAtMs'] ?? 0),
      endsAtMs: Number(data['endsAtMs'] ?? 0),
    },
  }
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: EVENT_DRAFT_ROLE_REFUSAL }
}

function planRefusal(org: PluginDraftContext['org']): PluginDraftRefusal | null {
  return checkEntitlement(org as never, 'eventCalendar')
    ? null
    : { status: 403, error: EVENT_DRAFT_PLAN_REFUSAL }
}

export interface EventDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

export function createEventDraftWriter(deps: EventDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  return {
    refusal: async (context) => {
      const host = await firestore().collection('hosts').doc(context.hostId).get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      return roleRefusal(host, context.uid) ?? planRefusal(context.org)
    },

    check: (content) => checkEventDraftContent(content),

    read: async ({ hostId, id }) => {
      const event = await firestore().collection('hosts').doc(hostId).collection('events').doc(id).get()
      return event.exists && !isDeleted(event.data()) ? recordOf(event) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The request's name is the one asked for; the content's stands in.
      const asked = request.name.replace(/[\p{Cc}\s]+/gu, ' ').trim()
      const read = readEventDraftContent(asked ? { ...request.content, title: asked } : request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      if (read.value.startsAtMs <= request.now.getTime()) {
        return {
          ok: false,
          status: 400,
          error: eventDraftPastRefusal(eventDraftWallText(read.value.startsAtMs, read.timezone)),
        }
      }
      const write = eventWrite(read.value)
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const eventRef = hostRef.collection('events').doc(request.id)
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        const [host, existing] = await Promise.all([tx.get(hostRef), tx.get(eventRef)])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        if (existing.exists) {
          // Asked again under the same id: the draft it already wrote — unless
          // a person deleted it since, which a replay never brings back.
          return isDeleted(existing.data())
            ? { ok: false, status: 409, error: 'That event was deleted on the Events page' }
            : { ok: true, replayed: true, ...recordOf(existing) }
        }
        const early = roleRefusal(host, request.uid) ?? planRefusal(request.org)
        if (early) return { ok: false, ...early }
        tx.create(eventRef, {
          ...write.fields,
          createdAt: request.now,
          updatedAt: request.now,
          createdBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: write.fields.title,
          versionId: null,
          facts: {
            status: 'draft',
            startsAtMs: write.fields.startsAtMs,
            endsAtMs: write.fields.endsAtMs,
          },
        }
      })
    },
  }
}

export const eventDraftWriter = createEventDraftWriter()
