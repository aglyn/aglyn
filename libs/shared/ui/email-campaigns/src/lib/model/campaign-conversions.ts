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

/*
 * The window and the model name come from `@aglyn/shared-util-email`, for the
 * reason `campaign-revenue.ts` gives: the writer is in `tenant-data-admin`,
 * which may not import a feature plugin, and a rule defined on both sides of
 * the join drifts into a figure credited under one and printed under another.
 */
import {
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
} from '@aglyn/shared-util-email'
import type { CampaignCaveat } from './campaign-report'

/**
 * WHAT A CAMPAIGN CAUSED — the read half of the identify-moment join.
 *
 * `campaign-revenue.ts` answers what a campaign EARNED, from orders that name
 * their buyer. This answers what it CAUSED among people who were anonymous
 * until the moment they became somebody: they arrive from a campaign link,
 * browse, and only become identifiable when they submit a form, sign up, book
 * or check out. Same window, same last-click rule, same `model`/`windowDays`
 * stamped on every record, so the two figures on one screen are two readings
 * of one rule rather than two rules that happen to agree.
 *
 * ## THE KINDS ARE NEVER SUMMED, and this module makes that structural
 *
 * One form submission by a new person writes a submission record, a contact
 * and a lead — three true statements about one visitor action. Adding them
 * would treble every campaign's conversions, and the reader would have no way
 * to see it had happened, because the sum looks like a bigger version of a
 * real number.
 *
 * So {@link CampaignConversionsReport} carries no total, no `all`, no
 * `conversions` scalar, and there is no function here that reduces the kinds.
 * A screen that wanted one would have to write the addition itself. The
 * report also raises {@link CampaignCaveat} `conversions-kinds-overlap` so
 * the reader is told WHY the four figures stand apart, rather than being left
 * to assume the product forgot to add them up.
 *
 * ## THE WEB CHANNEL HAS NO ROLLUP, and cannot be given one
 *
 * A conversion is credited to one of two touches. An EMAIL touch names a
 * campaign document — a real entity with a real id — so its conversions roll
 * up under it beside the revenue the same join credits it with. A WEB touch
 * is a `utm_` label a marketer typed into a URL: no document, no id, and no
 * bound on how many distinct values exist, because anybody who can vary a
 * query string can mint another one.
 *
 * A rollup keyed on that label is a map a stranger can grow, which is the
 * same unbounded key space the analytics collector caps its per-day label map
 * against. So the writer increments the rollup for the email channel ONLY,
 * this reader states that where the figure is drawn, and web-channel records
 * are read as records — see {@link campaignConversionsCoverage}.
 *
 * ## A CONVERSION WITH NO TOUCH IS NOT IN HERE AT ALL
 *
 * Direct traffic writes no record. There is deliberately no
 * `utm_source=direct` placeholder, no referrer inference and no "most recent
 * campaign on this site" fallback: a conversion nobody can be credited with
 * is a conversion nobody is credited with.
 *
 * That makes the absence of a record load-bearing, and it makes a screen
 * showing only attributed conversions a lie by omission — it renders "we
 * credited three of these" as "three of these happened".
 * {@link campaignConversionsCoverage} exists so the unattributed count is a
 * figure on the page rather than an inference nobody makes.
 */

/*
 * The constants are NOT re-exported here, though `campaign-revenue.ts`
 * re-exports the same two. Both modules sit behind one barrel, and a name
 * exported twice through it is a name a bundler has to disambiguate. Every
 * screen reads the rule off `model`/`windowDays` on the report anyway, which
 * is the stored value rather than today's constant — a campaign credited
 * under an older window has to print the window it was credited under.
 */

/**
 * Which identify moment a record credits.
 *
 * An array first, because the ORDER is the reading order on every screen and
 * a second list of these is a second chance to leave one out. The union is
 * derived from it rather than written twice.
 */
export const CAMPAIGN_CONVERSION_KINDS = [
  'form',
  'lead',
  'contact',
  'booking',
] as const

/** One identify moment. Mirrors the writer's `CampaignConversionKind`. */
export type CampaignConversionKind = (typeof CAMPAIGN_CONVERSION_KINDS)[number]

