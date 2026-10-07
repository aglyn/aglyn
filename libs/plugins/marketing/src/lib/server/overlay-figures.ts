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
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRow,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { compareOverlayPrecedence, overlayStatus, type HostOverlay } from '../model/overlays'

/**
 * A site's announcement bars and popups as a figure table another plugin
 * reads by id (AGL-3603) — the AI plugin's insights answer "which popup gets
 * clicked?" from it.
 *
 * The figures are the lifetime counters the overlay beacon increments on each
 * overlay (`stats.impressions`, `stats.clicks`, `stats.dismissals`, AGL-271)
 * — the numbers the Overlays list shows — so the table has no window: the
 * counters are totals since each overlay was made, never a period's. One read
 * of the site's overlays, projected to the fields counted and capped. An
 * overlay's copy and its pages never reach the table, only its name.
 */

type Firestore = FirebaseFirestore.Firestore

const MARKETING_PLUGIN_ID = 'marketing'

/** Overlays one table reads; a site with more is told its table is partial. */
export const OVERLAY_FIGURES_READ_LIMIT = 100

const KIND_LABEL: Readonly<Record<HostOverlay['kind'], string>> = {
  bar: 'Announcement bar',
  popup: 'Popup',
}

const STATUS_LABEL: Readonly<Record<ReturnType<typeof overlayStatus>, string>> = {
  off: 'Off',
  scheduled: 'Scheduled',
  live: 'Showing',
}

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

/** One counter over another as a percent to a tenth, or `null` with nothing to divide by. */
const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : null

export function overlayFigureReader(firestore: () => Firestore): PluginFigureReader {
  return {
    id: 'marketing.overlays',
    label: 'Announcement bars and popups',
    description:
      'Each announcement bar and popup on the site: whether it is showing, how many times it was seen, clicked and dismissed, and its click rate. Totals since each one was made, with no window.',
    scope: 'site',
    windows: [],
    feature: 'marketingOverlays',
    read: async (request) => {
      if (!request.hostId) return { ok: false, status: 400, error: 'Open a site to read its overlays' }
      const snapshot = await firestore()
        .collection('hosts')
        .doc(request.hostId)
        .collection('overlays')
        .select('kind', 'name', 'enabled', 'startAtMs', 'endAtMs', 'order', 'stats')
        .limit(OVERLAY_FIGURES_READ_LIMIT + 1)
        .get()
      const nowMs = request.now.getTime()
      const overlays = snapshot.docs
        .slice(0, OVERLAY_FIGURES_READ_LIMIT)
        .map((doc) => ({ overlay: (doc.data() ?? {}) as Partial<HostOverlay> }))
        .filter(({ overlay }) => overlay.kind === 'bar' || overlay.kind === 'popup')
        // The list's own order, so a row reads as the Overlays page lists it.
        .sort((a, b) => compareOverlayPrecedence(a.overlay, b.overlay))
      let views = 0
      let clicks = 0
      let dismissals = 0
      const rows: PluginFigureRow[] = overlays.map(({ overlay }) => {
        const own = {
          views: count(overlay.stats?.impressions),
          clicks: count(overlay.stats?.clicks),
          dismissals: count(overlay.stats?.dismissals),
        }
        views += own.views
        clicks += own.clicks
        dismissals += own.dismissals
        return {
          overlay: String(overlay.name ?? '').trim() || `Untitled ${KIND_LABEL[overlay.kind as HostOverlay['kind']].toLowerCase()}`,
          kind: KIND_LABEL[overlay.kind as HostOverlay['kind']],
          status: STATUS_LABEL[overlayStatus(overlay, nowMs)],
          views: own.views,
          clicks: own.clicks,
          clickRate: rate(own.clicks, own.views),
          dismissals: own.dismissals,
        }
      })
      const kept = rows.slice(0, PLUGIN_FIGURE_MAX_ROWS - 1)
      return {
        ok: true,
        table: {
          title: 'Announcement bars and popups',
          source: { label: 'Overlays', path: 'marketing/overlays' },
          period: null,
          columns: [
            { key: 'overlay', label: 'Overlay', kind: 'text' },
            { key: 'kind', label: 'Kind', kind: 'text' },
            { key: 'status', label: 'Status', kind: 'text' },
            { key: 'views', label: 'Views', kind: 'count' },
            { key: 'clicks', label: 'Clicks', kind: 'count' },
            { key: 'clickRate', label: 'Click rate', kind: 'percent' },
            { key: 'dismissals', label: 'Dismissed', kind: 'count' },
          ],
          rows: [
            {
              overlay: 'All overlays',
              kind: 'All kinds',
              status: 'All statuses',
              views,
              clicks,
              clickRate: rate(clicks, views),
              dismissals,
            },
            ...kept,
          ],
          omitted: Math.max(0, rows.length - kept.length),
          notes: [
            'Totals since each overlay was made, not over a window.',
            ...(snapshot.docs.length > OVERLAY_FIGURES_READ_LIMIT
              ? [`The site has more than ${OVERLAY_FIGURES_READ_LIMIT} overlays; the table counts ${OVERLAY_FIGURES_READ_LIMIT} of them.`]
              : []),
          ],
        },
      }
    },
  }
}

/** Registers the overlays reader from the console surface, where insight jobs run. */
export function registerOverlayFigureReader(firestore: () => Firestore): void {
  registerPluginFigureReader(overlayFigureReader(firestore), { pluginId: MARKETING_PLUGIN_ID })
}
