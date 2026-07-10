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
  experiment: Pick<HostExperiment, 'status' | 'variants' | 'winnerVariantId'> & {
    $id?: string
  },
  experimentId: string,
  visitorId: string,
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
