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
  pluginFigureChange,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * A site's automation runs as a figure table another plugin reads by id
 * (AGL-3603) — the AI plugin's insights answer "which automations failed?"
 * from it.
 *
 * Every run an action, a workflow or an organization automation makes is a
 * row in the site's activity log carrying `result` (`succeeded` or `failed`)
 * and `target` — the same rows the run history lists. The totals are COUNT
 * aggregates over `result` in the window (the `activity` composite on
 * `result` + `createdAt`), so they are exact however busy the site is; the
 * per-automation split reads at most `AUTOMATION_RUN_FIGURES_WINDOW_CEILING`
 * runs of each result, projected to `target`, and says so when that read
 * low. A run's event payload names a person and is never read.
 */

type Firestore = FirebaseFirestore.Firestore

/** Runs of one result one window reads for the per-automation split. */
export const AUTOMATION_RUN_FIGURES_WINDOW_CEILING = 500

const WINDOWS: readonly number[] = [7, 14, 30, 90]

interface AutomationCounts {
  succeeded: number
  failed: number
}

function runsOf(
  firestore: Firestore,
  hostId: string,
  result: 'succeeded' | 'failed',
  startMs: number,
  endMs: number,
): FirebaseFirestore.Query {
  return firestore
    .collection('hosts')
    .doc(hostId)
    .collection('activity')
    .where('result', '==', result)
    .where('createdAt', '>=', new Date(startMs))
    .where('createdAt', '<', new Date(endMs))
}

async function countOf(query: FirebaseFirestore.Query): Promise<number> {
  const snapshot = await query.count().get()
  return Number(snapshot.data().count) || 0
}

/** Runs of one result in the window, by the automation they belong to, read to the ceiling. */
async function byAutomation(
  query: FirebaseFirestore.Query,
): Promise<{ names: Map<string, number>; truncated: boolean }> {
  const snapshot = await query
    .orderBy('createdAt', 'desc')
    .select('target')
    .limit(AUTOMATION_RUN_FIGURES_WINDOW_CEILING + 1)
    .get()
  const names = new Map<string, number>()
  for (const doc of snapshot.docs.slice(0, AUTOMATION_RUN_FIGURES_WINDOW_CEILING)) {
    const target = (doc.get('target') ?? {}) as { name?: unknown; id?: unknown }
    const name =
      (typeof target.name === 'string' && target.name.trim()) || 'An automation with no name'
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  return { names, truncated: snapshot.docs.length > AUTOMATION_RUN_FIGURES_WINDOW_CEILING }
}

const failureRate = (counts: AutomationCounts): number | null => {
  const total = counts.succeeded + counts.failed
  return total > 0 ? Math.round((counts.failed / total) * 1_000) / 10 : null
}

export function automationRunFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'automations.runs',
    label: 'Automation runs',
    description:
      'Runs of the site’s automations — actions, workflows and organization automations — over the window: how many succeeded and failed, the failure rate, and the change in runs from the window before, in total and by automation.',
    scope: 'site',
    windows: WINDOWS,
    read: async (request) => {
      if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its automation runs' }
      if (!WINDOWS.includes(request.days)) {
        return { ok: false, status: 400, error: 'That window is not one automation runs are read over' }
      }
      const db = firestore()
      const hostId = request.hostId
      const { current, previous } = pluginFigureWindows(request.now, request.days)
      const [succeeded, failed, before, okRuns, failedRuns] = await Promise.all([
        countOf(runsOf(db, hostId, 'succeeded', current.startMs, current.endMs)),
        countOf(runsOf(db, hostId, 'failed', current.startMs, current.endMs)),
        Promise.all([
          countOf(runsOf(db, hostId, 'succeeded', previous.startMs, previous.endMs)),
          countOf(runsOf(db, hostId, 'failed', previous.startMs, previous.endMs)),
        ]).then(([a, b]) => a + b),
        byAutomation(runsOf(db, hostId, 'succeeded', current.startMs, current.endMs)),
        byAutomation(runsOf(db, hostId, 'failed', current.startMs, current.endMs)),
      ])
      const automations = new Map<string, AutomationCounts>()
      for (const [name, count] of okRuns.names) {
        automations.set(name, { succeeded: count, failed: automations.get(name)?.failed ?? 0 })
      }
      for (const [name, count] of failedRuns.names) {
        automations.set(name, { succeeded: automations.get(name)?.succeeded ?? 0, failed: count })
      }
      // The most failures first: that is the question a person asks of runs.
      const ranked = [...automations.entries()].sort(
        (a, b) => b[1].failed - a[1].failed || b[1].succeeded - a[1].succeeded || a[0].localeCompare(b[0]),
      )
      const totals = { succeeded, failed }
      return {
        ok: true,
        table: {
          title: 'Automation runs',
          source: { label: 'Automation', path: 'automation' },
          period: { from: current.from, to: current.to, days: request.days },
          columns: [
            { key: 'automation', label: 'Automation', kind: 'text' },
            { key: 'succeeded', label: 'Succeeded', kind: 'count' },
            { key: 'failed', label: 'Failed', kind: 'count' },
            { key: 'failureRate', label: 'Failure rate', kind: 'percent' },
            { key: 'change', label: 'Change in runs', kind: 'change' },
          ],
          rows: [
            {
              automation: 'All automations',
              succeeded,
              failed,
              failureRate: failureRate(totals),
              change: pluginFigureChange(succeeded + failed, before),
            },
            ...ranked.slice(0, PLUGIN_FIGURE_MAX_ROWS - 1).map(([automation, counts]) => ({
              automation,
              succeeded: counts.succeeded,
              failed: counts.failed,
              failureRate: failureRate(counts),
              change: null,
            })),
          ],
          omitted: Math.max(0, ranked.length - (PLUGIN_FIGURE_MAX_ROWS - 1)),
          notes: [
            'A run is counted on the day it ran. A run waiting on a later step counts as succeeded so far.',
            ...(okRuns.truncated || failedRuns.truncated
              ? [
                  `The split by automation counts the most recent ${AUTOMATION_RUN_FIGURES_WINDOW_CEILING.toLocaleString('en-US')} runs of each result; the All automations row counts every run.`,
                ]
              : []),
          ],
        },
      }
    },
  }
}

/** Registers the automation runs reader from the console surface, where insight jobs run. */
export function registerAutomationRunFigureReader(firestore: () => Firestore): void {
  registerPluginFigureReader(automationRunFigureReader(firestore), { pluginId: BUNDLE_ID })
}
