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

import type { SiteJourneyStepType } from '@aglyn/aglyn/app-utils/site-journey'

/**
 * Funnels (AGL-3605): a site's ordered 2–8 steps, measured over the visits
 * the site recorded (`site-journey.ts` is what a visit is).
 *
 * Three collections under `hosts/{hostId}`, all this plugin's:
 *
 * - `funnels` — the definitions. Members read them; the save and delete
 *   routes write them (the rules deny client writes), because a save also
 *   switches the site's recording on or off and checks the plan.
 * - `funnelJourneys` — one document per recorded visit: its steps in order,
 *   where it arrived from, and an expiry {@link FUNNEL_JOURNEY_RETENTION_DAYS}
 *   after it started. Written only by the site collector; no client reads it.
 * - `funnelResults` — a computed result per funnel and range, kept a short
 *   while so a reload does not read every visit again. Server-only.
 */

export const FUNNELS_COLLECTION = 'funnels'
export const FUNNEL_JOURNEYS_COLLECTION = 'funnelJourneys'
export const FUNNEL_RESULTS_COLLECTION = 'funnelResults'

/**
 * The plan feature funnels follow: the paid analytics tier, the same key
 * per-page traffic is sold under. No key of their own and no price of their
 * own — a funnel is a way of reading the analytics that tier buys.
 */
export const FUNNEL_FEATURE = 'screenAnalytics' as const

export const FUNNEL_MIN_STEPS = 2
export const FUNNEL_MAX_STEPS = 8
/** The most funnels one site keeps. */
export const FUNNELS_MAX_PER_SITE = 20
export const FUNNEL_NAME_MAX = 80
export const FUNNEL_LABEL_MAX = 80

/** How long a recorded visit is kept. Also the widest range a funnel reads. */
export const FUNNEL_JOURNEY_RETENTION_DAYS = 90
export const FUNNEL_MAX_RANGE_DAYS = FUNNEL_JOURNEY_RETENTION_DAYS

/**
 * The most visits one computation reads. Past it the newest visits in the
 * range are measured and the result says it was capped.
 */
export const FUNNEL_JOURNEY_READ_CAP = 20_000

/** How a page step matches a path. */
export type FunnelPageMatch = 'exact' | 'prefix'

export interface FunnelStep {
  type: SiteJourneyStepType
  /**
   * What the step names: a path (`page`), a form, service, product or overlay
   * id, or an event name. Empty means "any" for the types that allow it, and
   * is the only value an `order` step has.
   */
  key: string
  /** `page` steps only: the path exactly, or the path and everything under it. */
  match?: FunnelPageMatch
  /** What the results call the step. The editor fills it from the pick. */
  label?: string
}

export interface FunnelDefinition {
  name: string
  steps: FunnelStep[]
}

export interface StoredFunnel extends FunnelDefinition {
  $id: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
}

/** One recorded step of a visit, as the collector stores it. */
export interface JourneyStepRecord {
  t: SiteJourneyStepType
  k: string
  /** Server time, in ms. */
  at: number
}

/** Where a visit arrived from, as its first beacon reported it. */
export interface JourneySource {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  referrerHost?: string
}

/** A recorded visit, as a computation reads it. */
export interface JourneyForCompute {
  steps: readonly JourneyStepRecord[]
  source?: JourneySource | null
}

/** A step's row in a result. */
export interface FunnelStepResult {
  index: number
  label: string
  /** Visits that reached this step, in order. */
  visitors: number
  /** Of the visits at the previous step, the share that reached this one (0–1). */
  fromPrevious: number | null
  /** Of the visits that entered at step 1, the share that reached this one (0–1). */
  fromStart: number | null
  /** Visits at the previous step that did not reach this one. */
  dropOff: number
  /** Median time from the previous step to this one, in ms. */
  medianMsFromPrevious: number | null
}

export interface FunnelSourceResult {
  source: string
  entered: number
  completed: number
  conversion: number | null
}

export interface FunnelResult {
  funnelId: string
  from: string
  to: string
  steps: FunnelStepResult[]
  entered: number
  completed: number
  /** Completed over entered (0–1), or null when nobody entered. */
  overall: number | null
  sources: FunnelSourceResult[]
  /** Visits read for this result. */
  journeysRead: number
  /** The read stopped at {@link FUNNEL_JOURNEY_READ_CAP}. */
  capped: boolean
  computedAt: number
}
