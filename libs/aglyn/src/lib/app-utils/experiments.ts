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
 * A/B experiments (AGL-252): docs at `hosts/{hostId}/experiments/{id}`.
 * Assignment is deterministic — hash(visitorId + experimentId) buckets a
 * visitor into a weighted variant, so the same visitor always sees the
 * same variant with no server state. Exposures/conversions accumulate on
 * per-variant stats counters via the track API. Business tier
 * (`abTesting` flag).
 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'done'

/** What the experiment varies. */
export type ExperimentTarget = 'screen' | 'section' | 'email'

export interface ExperimentVariant {
  id: string
  name?: string
  /** Relative traffic weight; defaults to 1. */
  weight?: number
  /** Screen experiments: the screen version this variant serves. */
  versionId?: string
  /** Email experiments (AGL-255): subject/body overrides. */
  subject?: string
  body?: string
}

export interface HostExperiment {
  name: string
  status: ExperimentStatus
  target: ExperimentTarget
  /** Screen/section experiments: the screen under test. */
  screenId?: string
  /** Section experiments: canvas node id the variants swap. */
  nodeId?: string
  variants: ExperimentVariant[]
  /** Conversion goal: a host/site event, optionally filtered. */
  goal?: { event: string; filter?: string }
  /** Set when finished; the renderer then serves only the winner. */
  winnerVariantId?: string
  /**
   * Epoch millis (AGL-273): past this a running experiment stops serving
   * variants (visitors get the default) until someone declares a winner.
   */
  endAtMs?: number
  /**
   * Opt-in auto-completion (AGL-273): once every variant has
   * `minExposures` and a challenger clears `confidence` (0..1) against
   * the control, the track pipeline promotes it and finishes the
   * experiment. Control wins when every challenger is confidently worse.
   */
  autoWinner?: { minExposures: number; confidence: number }
  /** Set by the pipeline when `autoWinner` decided the experiment. */
  autoCompleted?: boolean
}

export const EXPERIMENT_MAX_VARIANTS = 4

/** FNV-1a over the visitor+experiment key — stable, dependency-free. */
function bucketHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Deterministic weighted assignment: the same visitor always lands in the
 * same variant of an experiment. Finished experiments return the winner;
 * non-running experiments without a winner return null (serve default).
 */
export function assignExperimentVariant(
  experiment: Pick<
    HostExperiment,
    'status' | 'variants' | 'winnerVariantId' | 'endAtMs'
  > & {
    $id?: string
  },
  experimentId: string,
  visitorId: string,
  nowMs: number = Date.now(),
): ExperimentVariant | null {
  const variants = (experiment.variants ?? []).slice(
    0,
    EXPERIMENT_MAX_VARIANTS,
  )
  if (!variants.length) return null
  if (experiment.winnerVariantId) {
    return (
      variants.find((variant) => variant.id === experiment.winnerVariantId) ??
      null
    )
  }
  if (experiment.status !== 'running') return null
  // Past the end date (AGL-273) visitors get the default until a winner
  // is declared — stats stop accruing rather than drifting post-test.
  if (experiment.endAtMs && nowMs > experiment.endAtMs) return null
  const totalWeight = variants.reduce(
    (sum, variant) => sum + Math.max(0, variant.weight ?? 1),
    0,
  )
  if (totalWeight <= 0) return null
  const bucket = bucketHash(`${visitorId}:${experimentId}`) % totalWeight
  let cursor = 0
  for (const variant of variants) {
    cursor += Math.max(0, variant.weight ?? 1)
    if (bucket < cursor) return variant
  }
  return variants[variants.length - 1]
}

/** Validates an experiment doc shape; human-readable error or null. */
export function validateExperiment(
  experiment: HostExperiment,
): string | null {
  if (!experiment.name?.trim()) return 'Name the experiment'
  if (!['screen', 'section', 'email'].includes(experiment.target)) {
    return 'Pick what the experiment tests'
  }
  const variants = experiment.variants ?? []
  if (variants.length < 2) return 'Add at least two variants'
  if (variants.length > EXPERIMENT_MAX_VARIANTS) {
    return `Experiments are capped at ${EXPERIMENT_MAX_VARIANTS} variants`
  }
  const ids = new Set(variants.map((variant) => variant.id))
  if (ids.size !== variants.length) return 'Variant ids must be unique'
  if (experiment.target === 'section' && !experiment.nodeId?.trim()) {
    return 'Section experiments need the canvas element id'
  }
  if (
    (experiment.target === 'screen' || experiment.target === 'section') &&
    !experiment.screenId?.trim()
  ) {
    return 'Pick the screen under test'
  }
  if (experiment.autoWinner) {
    const { minExposures, confidence } = experiment.autoWinner
    if (!Number.isFinite(minExposures) || minExposures < 1) {
      return 'Auto-winner needs a minimum exposure count of at least 1'
    }
    if (!Number.isFinite(confidence) || confidence <= 0.5 || confidence >= 1) {
      return 'Auto-winner confidence must be between 0.5 and 1'
    }
  }
  return null
}

