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

import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { pluginRecordFactsReader } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
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
 *  - THE SEND TIME is asked of the plugin that keeps the list's past sends,
 *    through the core's record-facts seam, which answers the slot and how
 *    many sends it was chosen among — and is said only in the output's note.
 */

/** The most products one email binds. */
export const AI_EMAIL_MAX_PRODUCTS = 6

/** How many of a site's products are read for the names a brief might use. */
export const AI_EMAIL_PRODUCT_SCAN = 200

/** How many of an org's lists are read: the composer's list picker window. */
export const AI_CAMPAIGN_LIST_SCAN = 50

/**
 * The resource a list's send time is read as, by the list's id, through
 * `plugin-record-facts`. Its owner answers `{ label, measured }`: the slot as
 * a person reads it (or `null` with too little history) and the sends it was
 * chosen among.
 */
export const AI_LIST_SEND_TIME_RESOURCE = 'listSendTime'

/** A list's suggested send time, as the note says it. */
export interface AiListSendTime {
  label: string
  measured: number
}

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
 * ones the brief names. Reads ids and names through the `product` index the
 * plugin that keeps products publishes (AGL-3080), and returns only ids; none
 * where no plugin keeps products here.
 */
export async function resolveAiEmailProducts(input: {
  hostId: string
  brief: string
  inputs: Readonly<Record<string, unknown>> | undefined
}): Promise<AiEmailProductBinding> {
  const picked = aiEmailPickedProductIds(input.inputs)
  const index = pluginRecordIndex('product')?.index
  if (!index) return { ids: [], picked: picked.length }
  if (picked.length) {
    const records = await Promise.all(picked.map((id) => index.get({ hostId: input.hostId, id })))
    return {
      ids: records.filter((record) => record !== null).map((record) => record.id),
      picked: picked.length,
    }
  }
  const { records } = await index.list({ hostId: input.hostId, limit: AI_EMAIL_PRODUCT_SCAN })
  return {
    ids: aiRecordsNamedIn(
      input.brief,
      records.map((record) => ({ id: record.id, name: record.name })),
      AI_EMAIL_MAX_PRODUCTS,
    ).map((row) => row.id),
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

/**
 * The send time a list's past sends on this site suggest, asked of the plugin
 * that keeps the sends: `null` when nothing keeps them here, when the owner
 * refuses, or when there is too little history to suggest one.
 */
export async function readAiListSendTime(input: {
  orgId: string
  hostId: string
  listId: string
  uid: string
  org: Readonly<Record<string, unknown>> | null
  now: Date
}): Promise<AiListSendTime | null> {
  if (!input.orgId || !input.hostId || !input.listId) return null
  const owner = pluginRecordFactsReader(AI_LIST_SEND_TIME_RESOURCE)
  if (!owner) return null
  const read = await owner.reader.read({
    orgId: input.orgId,
    hostId: input.hostId,
    id: input.listId,
    uid: input.uid,
    org: input.org,
    now: input.now,
  })
  if (!read.ok) return null
  const label = read.facts['label']
  const measured = Number(read.facts['measured'] ?? 0)
  return typeof label === 'string' && label && measured > 0 ? { label, measured } : null
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
  sendTime: AiListSendTime | null,
): string {
  if (!list) {
    return 'The email is aimed at nobody yet: choose who receives it before you schedule it.'
  }
  const when = sendTime
    ? ` Past campaigns to that list on this site were opened most when sent on ${sendTime.label}, across ${sendTime.measured} sends.`
    : ' That list has too little send history on this site to suggest a send time.'
  return `The brief names the list "${list.name}". The email is aimed at nobody yet: choose "${list.name}" as its audience before you schedule it.${when}`
}
