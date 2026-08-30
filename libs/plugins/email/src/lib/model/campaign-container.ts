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
 * A CAMPAIGN IS A CONTAINER; A SEND IS ONE MESSAGE INSIDE IT.
 *
 * ## The two collections, and why there are two
 *
 * `hosts/{hostId}/campaigns/{sendId}` holds a SEND: one subject, one body,
 * one audience, one set of counters. That is what the collection has always
 * held, and it is why the container could not simply be that document grown
 * new fields.
 *
 * **Its ids are load-bearing outside this repo.** Every unsubscribe link that
 * has ever gone out carries `cid={sendId}`, those emails sit in inboxes
 * forever, and the `cid` is inside the link's HMAC — so a send id that stops
 * resolving is an opt-out that stops working, which is a compliance failure
 * rather than a broken page. `/emails/campaigns/{sendId}` is likewise
 * linkable by design: a merchant pastes it into a message about last week's
 * send.
 *
 * So the send collection is left exactly where it is, under exactly its
 * existing ids, and the container is a new collection above it:
 * `hosts/{hostId}/emailCampaigns/{campaignId}`. A send joins one by carrying
 * {@link CAMPAIGN_SEND_CONTAINER_FIELD}; a send written before containers
 * existed carries nothing, and {@link campaignListRows} presents it as a
 * container of one rather than hiding it.
 *
 * That last property is what makes this migration-free. There is no backfill
 * to run, no window in which a merchant's history is missing, and no id
 * rewritten anywhere.
 *
 * ## Why the arithmetic is here
 *
 * The same reason `campaign-report.ts` gives for the per-send rates: a
 * denominator chosen in JSX is a denominator nobody tests. Aggregating across
 * sends adds one problem the single-send report does not have — some sends
 * recorded a field and others never did — and summing those into one number
 * silently reports a partial total as a complete one. Every aggregate here
 * therefore reports how many sends it could measure.
 */

import {
  campaignRate,
  type CampaignRate,
  type CampaignStats,
} from './campaign-report'

/**
 * The field on a SEND naming the campaign it belongs to.
 *
 * Not `campaignId`: on a send document that name already means the send's own
 * id — it is what `cid` carries and what the report route addresses — and one
 * word meaning both would be read into the other on the first edit.
 */
export const CAMPAIGN_SEND_CONTAINER_FIELD = 'emailCampaignId'

/**
 * A campaign: the container, not a message.
 *
 * Stored at `hosts/{hostId}/emailCampaigns/{campaignId}`.
 */
export interface EmailCampaign {
  $id: string
  /** What the merchant called it. */
  name: string
  /** When the campaign window opens. Null for a campaign with no dates. */
  startAtMs?: number | null
  /** When it closes. Null for an open-ended campaign. */
  endAtMs?: number | null
  /** Org email lists this campaign is aimed at, by list id. */
  listIds?: string[]
  /**
   * The subscription topic this campaign belongs to.
   *
   * The seam the preference center attaches to: a recipient who has opted out
   * of a topic is out of every campaign carrying it, which is a decision that
   * belongs to the campaign rather than to each of its sends. Nothing reads
   * it yet, and it is carried through the create flow so that the reader
   * arrives to data rather than to a migration.
   */
  topicId?: string
  createdAtMs?: number
  createdBy?: string
  deletedAt?: unknown
}

/** One send, as much of it as a list or a rollup needs. */
export interface CampaignSend {
  $id: string
  subject?: string
  /** The audience KIND: `'leads'`, `'members'`, `'segment'`, `'list'`. */
  audience?: string
  /** The list this send addressed, when the kind is `'list'`. */
  listId?: string
  /** The segment this send addressed, when the kind is `'segment'`. */
  segmentId?: string
  /** Which container it belongs to, absent on a send written before them. */
  emailCampaignId?: string
  status?: string
  sentAt?: { seconds?: number } | null
  sendAtMs?: number
  stats?: CampaignStats
}

/**
 * The lists ONE SEND addressed — which can be narrower than the lists its
 * campaign is aimed at.
 *
 * A campaign holds the lists a merchant plans to reach; each send inside it
 * picks one audience, and that audience may be a segment or the site's leads
 * rather than any of them. Answering from the send is therefore the only
 * honest answer for a send's own detail page.
 *
 * An array for a document that stores one id, deliberately: the question
 * "which lists did this reach" has a plural answer everywhere it is asked,
 * and a caller that unwraps a single id today is a caller to revisit if a
 * send ever addresses two.
 */
