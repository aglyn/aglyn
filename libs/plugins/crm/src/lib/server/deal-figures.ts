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

import { isPipelineArchived, type CrmDeal, type CrmPipeline } from '@aglyn/aglyn/app-utils/crm'
import {
  PLUGIN_FIGURE_MAX_ROWS,
  pluginFigureChange,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRow,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'
import { BUNDLE_ID } from '../constants/bundle-common'
import { currencyOfDeals, pipelineTotals } from '../model/crm-reports'

/**
 * The organization's deals as figure tables another plugin reads by id
 * (AGL-3603) — the AI plugin's insights answer "how much is in the pipeline?"
 * and "what did we win this month?" from them.
 *
 *  - `crm.pipeline`: the open pipeline as it stands, by pipeline and stage —
 *    how many deals, what they are worth, and what they are worth at their
 *    stage's odds — with `pipelineTotals`, the Reports page's own arithmetic.
 *  - `crm.closed`: deals won and lost over the window, what was won, the win
 *    rate, and the change in won deals from the window before.
 *
 * Organization readers: with a site, only the deals shared with that site —
 * `scopedToHost`, the predicate the rules evaluate — and with none, the
 * workspace's. Each read is a Firestore query on `status` (and `closedAtMs`
 * for the window), served by the `deals` composites the index file already
 * carries, projected to the fields counted and capped; a deal's title, its
 * contact and its company never reach a table.
 */

type Firestore = FirebaseFirestore.Firestore

/** Open deals the pipeline reads; a larger pipeline is told its figures read low. */
export const DEAL_FIGURES_OPEN_CEILING = 1_000

/** Deals one window reads of each outcome. */
export const DEAL_FIGURES_CLOSED_CEILING = 1_000

/** Pipelines read. */
export const DEAL_FIGURES_PIPELINE_CEILING = 20

const WINDOWS: readonly number[] = [7, 14, 30, 90]

type DealRow = Pick<CrmDeal, 'status' | 'stageId' | 'pipelineId' | 'amountCents' | 'currency' | 'probability'>

const major = (cents: number): number => Math.round(cents) / 100

function deals(firestore: Firestore, orgId: string, hostId: string | null): FirebaseFirestore.Query {
  const collection = firestore.collection('orgs').doc(orgId).collection('deals')
  return hostId ? scopedToHost(collection, hostId) : collection
}

async function readOpenDeals(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
): Promise<{ rows: DealRow[]; truncated: boolean }> {
  const snapshot = await deals(firestore, orgId, hostId)
    .where('status', '==', 'open')
    .orderBy('updatedAt', 'desc')
    .select('status', 'stageId', 'pipelineId', 'amountCents', 'currency', 'probability')
    .limit(DEAL_FIGURES_OPEN_CEILING + 1)
    .get()
  return {
    rows: snapshot.docs.slice(0, DEAL_FIGURES_OPEN_CEILING).map((doc) => (doc.data() ?? {}) as DealRow),
    truncated: snapshot.docs.length > DEAL_FIGURES_OPEN_CEILING,
  }
}

async function readPipelines(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
): Promise<Array<{ id: string; pipeline: CrmPipeline }>> {
  const collection = firestore.collection('orgs').doc(orgId).collection('pipelines')
  const snapshot = await (hostId ? scopedToHost(collection, hostId) : collection)
    .limit(DEAL_FIGURES_PIPELINE_CEILING)
    .get()
  return snapshot.docs
    .map((doc) => ({ id: doc.id, pipeline: (doc.data() ?? {}) as CrmPipeline }))
    .filter(({ pipeline }) => !isPipelineArchived(pipeline))
}

export function crmPipelineFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'crm.pipeline',
    label: 'Deal pipeline',
    description:
      'The open deals as they stand, by pipeline and stage: how many, what they are worth, and what they are worth at each stage’s odds. Current totals, with no window.',
    scope: 'org',
    windows: [],
    feature: 'crm',
    read: async (request) => {
      const db = firestore()
      const [open, pipelines] = await Promise.all([
        readOpenDeals(db, request.orgId, request.hostId),
        readPipelines(db, request.orgId, request.hostId),
      ])
      const { currency, mixed } = currencyOfDeals(open.rows)
      const code = currency.toUpperCase()
      const rows: PluginFigureRow[] = []
      let count = 0
      let amount = 0
      let weighted = 0
      let placed = 0
      for (const { id, pipeline } of pipelines) {
        const totals = pipelineTotals(
          open.rows.filter((deal) => deal.pipelineId === id),
          pipeline,
        )
        count += totals.count
        amount += totals.amountCents
        weighted += totals.weightedCents
        for (const stage of totals.stages) {
          placed += 1
          rows.push({
            pipeline: pipeline.name || 'Untitled pipeline',
            stage: stage.stage.name || 'Untitled stage',
            deals: stage.count,
            value: major(stage.amountCents),
            weighted: major(stage.weightedCents),
          })
        }
      }
      const kept = rows.slice(0, PLUGIN_FIGURE_MAX_ROWS - 1)
      return {
        ok: true,
        table: {
          title: 'Deal pipeline',
          source: { label: 'CRM reports', path: 'crm/reports' },
          period: null,
          columns: [
            { key: 'pipeline', label: 'Pipeline', kind: 'text' },
            { key: 'stage', label: 'Stage', kind: 'text' },
            { key: 'deals', label: 'Open deals', kind: 'count' },
            { key: 'value', label: 'Value', kind: 'money', currency: code },
            { key: 'weighted', label: 'Weighted value', kind: 'money', currency: code },
          ],
          rows: [
            { pipeline: 'All pipelines', stage: 'All open stages', deals: count, value: major(amount), weighted: major(weighted) },
            ...kept,
          ],
          omitted: Math.max(0, placed - kept.length),
          notes: [
            'Only open deals: a won deal is revenue and a lost one is history.',
            ...(mixed ? [`Deals are in more than one currency; every amount is added as ${code}.`] : []),
            ...(open.truncated
              ? [`More than ${DEAL_FIGURES_OPEN_CEILING.toLocaleString('en-US')} deals are open, so the figures count the most recently updated ${DEAL_FIGURES_OPEN_CEILING.toLocaleString('en-US')} and read low.`]
              : []),
          ].slice(0, 3),
        },
      }
    },
  }
}

