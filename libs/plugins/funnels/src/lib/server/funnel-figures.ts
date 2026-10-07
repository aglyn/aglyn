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
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { BUNDLE_ID } from '../constants/bundle-common'
import { computeFunnel } from '../model/funnel-compute'
import { normalizeFunnelDefinition } from '../model/funnel-definition'
import {
  FUNNEL_FEATURE,
  FUNNELS_COLLECTION,
  FUNNELS_MAX_PER_SITE,
  type FunnelDefinition,
} from '../model/funnels.types'
import { readJourneys } from './funnel-results.server'

/**
 * A site's funnels as figure tables the AI insight job reads by id
 * (AGL-3605) — the `funnels` figure set. "Ask AI about this funnel" asks over
 * these, and so does "Ask about your numbers" on the Analytics page.
 *
 * Counts and rates only: a step is named by its label, a visit by nothing.
 * One read of the window's visits serves every funnel in a table.
 */

const WINDOWS: readonly number[] = [7, 14, 30, 90]

const percent = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1_000) / 10

async function readFunnels(
  firestore: any,
  hostId: string,
): Promise<Array<{ id: string; funnel: FunnelDefinition }>> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection(FUNNELS_COLLECTION)
    .limit(FUNNELS_MAX_PER_SITE)
    .get()
  const out: Array<{ id: string; funnel: FunnelDefinition }> = []
  for (const doc of snapshot.docs) {
    const normalized = normalizeFunnelDefinition(doc.data())
    if ('funnel' in normalized) out.push({ id: doc.id, funnel: normalized.funnel })
  }
  return out.sort((a, b) => a.funnel.name.localeCompare(b.funnel.name))
}

const CAPPED_NOTE = 'Only the most recent visits in the window were measured.'
const VISIT_NOTE =
  'A visit is one browser tab on the site, recorded only with the visitor’s analytics consent; two tabs are two visits.'

export function funnelFigureReaders(firestore: () => any): PluginFigureReader[] {
  const windowCheck = (days: number) => WINDOWS.includes(days)
  return [
    {
      id: 'funnels.overview',
      label: 'Funnels',
      description:
        'Each funnel defined on the site: how many visits entered its first step in the window, how many completed every step, and the share that completed.',
      scope: 'site',
      windows: WINDOWS,
      feature: FUNNEL_FEATURE,
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its funnels' }
        if (!windowCheck(request.days)) {
          return { ok: false, status: 400, error: 'That window is not one funnels are read over' }
        }
        const funnels = await readFunnels(firestore(), request.hostId)
        const { current } = pluginFigureWindows(request.now, request.days)
        const { journeys, capped } = funnels.length
          ? await readJourneys(firestore(), request.hostId, current.startMs, current.endMs)
          : { journeys: [], capped: false }
        const rows = funnels.slice(0, PLUGIN_FIGURE_MAX_ROWS).map(({ funnel }) => {
          const result = computeFunnel(funnel.steps, journeys)
          return {
            funnel: funnel.name,
            steps: funnel.steps.length,
            entered: result.entered,
            completed: result.completed,
            conversion: percent(result.overall),
          }
        })
        return {
          ok: true,
          table: {
            title: 'Funnels',
            source: { label: 'Analytics', path: 'analytics' },
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'funnel', label: 'Funnel', kind: 'text' },
              { key: 'steps', label: 'Steps', kind: 'count' },
              { key: 'entered', label: 'Visits that entered', kind: 'count' },
              { key: 'completed', label: 'Visits that completed', kind: 'count' },
              { key: 'conversion', label: 'Completed', kind: 'percent' },
            ],
            rows,
            omitted: Math.max(0, funnels.length - PLUGIN_FIGURE_MAX_ROWS),
            notes: [VISIT_NOTE, ...(capped ? [CAPPED_NOTE] : [])],
          },
        }
      },
    },
    {
      id: 'funnels.steps',
      label: 'Funnel steps',
      description:
        'One funnel step by step: the visits at each step, the share of the previous step that reached it, how many dropped off before it, and the median time from the previous step.',
      scope: 'site',
      windows: WINDOWS,
      feature: FUNNEL_FEATURE,
      params: [
        {
          name: 'funnel',
          description: 'The funnel, by its name as the Funnels card shows it.',
          required: true,
        },
      ],
      read: async (request) => {
        if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its funnels' }
        if (!windowCheck(request.days)) {
          return { ok: false, status: 400, error: 'That window is not one funnels are read over' }
        }
        const wanted = String(request.params['funnel'] ?? '').trim().toLowerCase()
        const funnels = await readFunnels(firestore(), request.hostId)
        const found =
          funnels.find((one) => one.funnel.name.toLowerCase() === wanted) ??
          funnels.find((one) => one.id.toLowerCase() === wanted)
        if (!found) return { ok: false, status: 404, error: 'No funnel on this site has that name' }
        const { current } = pluginFigureWindows(request.now, request.days)
        const { journeys, capped } = await readJourneys(
          firestore(),
          request.hostId,
          current.startMs,
          current.endMs,
        )
        const result = computeFunnel(found.funnel.steps, journeys)
        return {
          ok: true,
          table: {
            title: found.funnel.name,
            source: { label: 'Analytics', path: 'analytics' },
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'step', label: 'Step', kind: 'text' },
              { key: 'visitors', label: 'Visits', kind: 'count' },
              { key: 'fromPrevious', label: 'Of the previous step', kind: 'percent' },
              { key: 'dropOff', label: 'Dropped off before it', kind: 'count' },
              { key: 'medianTime', label: 'Median time from the previous step', kind: 'duration' },
            ],
            rows: result.steps.map((step) => ({
              step: `${step.index + 1}. ${step.label}`,
              visitors: step.visitors,
              fromPrevious: percent(step.fromPrevious),
              dropOff: step.dropOff,
              medianTime:
                step.medianMsFromPrevious === null ? null : Math.round(step.medianMsFromPrevious / 1000),
            })),
            omitted: 0,
            notes: [
              VISIT_NOTE,
              'Durations are in seconds.',
              ...(capped ? [CAPPED_NOTE] : []),
            ],
          },
        }
      },
    },
  ]
}

/** Registers the funnel readers from the console surface, where insight jobs run. */
export function registerFunnelFigureReaders(firestore: () => any): void {
  for (const reader of funnelFigureReaders(firestore)) {
    registerPluginFigureReader(reader, { pluginId: BUNDLE_ID })
  }
}