export function campaignSendListIds(send: CampaignSend): string[] {
  return send.audience === 'list' && send.listId ? [send.listId] : []
}

/**
 * A number summed across sends, with how much of the campaign it covers.
 *
 * `value` is `null` when NO send recorded the field — which is not zero, for
 * the reason `campaign-report.ts` gives at length: an unrecorded delivery
 * count and a delivery count of zero lead a merchant to opposite conclusions
 * about their sending domain.
 *
 * `recorded` below `sends` means the total is a floor. A campaign whose
 * older sends predate the delivery webhook has a real number that describes
 * part of itself, and saying which part is the difference between a total and
 * a guess.
 */
export interface CampaignAggregate {
  value: number | null
  /** Sends that recorded this field. */
  recorded: number
  /** Sends in the campaign. */
  sends: number
}

/** Every rolled-up figure for one campaign. */
export interface CampaignRollup {
  /** Sends that have actually gone out. */
  sends: number
  /** Sends still waiting for their send time. */
  scheduled: number
  addressed: CampaignAggregate
  sent: CampaignAggregate
  delivered: CampaignAggregate
  opens: CampaignAggregate
  uniqueOpens: CampaignAggregate
  clicks: CampaignAggregate
  uniqueClicks: CampaignAggregate
  bounced: CampaignAggregate
  complained: CampaignAggregate
  unsubscribes: CampaignAggregate
  /** Distinct openers over delivered, across every send that recorded both. */
  openRate: CampaignRate | null
  /** Distinct clickers over delivered. */
  clickRate: CampaignRate | null
  /** Unsubscribes over delivered. */
  unsubscribeRate: CampaignRate | null
  /** The most recent send time in the campaign, for ordering a list. */
  lastSentAtMs: number | null
}

const aggregate = (
  sends: CampaignSend[],
  read: (stats: CampaignStats) => number | undefined,
): CampaignAggregate => {
  let total = 0
  let recorded = 0
  for (const send of sends) {
    const value = read(send.stats ?? {})
    // `undefined` is "this send never recorded it"; a recorded 0 counts as
    // measured, and moves `recorded` without moving the total.
    if (value === undefined || value === null) continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue
    total += numeric
    recorded += 1
  }
  return { value: recorded ? total : null, recorded, sends: sends.length }
}

/** When a send happened, in epoch milliseconds, or null. */
export function campaignSendAtMs(send: CampaignSend): number | null {
  const seconds = send.sentAt?.seconds
  if (typeof seconds === 'number') return seconds * 1000
  if (typeof send.sendAtMs === 'number') return send.sendAtMs
  return null
}

/**
 * Rolls a campaign's sends into one set of figures.
 *
 * Rates are taken over the sends that recorded BOTH sides, so a campaign
 * whose first send predates the delivery webhook reports the open rate of the
 * sends that can be measured rather than one deflated by a send with no
 * denominator.
 */
export function campaignRollup(sends: CampaignSend[]): CampaignRollup {
  const delivered = sends.filter(
    (send) => (send.status ?? 'sent') !== 'scheduled',
  )
  const measurable = sends.filter(
    (send) => send.stats?.delivered !== undefined,
  )
  const deliveredTotal = aggregate(measurable, (stats) => stats.delivered)
  return {
    sends: delivered.filter((send) => send.status !== 'canceled').length,
    scheduled: sends.filter((send) => send.status === 'scheduled').length,
    addressed: aggregate(sends, (stats) => stats.recipients),
    sent: aggregate(sends, (stats) => stats.sent),
    delivered: aggregate(sends, (stats) => stats.delivered),
    opens: aggregate(sends, (stats) => stats.opens),
    uniqueOpens: aggregate(sends, (stats) => stats.uniqueOpens),
    clicks: aggregate(sends, (stats) => stats.clicks),
    uniqueClicks: aggregate(sends, (stats) => stats.uniqueClicks),
    bounced: aggregate(sends, (stats) => stats.bounced),
    complained: aggregate(sends, (stats) => stats.complained),
    unsubscribes: aggregate(sends, (stats) => stats.unsubscribes),
    openRate: campaignRate(
      aggregate(measurable, (stats) => stats.uniqueOpens).value ?? undefined,
      deliveredTotal.value ?? undefined,
      'delivered',
    ),
    clickRate: campaignRate(
      aggregate(measurable, (stats) => stats.uniqueClicks).value ?? undefined,
      deliveredTotal.value ?? undefined,
      'delivered',
    ),
    unsubscribeRate: campaignRate(
      aggregate(measurable, (stats) => stats.unsubscribes).value ?? undefined,
      deliveredTotal.value ?? undefined,
      'delivered',
    ),
    lastSentAtMs: sends.reduce<number | null>((latest, send) => {
      const at = campaignSendAtMs(send)
      return at !== null && (latest === null || at > latest) ? at : latest
    }, null),
  }
}

