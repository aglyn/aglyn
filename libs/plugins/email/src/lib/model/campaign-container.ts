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
   * The stream this campaign's emails open on.
   *
   * A DEFAULT, not a constraint. The topic decides who a send skips, what the
   * preference page linked from the footer highlights, and which stream a
   * resulting opt-out is recorded against — all facts about one MESSAGE, and
   * one campaign may legitimately carry a newsletter and a promotion. So the
   * composer's picker is what the send records; this is what the picker opens
   * on, which is what stops a "Sales" campaign quietly mailing under
   * `marketing`.
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
  /**
   * When the record was minted, stamped by every writer that creates one.
   *
   * Absent on a send written before the stamp existed. The lists that draw
   * drafts beside sends order on it through `emailListTimeMs`, which is why
   * it is here rather than only on the loose record shape: a draft carries
   * neither `sentAt` nor `sendAtMs`, so this is the only time it has.
   */
  createdAtMs?: number
  stats?: CampaignStats
  /** How far a send that goes out over several batches has got. */
  resume?: CampaignResume
}

/**
 * The batch state the sender writes on an email that is still going out.
 *
 * Absent on every send that finished in one batch, and on every send that
 * predates batching — which is why {@link campaignSendProgress} treats a
 * missing record as "this is not a batched send" rather than as zero.
 */
export interface CampaignResume {
  /** People the email has resolved and not yet addressed. */
  remaining?: number
  /** Batches it has run. */
  batch?: number
  /** When the next batch may go, ms. Zero when there is not going to be one. */
  nextAtMs?: number
  /** Why it stopped short, when it did. */
  stop?: string
}

/**
 * WHAT A SEND IS ACTUALLY DOING, for a row that would otherwise lie.
 *
 * An email larger than one send may carry is delivered over several batches,
 * and between them it is stored as `scheduled` — the state the processor
 * claims, and the only one that resumes it without a second index and a
 * second query. Read literally, that is a row saying "not sent yet" about an
 * email that has already put five hundred messages in five hundred inboxes.
 *
 * So the stored fields are not the sentence. This is: it takes the status,
 * the delivered count and the batch record, and answers what a person needs
 * to see. Derived at read time and never persisted, exactly as
 * `campaignWindowState` beside it is, because it is a description of stored
 * facts and not a fact of its own.
 *
 * ## The four states, and which stored shape each one is
 *
 * - `pending` — `scheduled`, nothing delivered. A campaign waiting for its
 *   time. This is what `scheduled` meant before batching and still does.
 * - `sending` — `scheduled` or `sending` with something delivered and more to
 *   come. The state this function exists for.
 * - `sent` — finished, whether in one batch or six.
 * - `stopped` — finished with people it never addressed: canceled mid-flight,
 *   failed mid-flight, or stopped by the batch guard. The count is what makes
 *   this legible rather than alarming — an email that reached 2,400 of 3,000
 *   and stopped is a different conversation from one that reached nobody.
 */
export type CampaignSendProgressState =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'stopped'

export interface CampaignSendProgress {
  state: CampaignSendProgressState
  /** Messages this email has delivered. */
  reached: number
  /**
   * The audience it is working through, when one was recorded. Null when the
   * send never recorded an audience size, which is every send that predates
   * the figure — reported as null rather than as `reached` so a surface does
   * not present a floor as a total.
   */
  audience: number | null
  /** People it has resolved and not yet addressed. */
  remaining: number
  /** Batches it has run. Zero for a send that never batched. */
  batch: number
  /** When the next batch may go, ms. Zero unless {@link state} is `sending`. */
  nextAtMs: number
  /** One line a surface may show verbatim. */
  label: string
}

