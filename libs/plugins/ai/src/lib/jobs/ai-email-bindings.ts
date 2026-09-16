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
  campaignSendTimeLabel,
  suggestCampaignSendTime,
  type CampaignSendTimeSuggestion,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-send-time'
import { orgDataCollectionForHost } from '@aglyn/tenant-data-admin/server/organizations'

/**
 * What an email or campaign job binds and suggests WITHOUT the model
 * (AGL-2912).
 *
 * What AI generation is published to send is the brief, a summary of the
 * site and the content being worked on — not email lists, contacts,
 * recipients, CRM records, product records or engagement statistics. So
 * everything here that touches one of those runs in code, on the server, and
 * hands the model at most a count:
 *
 *  - PRODUCTS are bound by id: the ones the member picked for the job, else
 *    the ones the brief names by their exact name. The model learns only how
 *    many product blocks to place; the ids are set on those blocks after it
 *    answers, and the send fills each block's name, price and picture.
 *  - THE LIST a campaign is for is suggested when the brief names one of the
 *    org's lists by name, and is set on nothing: the drafted email is aimed at
 *    nobody until a person chooses.
 *  - THE SEND TIME is the shared rule over that list's past sends on this
 *    site — when each went out, how many were delivered and how many people
 *    opened it — and is said only in the output's note.
 */

type Firestore = FirebaseFirestore.Firestore

/** The most products one email binds. */
export const AI_EMAIL_MAX_PRODUCTS = 6

/** How many of a site's products are read for the names a brief might use. */
export const AI_EMAIL_PRODUCT_SCAN = 200

/** How many of an org's lists are read: the composer's list picker window. */
export const AI_CAMPAIGN_LIST_SCAN = 50

/** How many of a list's past sends on the site the send time is taken from. */
export const AI_CAMPAIGN_SEND_HISTORY_SCAN = 50

/** A record a brief may name, by its id and its name. */
export interface AiNamedRecord {
  id: string
  name: string
}

/** Lowercase words joined by single spaces, for matching a name inside text. */
function wordsOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The records a text names by their whole name, in the order it names them.
 * A name must stand as its own words ("Rye loaf" is not named by "rye
 * loaves"), a longer name takes the words it shares with a shorter one ("Rye
 * loaf" over "Rye"), and a name shorter than three characters names nothing.
 */
export function aiRecordsNamedIn(
  text: string,
  records: readonly AiNamedRecord[],
  max: number,
): AiNamedRecord[] {
  const haystack = ` ${wordsOf(text)} `
  const hits: Array<{ record: AiNamedRecord; at: number; end: number }> = []
  for (const record of records) {
    const needle = wordsOf(record.name)
    if (needle.length < 3) continue
    const at = haystack.indexOf(` ${needle} `)
    if (at !== -1) hits.push({ record, at, end: at + needle.length + 1 })
  }
  const kept: typeof hits = []
  for (const hit of [...hits].sort((a, b) => b.end - b.at - (a.end - a.at))) {
    if (kept.some((other) => hit.at < other.end && hit.end > other.at)) continue
    kept.push(hit)
  }
  return kept
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.record)
    .slice(0, Math.max(0, max))
}

/**
 * The product ids a member picked for the job, as the create door stores a
 * scalar input: one string of ids separated by commas or spaces.
 */
export function aiEmailPickedProductIds(inputs: Readonly<Record<string, unknown>> | undefined): string[] {
  const raw = inputs?.['productIds']
  if (typeof raw !== 'string') return []
  const ids = raw.split(/[\s,]+/).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))
  return [...new Set(ids)].slice(0, AI_EMAIL_MAX_PRODUCTS)
}

export interface AiEmailProductBinding {
  /** The product ids bound, in the order the email's product blocks take them. */
  ids: string[]
  /** How many the member picked; 0 when the ids came from the brief. */
  picked: number
}

/**
 * The products an email binds: the member's picks that still exist, else the
 * ones the brief names. Reads ids and names, and returns only ids.
 */
