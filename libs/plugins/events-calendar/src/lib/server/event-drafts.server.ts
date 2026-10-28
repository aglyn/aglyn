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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import type {
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftRequest,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  stockPhotoPicker,
  type StockPhotoPicker,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  checkEventDraftContent,
  EVENT_DRAFT_COVER_ADDRESS,
  eventDraftWallText,
  readEventDraftContent,
} from '../model/event-draft-content'
import { EVENT_COVER_ALT_MAX_LENGTH, eventWrite } from '../model/event-write'

/**
 * AN EVENT ANOTHER PLUGIN ASKS FOR (AGL-3743).
 *
 * The draft writer this plugin registers for the `event` resource on the
 * core's resource-drafts seam. A plugin that sets a site up from a brief —
 * an AI build — asks for the writer by name and gets this plugin's rules:
 *
 *  - THE DOCUMENT is a `hosts/{hostId}/events/{id}` event stored through
 *    `eventWrite`, the one rule the Events page's editor and the events
 *    import write through.
 *  - PUBLISHED when the member may publish (AGL-3755): the Events page's
 *    "Set published" is the event's `status` set to `published` and nothing
 *    else, so that is all this writer changes. The member must hold the
 *    publishing role (`hostRoleCanPublish`, admin or editor), the axis every
 *    other publish asks. A member who may write but not publish (`author`)
 *    gets the event as a draft, `live: false`, with a notice saying why, and
 *    it waits on the Events page for someone who may.
 *  - THE PLAN is the `eventCalendar` add-on the Events page is gated on, read
 *    from the workspace's own document the way the listing and the import
 *    read it. There is no allowance to count.
 *  - THE ROLE is a member who may write the site's content.
 *  - THE START is after the write. A draft that would open on the Events page
 *    already over is a mistake in what was asked, so it is refused rather
 *    than stored.
 *  - THE COVER (AGL-3755), when the content names none: a photo of the
 *    event's title from the deployment's stock photo picker
 *    (`core.stock-photo-picker`), kept in the site's own media library once
 *    and reused after, or a starter photo when the library is down. It is
 *    the editor's own "Cover image URL" field, `coverImage`, holding the
 *    photo's site-relative address. Photos of one act (the AI build) never
 *    repeat. A process with no picker writes the event without a cover.
 *
 * The writer touches the one new document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The refusal for a member who may not write the site. */
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const EVENT_DRAFT_ROLE_REFUSAL = siteKeyRefusal('site.edit')

/** The refusal for a workspace without the add-on, in the Events page's words. */
export const EVENT_DRAFT_PLAN_REFUSAL =
  'The Event Calendar is a paid add-on: enable it from Billing → Add-ons'

/** Why an event a member wrote was kept as a draft: they may write the site, not publish it. */
export const EVENT_DRAFT_UNPUBLISHED_NOTICE =
  'Kept as a draft: publishing an event takes the editor role, so someone who has it publishes it on the Events page.'

/** The refusal for a start that is not after the write. */
export function eventDraftPastRefusal(wallText: string): string {
  return `A drafted event starts in the future: ${wallText} has already passed`
}

function isDeleted(data: Readonly<Record<string, unknown>> | undefined): boolean {
  return Boolean(data?.['deletedAt']) || data?.['status'] === 'deleted'
}

/** What a written event reports: published or a draft, and why a draft when it is one. */
function liveOf(published: boolean): Pick<PluginDraftRecord, 'live' | 'notice'> {
  return published ? { live: true } : { live: false, notice: EVENT_DRAFT_UNPUBLISHED_NOTICE }
}

function recordOf(event: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (event.data() ?? {}) as Record<string, unknown>
  const published = data['status'] === 'published'
  return {
    id: event.id,
    name: String(data['title'] ?? ''),
    versionId: null,
    facts: {
      status: published ? 'published' : 'draft',
      startsAtMs: Number(data['startsAtMs'] ?? 0),
      endsAtMs: Number(data['endsAtMs'] ?? 0),
      ...(typeof data['coverImage'] === 'string' ? { coverImage: data['coverImage'] } : {}),
    },
    ...liveOf(published),
  }
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  return holdsSiteKey(host, uid, 'site.edit') ? null : { status: 403, error: EVENT_DRAFT_ROLE_REFUSAL }
}

function planRefusal(org: PluginDraftContext['org']): PluginDraftRefusal | null {
  return checkEntitlement(org as never, 'eventCalendar')
    ? null
    : { status: 403, error: EVENT_DRAFT_PLAN_REFUSAL }
}

export interface EventDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
  /** The stock photo picker a cover comes from; specs hand in a double. */
  stockPhotos?: () => StockPhotoPicker | null
}

/**
 * A cover for an event the content gave none: the picker's, held to what the
 * editor's field takes, with the words that describe it (AGL-3856): a cover
 * the event list drew with `alt=""` hid a yoga pose under "Open gym strength
 * session" from a screen reader.
 */
async function coverFor(
  picker: StockPhotoPicker | null,
  request: PluginDraftRequest,
  title: string,
): Promise<{ src: string; alt: string | null } | null> {
  if (!picker) return null
  try {
    const pick = await picker.pick({
      hostId: request.hostId,
      uid: request.uid,
      subject: title,
      ...(request.act?.business ? { business: request.act.business } : {}),
      orientation: 'horizontal',
      ...(request.act?.id ? { scope: request.act.id } : {}),
      // The draft's id: asked again, the same photo.
      seed: request.id,
    })
    if (!pick || !EVENT_DRAFT_COVER_ADDRESS.test(pick.url)) return null
    const alt = pick.alt?.replace(/\s+/g, ' ').trim().slice(0, EVENT_COVER_ALT_MAX_LENGTH) ?? ''
    return { src: pick.url, alt: alt || null }
  } catch (error) {
    console.warn('event draft: no cover photo', { error: String(error) })
    return null
  }
}

export function createEventDraftWriter(deps: EventDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const stockPhotos = deps.stockPhotos ?? stockPhotoPicker
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
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const eventRef = hostRef.collection('events').doc(request.id)
      // A cover is fetched only for a new event a member may write, before
      // the transaction: a photo's copy is too slow to hold one open.
      if (!read.value.coverImage) {
        const [host, existing] = await Promise.all([hostRef.get(), eventRef.get()])
        if (host.exists && !existing.exists && !roleRefusal(host, request.uid) && !planRefusal(request.org)) {
          const cover = await coverFor(stockPhotos(), request, read.value.title)
          if (cover) {
            read.value.coverImage = cover.src
            if (cover.alt && !read.value.coverImageAlt) read.value.coverImageAlt = cover.alt
          }
        }
      }
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
        // The Events page's publish: `status`, and only for the publishing role.
        // "Publish site content" (`site.publish`, AGL-4047) on this site.
        const published = holdsSiteKey(host, request.uid, 'site.publish')
        const write = eventWrite({ ...read.value, status: published ? 'published' : 'draft' })
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
            status: write.fields.status,
            startsAtMs: write.fields.startsAtMs,
            endsAtMs: write.fields.endsAtMs,
            ...(write.fields.coverImage ? { coverImage: write.fields.coverImage } : {}),
          },
          ...liveOf(published),
        }
      })
    },
  }
}

export const eventDraftWriter = createEventDraftWriter()
