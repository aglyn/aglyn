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

/**
 * THE SENDERS ONE SITE HOLDS — `hosts/{hostId}/senders/{senderId}`.
 *
 * A sender is a mailbox this site may send as, together with the display name
 * and reply address that ordinarily go with it. A site holds several and a
 * composer picks among them; which one an unnamed send uses is the site's
 * DEFAULT.
 *
 * ## Chosen BY ID, never typed per send
 *
 * `sending-mailbox.ts` states the rule this collection exists to keep: a
 * mailbox addresses something real — a bounce returns to it, and a client
 * ignoring `Reply-To:` answers to it — so a mailbox that exists in one
 * campaign's headers and nowhere else is an address nobody serves.
 * `campaign-send.ts` states the same closure from the other end: the sending
 * identity named in a send request is read by nothing.
 *
 * A sender id does not reopen that path. It names a mailbox that was
 * configured once, validated once and stored on this site, so the set of
 * addresses a send can reach is the set an org admin already approved. A free
 * local part in a send body would be the thing that was closed; a key into a
 * managed list is not.
 *
 * ## The DEFAULT is projected onto the host document
 *
 * `hosts/{hostId}` has carried `sendingLocalPart`, `sendingFromName` and
 * `sendingReplyTo` since before this collection existed, and
 * `resolveHostSendingIdentity` reads the first of them on every tenant send.
 * Those fields remain the projection of the default sender rather than being
 * migrated away: a site already sending as `test@` must not revert to `hello@`
 * because a subcollection it never had is empty.
 *
 * So the two are read in a fixed order. An empty subcollection means the site
 * has exactly one sender, and it is the one the host fields describe —
 * {@link DEFAULT_HOST_SENDER_ID} is the id it is synthesized under, and the id
 * it is materialized at the first time anything writes here.
 *
 * ## Pure, for the reason the modules either side of it are pure
 *
 * The document shape is read by the console route that writes it, by the send
 * path that resolves a chosen one, and by the surfaces that render the list.
 * A shape written down three times is a shape that disagrees with itself the
 * first time any of the three moves.
 */

import { normalizeLocalPart } from './sending-domain'
import {
  headerSafeText,
  SENDING_FROM_NAME_MAX,
  SENDING_REPLY_TO_MAX,
} from './sending-mailbox'

/** The subcollection under `hosts/{hostId}` that holds a site's senders. */
export const HOST_SENDERS_COLLECTION = 'senders'

/**
 * The id the site's original sender lives at.
 *
 * A fixed id rather than a generated one, because this document is the
 * materialized form of something that already existed: the three sender fields
 * on the host. Materializing it under a random id would make "which row is the
 * one the host document describes" a question with no answer for anybody
 * reading the data directly, and would let a second materialization mint a
 * duplicate of the same sender.
 */
export const DEFAULT_HOST_SENDER_ID = 'default'

/**
 * How many senders one site may hold.
 *
 * A ceiling rather than a page. Every sender is a mailbox somebody has to
 * serve — bounces and replies arrive at it whether or not anyone reads them —
 * so a list long enough to need paging is a list nobody is operating, and the
 * composer control that renders it is a picker rather than a directory.
 */
export const HOST_SENDER_LIMIT = 25

/** One sender, normalized. Every field present; the optional ones as `''`. */
export interface HostSenderRecord {
  id: string
  /** The mailbox — the part before the `@`. Never empty on a stored row. */
  localPart: string
  /** The display name in front of the address, or `''`. */
  fromName: string
  /** Where replies go when it is not the sending address, or `''`. */
  replyTo: string
  /** Whether an unnamed send leaves on this one. Exactly one row carries it. */
  isDefault: boolean
  createdAtMs: number
}

/**
 * One stored sender document, normalized into {@link HostSenderRecord}.
 *
 * Every field is re-normalized on the way out rather than trusted. The route
 * validates on the way in, and a document can also arrive from a restore, a
 * hand edit or a version of the writer that predates a rule — and these values
 * reach a `From:` header, where an unflattened one is the injection shape.
 */
export function readHostSender(options: {
  id: string
  data: Record<string, unknown> | null | undefined
  /** `hosts/{hostId}.defaultSenderId`. Decides {@link HostSenderRecord.isDefault}. */
  defaultSenderId?: string | null
}): HostSenderRecord {
  const data = options?.data ?? {}
  const id = String(options?.id ?? '')
  const createdAtMs = Number(data['createdAtMs'])
  return {
    id,
    localPart: normalizeLocalPart(String(data['localPart'] ?? '')),
    fromName: headerSafeText(
      String(data['fromName'] ?? ''),
      SENDING_FROM_NAME_MAX,
    ),
    replyTo: headerSafeText(
      String(data['replyTo'] ?? ''),
      SENDING_REPLY_TO_MAX,
    ).toLowerCase(),
    isDefault: Boolean(id) && id === String(options?.defaultSenderId ?? ''),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
  }
}

/**
 * Which row an unnamed send leaves on, when the stored pointer names nobody.
 *
 * `defaultSenderId` is written beside every change that could move it, so the
 * ordinary case is that it names a row in this list. It can still fail to: a
 * default deleted out of band, a pointer written before the row it names, a
 * partial restore. Answering with a row rather than with nothing is what keeps
 * such a site sending — and the order is fixed, so two readers of the same data
 * cannot disagree about which sender that is.
 */
export function defaultHostSender(
  senders: readonly HostSenderRecord[],
): HostSenderRecord | null {
  if (!senders?.length) return null
  return (
    senders.find((sender) => sender.isDefault) ??
    senders.find((sender) => sender.id === DEFAULT_HOST_SENDER_ID) ??
    [...senders].sort(
      (left, right) =>
        left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
    )[0]
  )
}

/**
 * The whole address one sender leaves on, or `null` on a site whose mailbox is
 * not its own to name.
 *
 * The ONE place a sending address is assembled from its two halves. A surface
 * that built `${localPart}@${domain}` itself would be a second derivation of
 * the address, and the two would disagree the first time either moved — which
 * is the same rule the identity route's `IdentityOption.from` already keeps.
 */
export function hostSenderAddress(
  localPart: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const mailbox = normalizeLocalPart(String(localPart ?? ''))
  const zone = String(domain ?? '')
    .trim()
    .toLowerCase()
  return mailbox && zone ? `${mailbox}@${zone}` : null
}
