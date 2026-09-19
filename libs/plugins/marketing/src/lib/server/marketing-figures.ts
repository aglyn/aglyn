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
  campaignReport,
  type CampaignRate,
  type CampaignStats,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'
import {
  EMAIL_CREATED_AT_FIELD,
  emailSendTimeMs,
} from '@aglyn/shared-ui-email-campaigns/model/email-record'
import { compareVariants, summarizeVariantStats, type HostExperiment } from '../model/experiments'

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

const WINDOWS: readonly number[] = [7, 14, 30, 90]

const percent = (rate: CampaignRate | null): number | null =>
  rate ? Math.round(rate.value * 1_000) / 10 : null

/** Rates pooled across sends: every numerator over every denominator, never an average of rates. */
function pooled(rates: ReadonlyArray<CampaignRate | null>): number | null {
  const known = rates.filter((rate): rate is CampaignRate => rate !== null)
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
        const { current } = pluginFigureWindows(request.now, request.days)
        const snapshot = await firestore()
          .collection('hosts')
          .doc(request.hostId)
          .collection('campaigns')
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
            report: campaignReport(record['stats'] as CampaignStats | undefined),
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

/** Registers the campaign and A/B testing readers from the console surface, where insight jobs run. */
export function registerMarketingFigureReaders(firestore: () => Firestore): void {
  for (const reader of marketingFigureReaders(firestore)) {
    registerPluginFigureReader(reader, { pluginId: MARKETING_PLUGIN_ID })
  }
}