/**
 * Where a campaign stands against its own window.
 *
 * Derived at read time and never persisted — the `status` values on a SEND
 * (`sent`, `scheduled`, `canceled`, `failed`) are stored strings that a
 * processor branches on, and a display state sharing those spellings would
 * eventually be written back.
 */
export type CampaignWindowState = 'undated' | 'upcoming' | 'running' | 'ended'

export function campaignWindowState(
  campaign: Pick<EmailCampaign, 'startAtMs' | 'endAtMs'>,
  nowMs: number,
): CampaignWindowState {
  const start = campaign.startAtMs ?? null
  const end = campaign.endAtMs ?? null
  if (start === null && end === null) return 'undated'
  if (start !== null && nowMs < start) return 'upcoming'
  if (end !== null && nowMs > end) return 'ended'
  return 'running'
}

/** One row of the campaigns table. */
export interface CampaignListRow {
  /** The id the detail route resolves — a container id, or a send id. */
  id: string
  name: string
  /**
   * True when this row IS a send with no container.
   *
   * A campaign sent before containers existed is shown as a campaign of one
   * rather than dropped from the list, and the detail route falls back to the
   * send's own report for it. Nothing about that send is rewritten.
   */
  legacy: boolean
  startAtMs: number | null
  endAtMs: number | null
  listIds: string[]
  sends: CampaignSend[]
  rollup: CampaignRollup
  windowState: CampaignWindowState
  /** For ordering: the campaign's start, else its most recent send. */
  atMs: number | null
}

/**
 * The campaigns table's rows: every container, plus every send that belongs
 * to none.
 *
 * The second half is what makes the container additive. A merchant's history
 * is the sends they already have; a list that showed only containers would
 * read as an empty product on the day this shipped, and a backfill that
 * adopted each old send into a container of one would rewrite documents whose
 * ids are cited by mail already delivered. Adopting them AT READ TIME costs a
 * pass over a list already in memory and rewrites nothing.
 *
 * Newest first, on the start date where there is one and the last send
 * otherwise. Rows with no date at all sort last: they are campaigns nobody
 * has scheduled or sent, and dating them from nothing would be an invention.
 */
export function campaignListRows(
  campaigns: EmailCampaign[],
  sends: CampaignSend[],
  nowMs: number,
): CampaignListRow[] {
  const byCampaign = new Map<string, CampaignSend[]>()
  const orphans: CampaignSend[] = []
  for (const send of sends) {
    const containerId = send.emailCampaignId
    if (!containerId) {
      orphans.push(send)
      continue
    }
    const existing = byCampaign.get(containerId)
    if (existing) existing.push(send)
    else byCampaign.set(containerId, [send])
  }

  const rows: CampaignListRow[] = campaigns.map((campaign) => {
    const own = byCampaign.get(campaign.$id) ?? []
    const rollup = campaignRollup(own)
    return {
      id: campaign.$id,
      name: campaign.name || 'Untitled campaign',
      legacy: false,
      startAtMs: campaign.startAtMs ?? null,
      endAtMs: campaign.endAtMs ?? null,
      listIds: campaign.listIds ?? [],
      sends: own,
      rollup,
      windowState: campaignWindowState(campaign, nowMs),
      atMs: campaign.startAtMs ?? rollup.lastSentAtMs ?? null,
    }
  })

  for (const send of orphans) {
    const rollup = campaignRollup([send])
    const at = campaignSendAtMs(send)
    rows.push({
      id: send.$id,
      name: send.subject || 'Untitled campaign',
      legacy: true,
      startAtMs: at,
      endAtMs: at,
      listIds: [],
      sends: [send],
      rollup,
      // A send has no window of its own; it happened, or it is going to.
      windowState:
        send.status === 'scheduled'
          ? 'upcoming'
          : at === null
            ? 'undated'
            : 'ended',
      atMs: at,
    })
  }

  return rows.sort((a, b) => {
    if (a.atMs === null && b.atMs === null) return a.name.localeCompare(b.name)
    if (a.atMs === null) return 1
    if (b.atMs === null) return -1
    return b.atMs - a.atMs
  })
}