/** Which channel the credited touch arrived through. */
export type CampaignTouchChannel = 'email' | 'web'

/**
 * What a reader calls one kind, and what the count means.
 *
 * The note is the half that stops the addition. Each one names a DIFFERENT
 * population of the same visitors, and saying so under every figure is what
 * makes four numbers standing apart read as deliberate rather than as a
 * missing total.
 */
export interface CampaignConversionKindCopy {
  label: string
  note: string
}

export const CAMPAIGN_CONVERSION_KIND_COPY: Readonly<
  Record<CampaignConversionKind, CampaignConversionKindCopy>
> = {
  form: {
    label: 'Form submissions',
    note: 'submissions credited to this campaign',
  },
  lead: { label: 'Leads', note: 'new leads credited to this campaign' },
  contact: {
    label: 'Contacts',
    note: 'new contacts credited to this campaign',
  },
  booking: { label: 'Bookings', note: 'bookings credited to this campaign' },
}

/**
 * The stored shape of `campaigns/{campaignId}/reports/conversions`.
 *
 * Its own document beside `reports/revenue`, for the reason that one is: the
 * campaign document is read by the history list, the glance widget and the
 * send path, and a map that grows with what the campaign caused would enlarge
 * every one of those reads.
 */
export interface CampaignConversionsRollup {
  byKind?: Partial<Record<CampaignConversionKind, number>>
  /** The model these conversions were credited under. */
  model?: string
  /** The window, in days, they were credited inside. */
  windowDays?: number
}

/**
 * The stored shape of `hosts/{hostId}/campaignAttributions/{kind}:{refId}`.
 *
 * Read-side only, and every field optional: this is a document somebody
 * else's writer produced, and a reader that assumed a field was present would
 * throw on the first record written by an older version of it.
 */
export interface CampaignConversionRecord {
  kind?: CampaignConversionKind
  /** The submission, lead, contact or booking this credits. */
  refId?: string
  channel?: CampaignTouchChannel
  /** The campaign document, when the touch was a click on our own mail. */
  campaignId?: string
  /** `utm_source`, when the touch was a link on the web. */
  source?: string
  /** `utm_medium`, when the touch was a link on the web. */
  medium?: string
  /** `utm_campaign`, when the touch was a link on the web. */
  campaign?: string
  /** When the visitor followed the campaign link, epoch ms. */
  touchedAtMs?: number
  /** When the visitor became identifiable, epoch ms. */
  convertedAtMs?: number
  model?: string
  windowDays?: number
}

/**
 * The document id for one conversion — `{kind}:{refId}`.
 *
 * The reader's half of the writer's `campaignConversionId`. It is restated
 * here rather than imported because the writer lives in `tenant-data-admin`,
 * which a UI library may not import, and it is one line whose shape is
 * asserted in this module's spec.
 *
 * Answers `null` for an unusable pair rather than building `form:undefined`,
 * which would be a valid document path pointing at a record that can never
 * exist — a keyed read that silently reports "not attributed" for every
 * record on the screen.
 */
export function campaignConversionId(
  kind: string | null | undefined,
  refId: string | null | undefined,
): string | null {
  const k = String(kind ?? '')
  const ref = String(refId ?? '')
  if (!k || !ref) return null
  if (!(CAMPAIGN_CONVERSION_KINDS as readonly string[]).includes(k)) return null
  // A slash would leave the collection; the id scheme already spends the
  // colon, and a ref carrying one would make the pair ambiguous.
  if (ref.includes('/') || ref.includes(':')) return null
  return `${k}:${ref}`
}