/** Naive conversion-rate summary the results table renders. */
export function summarizeVariantStats(stats: {
  exposures?: number
  conversions?: number
}): { exposures: number; conversions: number; rate: number } {
  const exposures = Math.max(0, stats.exposures ?? 0)
  const conversions = Math.max(0, stats.conversions ?? 0)
  return {
    exposures,
    conversions,
    rate: exposures > 0 ? conversions / exposures : 0,
  }
}

export interface VariantComparison {
  /** Relative conversion-rate lift vs the control; null when unmeasurable. */
  lift: number | null
  /**
   * One-sided confidence (0..1) that the challenger genuinely beats the
   * control — a two-proportion z-test through the normal CDF. Null until
   * both variants have exposures and at least one conversion exists.
   */
  confidence: number | null
}

/** Abramowitz–Stegun erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return sign * y
}

/** Standard normal CDF. */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Compares a challenger variant against the control (AGL-265): lift =
 * relative rate change; confidence = P(challenger > control) from a
 * pooled two-proportion z-test. Small samples return null confidence
 * rather than a misleading number.
 */
export function compareVariants(
  control: { exposures?: number; conversions?: number },
  challenger: { exposures?: number; conversions?: number },
): VariantComparison {
  const a = summarizeVariantStats(control)
  const b = summarizeVariantStats(challenger)
  const lift = a.rate > 0 ? (b.rate - a.rate) / a.rate : null
  if (
    a.exposures < 1 ||
    b.exposures < 1 ||
    a.conversions + b.conversions < 1
  ) {
    return { lift, confidence: null }
  }
  const pooled =
    (a.conversions + b.conversions) / (a.exposures + b.exposures)
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / a.exposures + 1 / b.exposures),
  )
  if (!Number.isFinite(standardError) || standardError === 0) {
    return { lift, confidence: null }
  }
  const z = (b.rate - a.rate) / standardError
  return { lift, confidence: normalCdf(z) }
}

/**
 * Auto-winner evaluation (AGL-273): decides a running experiment from
 * per-variant stats once thresholds are met. The first variant is the
 * control. Undecidable states return null: any arm still under
 * `minExposures`, or no challenger confidently better while some remain
 * in the uncertain middle. Control wins only when every challenger is
 * confidently worse (its win probability is below `1 - confidence`).
 */
export function evaluateAutoWinner(
  experiment: Pick<HostExperiment, 'status' | 'variants' | 'autoWinner'>,
  statsByVariant: Record<
    string,
    { exposures?: number; conversions?: number } | undefined
  >,
): { variantId: string; confidence: number } | null {
  const config = experiment.autoWinner
  if (!config || experiment.status !== 'running') return null
  const variants = (experiment.variants ?? []).slice(
    0,
    EXPERIMENT_MAX_VARIANTS,
  )
  if (variants.length < 2) return null
  const controlStats = statsByVariant[variants[0].id] ?? {}
  if ((controlStats.exposures ?? 0) < config.minExposures) return null
  let best: { variantId: string; confidence: number } | null = null
  let everyLoses = true
  for (const challenger of variants.slice(1)) {
    const challengerStats = statsByVariant[challenger.id] ?? {}
    if ((challengerStats.exposures ?? 0) < config.minExposures) return null
    const { confidence } = compareVariants(controlStats, challengerStats)
    if (confidence === null) return null
    if (
      confidence >= config.confidence &&
      (!best || confidence > best.confidence)
    ) {
      best = { variantId: challenger.id, confidence }
    }
    if (confidence > 1 - config.confidence) everyLoses = false
  }
  if (best) return best
  if (everyLoses) {
    return { variantId: variants[0].id, confidence: config.confidence }
  }
  return null
}