interface ClosedRead {
  count: number
  amountCents: number
  currencies: Array<Pick<CrmDeal, 'currency'>>
  truncated: boolean
}

async function readClosed(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
  status: 'won' | 'lost',
  startMs: number,
  endMs: number,
): Promise<ClosedRead> {
  const snapshot = await deals(firestore, orgId, hostId)
    .where('status', '==', status)
    .where('closedAtMs', '>=', startMs)
    .where('closedAtMs', '<', endMs)
    .orderBy('closedAtMs', 'asc')
    .select('amountCents', 'currency')
    .limit(DEAL_FIGURES_CLOSED_CEILING + 1)
    .get()
  const docs = snapshot.docs.slice(0, DEAL_FIGURES_CLOSED_CEILING).map((doc) => (doc.data() ?? {}) as DealRow)
  return {
    count: docs.length,
    amountCents: docs.reduce((sum, deal) => sum + Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0)), 0),
    currencies: docs,
    truncated: snapshot.docs.length > DEAL_FIGURES_CLOSED_CEILING,
  }
}

export function crmClosedDealsFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'crm.closed',
    label: 'Deals won and lost',
    description:
      'Deals closed over the window: how many were won and lost, what was won, the win rate, and the change in deals won from the window before.',
    scope: 'org',
    windows: WINDOWS,
    feature: 'crm',
    read: async (request) => {
      if (!WINDOWS.includes(request.days)) {
        return { ok: false, status: 400, error: 'That window is not one closed deals are read over' }
      }
      const db = firestore()
      const { current, previous } = pluginFigureWindows(request.now, request.days)
      const [won, lost, wonBefore] = await Promise.all([
        readClosed(db, request.orgId, request.hostId, 'won', current.startMs, current.endMs),
        readClosed(db, request.orgId, request.hostId, 'lost', current.startMs, current.endMs),
        readClosed(db, request.orgId, request.hostId, 'won', previous.startMs, previous.endMs),
      ])
      const { currency, mixed } = currencyOfDeals(won.currencies)
      const code = currency.toUpperCase()
      const closed = won.count + lost.count
      return {
        ok: true,
        table: {
          title: 'Deals won and lost',
          source: { label: 'CRM reports', path: 'crm/reports' },
          period: { from: current.from, to: current.to, days: request.days },
          columns: [
            { key: 'won', label: 'Won', kind: 'count' },
            { key: 'lost', label: 'Lost', kind: 'count' },
            { key: 'wonValue', label: 'Value won', kind: 'money', currency: code },
            { key: 'winRate', label: 'Win rate', kind: 'percent' },
            { key: 'change', label: 'Change in deals won', kind: 'change' },
          ],
          rows: [
            {
              won: won.count,
              lost: lost.count,
              wonValue: major(won.amountCents),
              winRate: closed > 0 ? Math.round((won.count / closed) * 1_000) / 10 : null,
              change: pluginFigureChange(won.count, wonBefore.count),
            },
          ],
          omitted: 0,
          notes: [
            'A deal is counted on the day it closed.',
            ...(mixed ? [`Deals won are in more than one currency; every amount is added as ${code}.`] : []),
            ...(won.truncated || lost.truncated || wonBefore.truncated
              ? [`More than ${DEAL_FIGURES_CLOSED_CEILING.toLocaleString('en-US')} deals closed one way in a window, so the figures count ${DEAL_FIGURES_CLOSED_CEILING.toLocaleString('en-US')} and read low.`]
              : []),
          ].slice(0, 3),
        },
      }
    },
  }
}

/** Registers the deal readers from the console surface, where insight jobs run. */
export function registerDealFigureReaders(firestore: () => Firestore): void {
  for (const reader of [crmPipelineFigureReader(firestore), crmClosedDealsFigureReader(firestore)]) {
    registerPluginFigureReader(reader, { pluginId: BUNDLE_ID })
  }
}