/** A stored count as a non-negative integer. */
function count(raw: unknown): number {
  const value = Math.floor(Number(raw ?? 0))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** One kind's figure on screen. Independent of every other kind's. */
export interface CampaignConversionKindReport {
  kind: CampaignConversionKind
  label: string
  /**
   * Conversions of this kind, or `null` when the rollup holds no entry.
   *
   * `null` rather than 0 for {@link CampaignConversionsReport.recorded}'s
   * reason, applied per kind: a site with no booking form has never written a
   * booking conversion, and rendering that as a measured zero invites the
   * reader to conclude the campaign failed at something it never attempted.
   */
  value: number | null
  note: string
}

/** Everything the conversions section renders. */
export interface CampaignConversionsReport {
  /**
   * One entry per kind, always all four and always in
   * {@link CAMPAIGN_CONVERSION_KINDS} order.
   *
   * There is deliberately NO total beside this array, and no field anywhere
   * on this report that holds one. See the module docblock.
   */
  kinds: CampaignConversionKindReport[]
  /**
   * Whether the rollup document exists at all.
   *
   * `false` is NOT "this campaign caused nothing" — it is also every campaign
   * sent before the join existed, and every campaign whose conversions all
   * arrived through the web channel, which writes no rollup. The screen
   * renders the difference rather than printing a zero for all three.
   */
  recorded: boolean
  /** At least one kind holds a figure. */
  any: boolean
  /** The model these figures were credited under, as stored. */
  model: string
  /** The window they were credited inside, as stored. */
  windowDays: number
  caveats: CampaignCaveat[]
}

/**
 * Turns the stored rollup into the conversions section.
 *
 * Takes the rollup and nothing else. Unlike the revenue report there is no
 * denominator to hand in: a conversion RATE over delivered messages would be
 * the same defect the revenue section refuses for orders — one visitor can
 * submit two forms, so the quotient passes 100% without anything being wrong
 * — and counting distinct people would need a document per person per
 * campaign, the per-recipient read this whole surface exists to refuse.
 */
export function campaignConversionsReport(options: {
  rollup: CampaignConversionsRollup | undefined
}): CampaignConversionsReport {
  const { rollup } = options
  const stored = rollup?.byKind ?? {}
  const caveats: CampaignCaveat[] = []

  const kinds: CampaignConversionKindReport[] = CAMPAIGN_CONVERSION_KINDS.map(
    (kind) => {
      const raw = stored[kind]
      const copy = CAMPAIGN_CONVERSION_KIND_COPY[kind]
      return {
        kind,
        label: copy.label,
        // `undefined` means the rollup has no entry for this kind, which is
        // not a measured zero. A stored 0 is impossible — the writer only
        // ever increments — but it is read as unrecorded for the same reason.
        value: raw === undefined || count(raw) === 0 ? null : count(raw),
        note: copy.note,
      }
    },
  )

  const any = kinds.some((entry) => entry.value !== null)

  if (any) {
    caveats.push({
      id: 'conversions-kinds-overlap',
      message:
        'These figures count different things about the same visits and are ' +
        'deliberately not added together. One person filling in one form can ' +
        'appear as a submission, a contact and a lead, so a total would ' +
        'count that visit three times.',
    })
    caveats.push({
      id: 'conversions-web-not-rolled-up',
      message:
        'Campaign emails only. A conversion credited to a link tagged with ' +
        'utm_ parameters is recorded against that label rather than against ' +
        'a campaign, so it is not in the figures above — those conversions ' +
        'are listed under Conversions in the marketing console.',
    })
  }

  return {
    kinds,
    recorded: rollup !== undefined,
    any,
    model: String(rollup?.model ?? EMAIL_ATTRIBUTION_MODEL),
    windowDays: count(rollup?.windowDays) || EMAIL_ATTRIBUTION_WINDOW_DAYS,
    caveats,
  }
}

/**
 * How much of one kind was credited to anything at all.
 *
 * ## Why this figure has to exist
 *
 * The join writes nothing for a conversion it cannot credit, so a list of
 * attribution records is a list of the SUCCESSES. Rendering only that turns
 * "we credited four of these" into "four of these happened", and the reader
 * draws a conclusion about their campaigns from a number that is mostly a
 * fact about how many visitors arrived without a campaign link.
 *
 * So the screen shows both halves and this computes the second. `attributed`
 * is counted over the attribution records; `total` over the records the
 * conversions themselves live in.
 *
 * ## Why the difference is a CEILING and says so
 *
 * The two counts come from different collections with different histories,
 * and the gap between them holds three things that are not the same:
 *
 *  - conversions by visitors who arrived directly, which is what the figure
 *    is meant to describe;
 *  - conversions from before the join existed, which were never eligible; and
 *  - for contacts, conversions on the org's OTHER sites, because contacts are
 *    shared across an org while attributions are per host.
 *
 * None of those can be separated from the others without a field nobody
 * writes, so `unattributed` is reported as an upper bound and
 * {@link CampaignConversionsCoverage.exact} is `false` whenever the reasons
 * apply. A figure presented as exact when it is not is the failure this
 * whole surface is built to avoid.
 */
export interface CampaignConversionsCoverage {
  kind: CampaignConversionKind
  /** Conversions of this kind credited to some campaign or label. */
  attributed: number
  /** Conversions of this kind that exist, credited or not. */
  total: number
  /** `total - attributed`, clamped at zero. An upper bound, not a count. */
  unattributed: number
  /**
   * Whether `unattributed` may be read as "arrived directly".
   *
   * Always `false` today — the three reasons in the docblock all apply to
   * every host — and kept as a field rather than hardcoded in the copy so a
   * screen asks the model rather than restating its conclusion.
   */
  exact: boolean
  caveats: CampaignCaveat[]
}

/**
 * The attributed/unattributed split for one kind.
 *
 * `total` is `null` when it could not be counted — the aggregation failed, or
 * the collection is not readable from this surface — and the split is then
 * withheld entirely rather than defaulting `total` to `attributed`, which
 * would render every conversion as attributed and is the single most
 * flattering wrong answer available here.
 */
export function campaignConversionsCoverage(options: {
  kind: CampaignConversionKind
  attributed: number | null | undefined
  total: number | null | undefined
  /** The kind's records live outside this host, so `total` over-counts. */
  crossHostTotal?: boolean
}): CampaignConversionsCoverage | null {
  const { kind, crossHostTotal } = options
  if (options.total == null || options.attributed == null) return null
  const attributed = count(options.attributed)
  const total = count(options.total)
  const caveats: CampaignCaveat[] = []

  /*
   * CLAMPED, and only here at the point of display. The two counts are taken
   * from two collections a moment apart, so a conversion recorded between
   * them makes `attributed` briefly exceed `total`; a negative count of
   * things that did not happen is not a sentence anybody can act on.
   */
  const unattributed = Math.max(0, total - attributed)

  caveats.push({
    id: 'conversions-unattributed-is-a-ceiling',
    message:
      `${unattributed.toLocaleString()} of these are not credited to any ` +
      'campaign. Most arrived without following a campaign link and are ' +
      'recorded as direct — nothing is guessed from a referrer, and no ' +
      'campaign is credited for being the most recent one to run. The rest ' +
      'are records from before campaign attribution was recorded at all, so ' +
      'read this as an upper bound rather than a count of direct arrivals.',
  })
  if (crossHostTotal) {
    caveats.push({
      id: 'conversions-total-crosses-hosts',
      message:
        'Contacts are shared across every site in this organization, while ' +
        'attributions belong to one site. The uncredited figure therefore ' +
        'includes contacts that were created on another site and could ' +
        'never have been credited here.',
    })
  }

  return {
    kind,
    attributed,
    total,
    unattributed,
    // Never true while the reasons above stand. The field exists so a screen
    // reads the model rather than restating its conclusion in JSX.
    exact: false,
    caveats,
  }
}

/**
 * How a record names the thing it was credited to.
 *
 * The email channel names a campaign document, so the screen can link to it.
 * The web channel names a label the marketer typed, which is text and never a
 * link — there is nothing at the other end of it.
 *
 * The `utm_` triple is joined in the order a marketer set it, with the parts
 * that are absent left out rather than filled with a placeholder: `google /
 * cpc` and `google / cpc / (none)` describe the same link, and only one of
 * them invites the reader to look for a campaign called "(none)".
 */
export function campaignTouchLabel(
  record: CampaignConversionRecord | null | undefined,
): string {
  if (!record) return ''
  if (record.channel === 'email') return String(record.campaignId ?? '')
  const parts = [record.source, record.medium, record.campaign]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
  return parts.join(' / ')
}
