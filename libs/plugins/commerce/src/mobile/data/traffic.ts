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

import { doc, getDoc } from 'firebase/firestore'
import type { CommerceMobileContext } from './context'
import { nowOf } from './context'

/*
 * The site's visits beside its sales (AGL-3621), so the sales screen can say
 * how many visitors a window had and what share of them bought. Read from
 * the same per-day counters the console's traffic card reads
 * (`hosts/{hostId}/analytics/{YYYY-MM-DD}`, one document per UTC day, which
 * any member of the site may read), one document per day — never a query
 * over the collection.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** UTC day ids, newest first, counting back whole UTC days as the console's card does. */
export function utcDayIds(nowMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, index) => new Date(nowMs - index * DAY_MS).toISOString().slice(0, 10))
}

export interface TrafficWindow {
  /** Page views across the window. */
  views: number
  /** Visitors across the window: each day's unique visitors, summed. */
  visitors: number
  days: Array<{ day: string; views: number; visitors: number }>
}

const count = (value: unknown): number => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

export async function readTraffic(context: CommerceMobileContext, days: number): Promise<TrafficWindow> {
  const ids = utcDayIds(nowOf(context), days).reverse()
  const rows = await Promise.all(
    ids.map(async (day) => {
      const snapshot = await getDoc(doc(context.firestore, 'hosts', context.hostId, 'analytics', day)).catch(() => null)
      const data = snapshot?.data() ?? {}
      return { day, views: count(data['total']), visitors: count(data['visitors']) }
    }),
  )
  return {
    views: rows.reduce((sum, row) => sum + row.views, 0),
    visitors: rows.reduce((sum, row) => sum + row.visitors, 0),
    days: rows,
  }
}

export function trafficQuery(context: CommerceMobileContext, days: number) {
  return {
    queryKey: ['commerce', context.hostId, 'traffic', days] as const,
    queryFn: () => readTraffic(context, days),
    staleTime: 5 * 60_000,
  }
}

/** Orders per hundred visitors, to one decimal; null without visitors. */
export function conversionPct(orders: number, visitors: number): number | null {
  if (!visitors) return null
  return Math.round((orders / visitors) * 1000) / 10
}