/** A stored count as a non-negative integer, or 0. */
function progressCount(raw: unknown): number {
  const value = Math.floor(Number(raw))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function campaignSendProgress(
  send: CampaignSend | null | undefined,
): CampaignSendProgress {
  const status = String(send?.status ?? 'sent')
  const reached = progressCount(send?.stats?.sent)
  const rawAudience = send?.stats?.audienceSize
  const audience =
    rawAudience === undefined || rawAudience === null
      ? null
      : progressCount(rawAudience)
  const resume = send?.resume
  const remaining = progressCount(resume?.remaining)
  const batch = progressCount(resume?.batch)
  const nextAtMs = progressCount(resume?.nextAtMs)
  const of = audience !== null ? ` of ${audience.toLocaleString()}` : ''

  // Still going: more to address, and a run that will address it. A campaign
  // a merchant CANCELED is not still going however much is left, which is why
  // the status is read before the remainder.
  if (
    remaining > 0 &&
    nextAtMs > 0 &&
    (status === 'scheduled' || status === 'sending')
  ) {
    return {
      state: 'sending',
      reached,
      audience,
      remaining,
      batch,
      nextAtMs,
      label: `Sending — reached ${reached.toLocaleString()}${of}`,
    }
  }
  // Waiting for its time, with nothing delivered. The pre-batching meaning of
  // `scheduled`, and still the common one.
  if ((status === 'scheduled' || status === 'sending') && reached === 0) {
    return {
      state: 'pending',
      reached: 0,
      audience,
      remaining,
      batch,
      nextAtMs: 0,
      label: status === 'sending' ? 'Sending' : 'Scheduled',
    }
  }
  if (remaining > 0) {
    const why =
      status === 'canceled'
        ? 'canceled'
        : status === 'failed'
          ? 'stopped by an error'
          : 'stopped'
    return {
      state: 'stopped',
      reached,
      audience,
      remaining,
      batch,
      nextAtMs: 0,
      label:
        `Reached ${reached.toLocaleString()}${of} — ${why} with ` +
        `${remaining.toLocaleString()} not addressed`,
    }
  }
  return {
    state: 'sent',
    reached,
    audience,
    remaining: 0,
    batch,
    nextAtMs: 0,
    label:
      batch > 1
        ? `Sent to ${reached.toLocaleString()}${of} over ${batch} runs`
        : `Sent to ${reached.toLocaleString()}${of}`,
  }
}

/**
 * What a ROW says about one email, in one word and one line.
 *
 * {@link campaignSendProgress} answers what a send is DOING, and a draft is
 * not doing anything: it has no status the progress states cover, and — since
 * an absent status reads as `sent` and a draft has no counters — asking it
 * about one answers "Sent to 0", which is the worst available sentence about
 * an email nobody has written yet. So the draft is settled here and
 * everything else is deferred, unchanged, to the derivation that owns it.
 *
 * One helper rather than the same two-line branch on four surfaces. The
 * campaigns table, the emails list, an email's own page and a campaign's
 * emails table all draw this, and four copies is how three of them come to
 * say "Scheduled" about a campaign that has delivered five hundred messages.
 */
export type CampaignSendDisplayState = 'draft' | CampaignSendProgressState

export interface CampaignSendDisplay {
  state: CampaignSendDisplayState
  /** One line a surface may show verbatim. */
  label: string
  /** The progress underneath, for a surface that wants the figures. */
  progress: CampaignSendProgress
}

export function campaignSendDisplay(
  send: CampaignSend | null | undefined,
): CampaignSendDisplay {
  const progress = campaignSendProgress(send)
  if (String(send?.status ?? '') === 'draft') {
    return { state: 'draft', label: 'Draft', progress }
  }
  return { state: progress.state, label: progress.label, progress }
}

/**
 * Whether this email is between batches, with more of its audience to reach.
 *
 * The one question two controls on an email's page turn on. It is stored as
 * `scheduled` — the state the processor claims — so a surface reading the
 * status alone offers "Send now" on a campaign that is already going out, and
 * `sendNow` re-resolves the WHOLE audience rather than continuing: everyone
 * already reached would receive a second copy under the same `cid`.
 */
export function campaignSendIsMidFlight(
  send: CampaignSend | null | undefined,
): boolean {
  return campaignSendProgress(send).state === 'sending'
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
  /** Sends still waiting for their send time, having delivered nothing. */
  scheduled: number
  /**
   * Sends part way through an audience larger than one batch.
   *
   * Counted apart from `scheduled` and from `sends`, because it is neither:
   * mail has gone out, and more is going to. Both of those are facts a
   * merchant reading a campaign row needs, and the stored status carries
   * only the first.
   */
  sending: number
  /**
   * Emails that have been created and not yet written or sent.
   *
   * Counted apart from `sends` and from `scheduled`, because a draft is
   * neither: it has mailed nobody, and it is not on the clock to.
   */
  drafts: number
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
  /*==========================================
   * ONLY MAIL THAT HAS GONE OUT IS A SEND.
   *
   * An email exists from the moment it is created, so this collection now
   * holds records in three states that have mailed nobody — `draft`,
   * `scheduled` and the `sending` claim — and every figure below is about
   * mail that was delivered.
   *
   * Two separate faults if they are left in. The COUNT would report a
   * campaign as having sent three emails when it has sent two and is still
   * writing the third. And every aggregate carries `sends` as the denominator
   * of its own "recorded by N of M" label, so an unsent record would enlarge
   * the M — publishing a coverage figure that says the campaign is missing
   * data it was never going to have.
   *=========================================*/
  /*
   * A SEND THAT IS STILL GOING HAS STILL GONE.
   *
   * `emailIsUnsent` reads the stored status, and an email delivering an
   * audience larger than one batch is stored as `scheduled` between runs —
   * so reading it literally drops a send that has put five hundred messages
   * in five hundred inboxes out of every total on the campaign, and counts it
   * under "scheduled" as though nothing had happened. `campaignSendProgress`
   * is what tells "waiting for its time" from "part way through", and only
   * the first is genuinely unsent.
   *
   * A DRAFT is settled by the status because the progress states do not cover
   * it — see `campaignSendDisplay`.
   */
  const notYet = (send: CampaignSend): boolean =>
    String(send.status ?? '') === 'draft' ||
    campaignSendProgress(send).state === 'pending'
  const gone = sends.filter((send) => !notYet(send))
  const measurable = sends.filter(
    (send) => send.stats?.delivered !== undefined,
  )
  const deliveredTotal = aggregate(measurable, (stats) => stats.delivered)
  return {
    sends: gone.filter((send) => send.status !== 'canceled').length,
    // Waiting for its time with nothing delivered — which is what
    // "scheduled" meant before an email could be delivered over several runs,
    // and is now narrower than the stored status of that name.
    scheduled: sends.filter(
      (send) => campaignSendProgress(send).state === 'pending',
    ).length,
    sending: sends.filter(
      (send) => campaignSendProgress(send).state === 'sending',
    ).length,
    drafts: sends.filter((send) => send.status === 'draft').length,
    addressed: aggregate(gone, (stats) => stats.recipients),
    sent: aggregate(gone, (stats) => stats.sent),
    delivered: aggregate(gone, (stats) => stats.delivered),
    opens: aggregate(gone, (stats) => stats.opens),
    uniqueOpens: aggregate(gone, (stats) => stats.uniqueOpens),
    clicks: aggregate(gone, (stats) => stats.clicks),
    uniqueClicks: aggregate(gone, (stats) => stats.uniqueClicks),
    bounced: aggregate(gone, (stats) => stats.bounced),
    complained: aggregate(gone, (stats) => stats.complained),
    unsubscribes: aggregate(gone, (stats) => stats.unsubscribes),
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