export async function resolveAiEmailProducts(
  firestore: Firestore,
  input: { hostId: string; brief: string; inputs: Readonly<Record<string, unknown>> | undefined },
): Promise<AiEmailProductBinding> {
  const products = firestore.collection('hosts').doc(input.hostId).collection('products')
  const picked = aiEmailPickedProductIds(input.inputs)
  if (picked.length) {
    const snapshots = await Promise.all(picked.map((id) => products.doc(id).get()))
    return {
      ids: snapshots
        .filter((snapshot) => snapshot.exists && snapshot.get('deletedAt') == null)
        .map((snapshot) => snapshot.id),
      picked: picked.length,
    }
  }
  const snapshot = await products.select('name', 'deletedAt').limit(AI_EMAIL_PRODUCT_SCAN).get()
  const rows = snapshot.docs
    .filter((doc) => doc.get('deletedAt') == null)
    .map((doc) => ({ id: doc.id, name: String(doc.get('name') ?? '') }))
  return {
    ids: aiRecordsNamedIn(input.brief, rows, AI_EMAIL_MAX_PRODUCTS).map((row) => row.id),
    picked: 0,
  }
}

/**
 * The org list a campaign's brief names, found the way the send path finds an
 * org's lists; `null` when it names none.
 */
export async function suggestAiCampaignList(input: {
  hostId: string
  brief: string
}): Promise<AiNamedRecord | null> {
  const contacts = await orgDataCollectionForHost(input.hostId, 'contacts')
  const lists = contacts.parent?.collection('lists')
  if (!lists) return null
  const snapshot = await lists.select('name').limit(AI_CAMPAIGN_LIST_SCAN).get()
  const rows = snapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.get('name') ?? '') }))
  return aiRecordsNamedIn(input.brief, rows, 1)[0] ?? null
}

function millisOf(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : 0
}

/** The send time a list's past sends on this site suggest, or `null` with too little history. */
export async function readAiListSendTime(
  firestore: Firestore,
  input: { hostId: string; listId: string },
): Promise<CampaignSendTimeSuggestion | null> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(input.hostId)
    .collection('campaigns')
    .where('listId', '==', input.listId)
    .where('status', '==', 'sent')
    .select('sentAt', 'stats.delivered', 'stats.uniqueOpens')
    .limit(AI_CAMPAIGN_SEND_HISTORY_SCAN)
    .get()
  return suggestCampaignSendTime(
    snapshot.docs.map((doc) => ({
      sentAtMs: millisOf(doc.get('sentAt')),
      delivered: Number(doc.get('stats.delivered') ?? 0),
      uniqueOpens: Number(doc.get('stats.uniqueOpens') ?? 0),
    })),
  )
}

/** What an email's output says about its products; `null` when it binds none and none were picked. */
export function aiEmailProductNote(binding: AiEmailProductBinding): string | null {
  const bound = binding.ids.length
  const missing = binding.picked - bound
  const parts: string[] = []
  if (bound === 1) {
    parts.push('Its product card shows the product’s current name, price and picture when it is sent.')
  } else if (bound > 1) {
    parts.push(`Its ${bound} product cards show each product’s current name, price and picture when it is sent.`)
  }
  if (missing > 0) {
    parts.push(
      `${missing} of the products picked no longer ${missing === 1 ? 'exists' : 'exist'}, so the email places ${
        bound || 'none'
      }.`,
    )
  }
  return parts.length ? parts.join(' ') : null
}

/** What a campaign's output says about who it is for and when to send it. */
export function aiCampaignAudienceNote(
  list: AiNamedRecord | null,
  sendTime: CampaignSendTimeSuggestion | null,
): string {
  if (!list) {
    return 'The email is aimed at nobody yet: choose who receives it before you schedule it.'
  }
  const when = sendTime
    ? ` Past campaigns to that list on this site were opened most when sent on ${campaignSendTimeLabel(
        sendTime,
      )}, across ${sendTime.measured} sends.`
    : ' That list has too little send history on this site to suggest a send time.'
  return `The brief names the list "${list.name}". The email is aimed at nobody yet: choose "${list.name}" as its audience before you schedule it.${when}`
}
