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
  PLUGIN_FIGURE_MAX_ROWS,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRow,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  type SendRate,
  type SendStats,
} from '@aglyn/shared-ui-email-campaigns/model/send-report'
import { campaignReport } from '../model/campaign-report'
import {
  EMAIL_CREATED_AT_FIELD,
  emailSendTimeMs,
} from '../model/email-record'
import { CAMPAIGN_SEND_HOST_FIELD } from '../model/campaign-container'
import { orgCampaignSends } from './campaign-org-refs'
import { compareVariants, summarizeVariantStats, type HostExperiment } from '../model/experiments'
import {
  CAMPAIGN_CONVERSION_KINDS,
  type CampaignConversionKind,
  type CampaignTouchChannel,
} from '../model/campaign-conversions'
import {
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  type CampaignRevenueRollup,
} from '../model/campaign-revenue'
import { CAMPAIGN_ATTRIBUTIONS_COLLECTION } from './campaign-attribution-store'

/**
 * A site's campaign and A/B testing results as figure tables another plugin
 * reads by id (AGL-2915).
 *
 * The campaign table is what each send's report shows — delivered, and the
 * open and click rates over delivered — through `campaignReport`, the one
 * reader of a send's counters. The experiments table is what the A/B testing
 * section shows, through the same variant comparison. No recipient, address
 * or visitor reaches either: a campaign is named by its subject, a variant by
 * its name.
 */

type Firestore = FirebaseFirestore.Firestore

const MARKETING_PLUGIN_ID = 'marketing'

/** Sends a campaign table reads, newest first, before it keeps those sent in the window. */
export const CAMPAIGN_FIGURES_READ_LIMIT = 100

/** Experiments an experiments table reads. */
export const EXPERIMENT_FIGURES_READ_LIMIT = 20

/**
 * The channels a conversion is counted by, in reading order. Each is an
 * aggregation count over the attribution records — `kind`, `channel` and the
 * window on `convertedAtMs` — so the table costs a read per thousand index
 * entries rather than a read per record, and never loads one.
 */
export const CONVERSION_FIGURE_CHANNELS: readonly CampaignTouchChannel[] = ['email', 'page', 'web', 'sequence']

/** How a conversions table names each kind: the record it credits, in the console's words. */
const CONVERSION_KIND_LABELS: Readonly<Record<CampaignConversionKind, string>> = {
  form: 'Form submissions',
  lead: 'Leads',
  contact: 'Contacts',
  booking: 'Bookings',
}

const WINDOWS: readonly number[] = [7, 14, 30, 90]

const percent = (rate: SendRate | null): number | null =>
  rate ? Math.round(rate.value * 1_000) / 10 : null

/** Rates pooled across sends: every numerator over every denominator, never an average of rates. */
function pooled(rates: ReadonlyArray<SendRate | null>): number | null {
  const known = rates.filter((rate): rate is SendRate => rate !== null)
  const denominator = known.reduce((sum, rate) => sum + rate.denominator, 0)
  if (!denominator) return null
  return Math.round((known.reduce((sum, rate) => sum + rate.numerator, 0) / denominator) * 1_000) / 10
}

export function marketingFigureReaders(firestore: () => Firestore): PluginFigureReader[] {
  return [
    {
      id: 'marketing.campaigns',
      label: 'Campaigns',
      description:
        'Each campaign email sent from the site in the window: how many were delivered and the share of delivered messages opened and clicked, with every campaign together on the first row.',
      scope: 'site',
      windows: WINDOWS,
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its campaigns' }
        if (!WINDOWS.includes(request.days)) {
          return { ok: false, status: 400, error: 'That window is not one campaigns are read over' }
        }
        if (!request.orgId) return { ok: false, status: 400, error: 'This site is not part of an organization' }
        const { current } = pluginFigureWindows(request.now, request.days)
        /*
         * The organization's sends, narrowed to the ones sent as this site.
         * Served by the composite index on the site field and the creation
         * stamp — the equality and the ordering together are one index.
         */
        const snapshot = await orgCampaignSends(firestore(), request.orgId)
          .where(CAMPAIGN_SEND_HOST_FIELD, '==', request.hostId)
          .orderBy(EMAIL_CREATED_AT_FIELD, 'desc')
          .limit(CAMPAIGN_FIGURES_READ_LIMIT)
          .get()
        const sends = snapshot.docs
          .map((doc) => doc.data() ?? {})
          .filter((record) => {
            const sentAt = emailSendTimeMs(record)
            return Boolean(record['sentAt']) && sentAt >= current.startMs && sentAt < current.endMs
          })
          .map((record) => ({
            subject: String(record['subject'] ?? '').trim() || 'A campaign with no subject',
            report: campaignReport(record['stats'] as SendStats | undefined),
          }))
        const rows: PluginFigureRow[] = [
          {
            campaign: 'All campaigns',
            delivered: sends.every((send) => send.report.delivered === null)
              ? null
              : sends.reduce((sum, send) => sum + (send.report.delivered ?? 0), 0),
            openRate: pooled(sends.map((send) => send.report.rates.open)),
            clickRate: pooled(sends.map((send) => send.report.rates.click)),
          },
          ...sends.slice(0, PLUGIN_FIGURE_MAX_ROWS - 1).map((send) => ({
            campaign: send.subject,
            delivered: send.report.delivered,
            openRate: percent(send.report.rates.open),
            clickRate: percent(send.report.rates.click),
          })),
        ]
        return {
          ok: true,
          table: {
            title: 'Campaigns',
            source: { label: 'Campaigns', path: 'marketing/campaigns' },
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'campaign', label: 'Campaign', kind: 'text' },
              { key: 'delivered', label: 'Delivered', kind: 'count' },
              { key: 'openRate', label: 'Opened', kind: 'percent' },
              { key: 'clickRate', label: 'Clicked', kind: 'percent' },
            ],
            rows,
            omitted: Math.max(0, sends.length - (PLUGIN_FIGURE_MAX_ROWS - 1)),
            notes: [
              'Rates are over delivered messages, and a campaign with no delivery recorded has none.',
              ...(snapshot.docs.length === CAMPAIGN_FIGURES_READ_LIMIT
                ? [`Only the ${CAMPAIGN_FIGURES_READ_LIMIT} most recent emails were looked at.`]
                : []),
            ],
          },
        }
      },
    },
    {
      id: 'marketing.experiments',
      label: 'A/B tests',
      description:
        'Each running or finished A/B test on the site: every variant’s visitors shown it, conversions and conversion rate, with the lift over the first variant and how confident that lift is.',
      scope: 'site',
      windows: [],
      feature: 'abTesting',
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its A/B tests' }
        const experimentsRef = firestore().collection('hosts').doc(request.hostId).collection('experiments')
        const snapshot = await experimentsRef.limit(EXPERIMENT_FIGURES_READ_LIMIT).get()
        const rows: PluginFigureRow[] = []
        for (const doc of snapshot.docs) {
          const experiment = (doc.data() ?? {}) as Partial<HostExperiment>
          if (experiment.status !== 'running' && experiment.status !== 'done') continue
          const variants = (experiment.variants ?? []).slice(0, 4)
          if (!variants.length) continue
          const stats = await doc.ref.collection('stats').get()
          const byVariant = new Map(stats.docs.map((entry) => [entry.id, entry.data() ?? {}]))
          const control = byVariant.get(variants[0].id) ?? {}
          variants.forEach((variant, index) => {
            const own = byVariant.get(variant.id) ?? {}
            const summary = summarizeVariantStats(own)
            const comparison = index === 0 ? null : compareVariants(control, own)
            rows.push({
              test: String(experiment.name ?? '').trim() || doc.id,
              variant: String(variant.name ?? '').trim() || variant.id,
              shown: summary.exposures,
              conversions: summary.conversions,
              rate: summary.exposures ? Math.round(summary.rate * 1_000) / 10 : null,
              lift: comparison?.lift === null || comparison === null ? null : Math.round(comparison.lift * 1_000) / 10,
              confidence:
                comparison?.confidence === null || comparison === null
                  ? null
                  : Math.round(comparison.confidence * 1_000) / 10,
            })
          })
        }
        return {
          ok: true,
          table: {
            title: 'A/B tests',
            source: { label: 'A/B testing', path: 'marketing/experiments' },
            period: null,
            columns: [
              { key: 'test', label: 'Test', kind: 'text' },
              { key: 'variant', label: 'Variant', kind: 'text' },
              { key: 'shown', label: 'Shown', kind: 'count' },
              { key: 'conversions', label: 'Conversions', kind: 'count' },
              { key: 'rate', label: 'Conversion rate', kind: 'percent' },
              { key: 'lift', label: 'Lift over the first variant', kind: 'change' },
              { key: 'confidence', label: 'Confidence in the lift', kind: 'percent' },
            ],
            rows: rows.slice(0, PLUGIN_FIGURE_MAX_ROWS),
            omitted: Math.max(0, rows.length - PLUGIN_FIGURE_MAX_ROWS),
            notes: ['Figures are totals since each test started; the first variant of a test is its control.'],
          },
        }
      },
    },
  ]
}

/** A stored count as a non-negative integer. */
const whole = (raw: unknown): number => {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * What the site's campaigns CAUSED and EARNED, as two more tables (AGL-3603):
 * the conversions credited to a campaign touch in the window, and the revenue
 * credited to the campaign emails sent in it. Same rules the Conversions
 * section and a campaign's report print — the kinds are never added together,
 * currencies are never added together, net is gross less refunded — and the
 * same honesty about what is NOT here: a conversion credited to nothing has no
 * record, so it is not counted, and the notes say so.
 */
export function marketingOutcomeFigureReaders(firestore: () => Firestore): PluginFigureReader[] {
  return [
    {
      id: 'marketing.conversions',
      label: 'Campaign conversions',
      description:
        'Conversions credited to a campaign touch on the site in the window — form submissions, leads, contacts and bookings, one row each — counted by the touch that earned the credit: a campaign email, a page filed under a campaign, a link labeled for a campaign, or a sales sequence email.',
      scope: 'site',
      windows: WINDOWS,
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its conversions' }
        if (!WINDOWS.includes(request.days)) {
          return { ok: false, status: 400, error: 'That window is not one conversions are read over' }
        }
        const { current } = pluginFigureWindows(request.now, request.days)
        /*
         * Aggregation counts, never the records: per kind, one over every
         * channel and one per channel, each an equality on `kind` (and
         * `channel`) with the window on `convertedAtMs`. Served by the two
         * composite indexes the index file declares for them.
         */
        const inWindow = (kind: CampaignConversionKind, channel: CampaignTouchChannel | null) => {
          let query = firestore()
            .collection('hosts')
            .doc(request.hostId as string)
            .collection(CAMPAIGN_ATTRIBUTIONS_COLLECTION)
            .where('kind', '==', kind)
          if (channel) query = query.where('channel', '==', channel)
          return query
            .where('convertedAtMs', '>=', current.startMs)
            .where('convertedAtMs', '<', current.endMs)
            .count()
            .get()
            .then((snapshot) => whole(snapshot.data().count))
        }
        const rows: PluginFigureRow[] = await Promise.all(
          CAMPAIGN_CONVERSION_KINDS.map(async (kind) => {
            const [credited, ...byChannel] = await Promise.all([
              inWindow(kind, null),
              ...CONVERSION_FIGURE_CHANNELS.map((channel) => inWindow(kind, channel)),
            ])
            const row: PluginFigureRow = { kind: CONVERSION_KIND_LABELS[kind], credited }
            CONVERSION_FIGURE_CHANNELS.forEach((channel, index) => {
              row[channel] = byChannel[index]
            })
            return row
          }),
        )
        return {
          ok: true,
          table: {
            title: 'Campaign conversions',
            source: { label: 'Conversions', path: 'marketing/conversions' },
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'kind', label: 'Conversion', kind: 'text' },
              { key: 'credited', label: 'Credited to a campaign', kind: 'count' },
              { key: 'email', label: 'From a campaign email', kind: 'count' },
              { key: 'page', label: 'From a campaign page', kind: 'count' },
              { key: 'web', label: 'From a labeled link', kind: 'count' },
              { key: 'sequence', label: 'From a sequence email', kind: 'count' },
            ],
            rows,
            omitted: 0,
            notes: [
              'Each row counts a different record of the same visits — one form submission can also make a lead and a contact — so the rows are never added together.',
              'Only conversions credited to a campaign touch are counted; a conversion credited to nothing has no record and is not in this table.',
            ],
          },
        }
      },
    },
    {
      id: 'marketing.revenue',
      label: 'Campaign revenue',
      description:
        'Revenue credited to each campaign email sent from the site in the window: orders credited, gross, refunded and net, one row per email and currency, with amounts in each row’s currency.',
      scope: 'site',
      windows: WINDOWS,
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its campaign revenue' }
        if (!WINDOWS.includes(request.days)) {
          return { ok: false, status: 400, error: 'That window is not one campaign revenue is read over' }
        }
        if (!request.orgId) return { ok: false, status: 400, error: 'This site is not part of an organization' }
        const { current } = pluginFigureWindows(request.now, request.days)
        // The campaigns table's own read: the site's sends, newest first.
        const sendsRef = orgCampaignSends(firestore(), request.orgId)
        const snapshot = await sendsRef
          .where(CAMPAIGN_SEND_HOST_FIELD, '==', request.hostId)
          .orderBy(EMAIL_CREATED_AT_FIELD, 'desc')
          .limit(CAMPAIGN_FIGURES_READ_LIMIT)
          .get()
        const sends = snapshot.docs
          .filter((doc) => {
            const record = doc.data() ?? {}
            const sentAt = emailSendTimeMs(record)
            return Boolean(record['sentAt']) && sentAt >= current.startMs && sentAt < current.endMs
          })
          .slice(0, PLUGIN_FIGURE_MAX_ROWS)
        /*
         * One keyed read per send for its revenue rollup, bounded by the rows
         * a table may carry — the rollup is its own document so the history
         * list never pays for it, and this is the one place that does.
         */
        const rollups = sends.length
          ? await firestore().getAll(
              ...sends.map((doc) => sendsRef.doc(doc.id).collection('reports').doc('revenue')),
            )
          : []
        const rows: PluginFigureRow[] = []
        const currencies = new Set<string>()
        sends.forEach((doc, index) => {
          const rollup = (rollups[index]?.data() ?? {}) as CampaignRevenueRollup
          for (const [currency, totals] of Object.entries(rollup.byCurrency ?? {})) {
            const grossCents = whole(totals?.grossCents)
            const refundedCents = whole(totals?.refundedCents)
            const orders = whole(totals?.orders)
            if (!orders && !grossCents) continue
            currencies.add(currency.toUpperCase())
            rows.push({
              campaign: String(doc.get('subject') ?? '').trim() || 'A campaign with no subject',
              currency: currency.toUpperCase(),
              orders,
              gross: grossCents / 100,
              refunded: refundedCents / 100,
              // Clamped where it is shown, as the campaign report clamps it.
              net: Math.max(0, grossCents - refundedCents) / 100,
            })
          }
        })
        const [only] = currencies
        const money = currencies.size === 1 && /^[A-Z]{3}$/.test(only ?? '')
        const amount = (key: string, label: string) =>
          money
            ? { key, label, kind: 'money' as const, currency: only }
            : { key, label: `${label} (in the row’s currency)`, kind: 'number' as const }
        return {
          ok: true,
          table: {
            title: 'Campaign revenue',
            source: { label: 'Campaigns', path: 'marketing/campaigns' },
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'campaign', label: 'Campaign email', kind: 'text' },
              { key: 'currency', label: 'Currency', kind: 'text' },
              { key: 'orders', label: 'Orders credited', kind: 'count' },
              amount('gross', 'Gross'),
              amount('refunded', 'Refunded'),
              amount('net', 'Net'),
            ],
            rows: rows.slice(0, PLUGIN_FIGURE_MAX_ROWS),
            omitted: Math.max(0, rows.length - PLUGIN_FIGURE_MAX_ROWS),
            notes: [
              `Revenue is credited to the last campaign email whose link the buyer clicked within ${EMAIL_ATTRIBUTION_WINDOW_DAYS} days, for the emails sent in the window; amounts in different currencies are never added together.`,
              ...(snapshot.docs.length === CAMPAIGN_FIGURES_READ_LIMIT
                ? [`Only the ${CAMPAIGN_FIGURES_READ_LIMIT} most recent emails were looked at.`]
                : []),
            ],
          },
        }
      },
    },
  ]
}

/** Registers the campaign and A/B testing readers from the console surface, where insight jobs run. */
export function registerMarketingFigureReaders(firestore: () => Firestore): void {
  for (const reader of [...marketingFigureReaders(firestore), ...marketingOutcomeFigureReaders(firestore)]) {
    registerPluginFigureReader(reader, { pluginId: MARKETING_PLUGIN_ID })
  }
}
