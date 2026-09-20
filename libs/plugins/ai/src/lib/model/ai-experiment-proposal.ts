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
  AI_EXPERIMENT_MAX_VARIANTS,
  AI_EXPERIMENT_TARGETS,
  aiExperimentNextStep,
  aiExperimentVerdictNamesWinner,
  type AiExperimentArm,
  type AiExperimentTarget,
  type AiExperimentVariantProposal,
  type AiExperimentVerdict,
} from './ai-experiment'

/**
 * An `experiment` job's answer, read back from the output a console surface
 * received, and what a surface is allowed to show of it (AGL-2914).
 *
 * The step decided the verdict from the counts and cut the model's words back
 * to it. That work is undone the moment a card draws the answer with a
 * confident heading, a highlighted arm or a "recommended" badge, because a
 * reader takes the layout for the claim and never reads the sentence that
 * hedges it. So the reading of the verdict happens ONCE more, here, in code a
 * surface cannot skip: {@link aiExperimentVerdictDisplay} says what tone a
 * verdict is drawn in and whether ANY arm may be marked, and an undecided
 * result answers `false` however the proposal was filled in.
 *
 * ## The proposal is not trusted to describe itself
 *
 * An output's `proposal` is a plain record by the time it reaches a browser:
 * it came back over HTTP, out of a document a job wrote. A `winnerId` in it
 * beside a verdict of `inconclusive` is therefore possible — not because the
 * step would write one, but because nothing between here and there is typed.
 * {@link readAiExperimentExplanation} drops it, rather than trusting the
 * field that would have been the model's if the step had not already taken it
 * away.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

const percent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const VERDICTS: readonly AiExperimentVerdict[] = [
  'unreadable',
  'too-early',
  'inconclusive',
  'winner',
  'control',
]

/** An explanation as a console surface reads it back. */
export interface AiExperimentExplanationProposal {
  verdict: AiExperimentVerdict
  test: string
  headline: string
  points: string[]
  /** The arm the FIGURES named, and only ever on a verdict that names one. */
  winnerId: string | null
  next: string
  /** The confidence one comparison had to clear, as a percentage. */
  threshold: number
  arms: AiExperimentArm[]
}

/** A variants answer as a console surface reads it back. */
export interface AiExperimentVariantsProposalView {
  target: AiExperimentTarget
  goal: string
  variants: AiExperimentVariantProposal[]
}

/**
 * How a verdict is drawn.
 *
 * `namesAnArm` is the one a surface must ask before it marks a row, a chip or
 * a heading: on `too-early`, `inconclusive` and `unreadable` there is no arm
 * to mark, and marking the one with the best rate anyway is the claim the
 * step refused to let the model make.
 *
 * `tone` is a MUI severity/color word rather than a color: `success` only
 * where the figures decided something, and the neutral `default` everywhere
 * else — an undecided result drawn in a color that reads as good or as bad
 * says something the figures did not.
 */
export interface AiExperimentVerdictDisplay {
  namesAnArm: boolean
  tone: 'success' | 'default'
  /** The verdict in a reader's words, short enough for a chip. */
  status: string
  /** What the result does not settle, or empty where it settles something. */
  caveat: string
}

const DISPLAY: Record<AiExperimentVerdict, AiExperimentVerdictDisplay> = {
  winner: {
    namesAnArm: true,
    tone: 'success',
    status: 'One variant is ahead',
    caveat: '',
  },
  control: {
    namesAnArm: true,
    tone: 'success',
    status: 'The first variant is ahead',
    caveat: '',
  },
  'too-early': {
    namesAnArm: false,
    tone: 'default',
    status: 'No result yet',
    caveat: 'This test has not answered yet. No variant is ahead of another.',
  },
  inconclusive: {
    namesAnArm: false,
    tone: 'default',
    status: 'No winner',
    caveat:
      'This test did not settle anything. No variant is ahead of another.',
  },
  unreadable: {
    namesAnArm: false,
    tone: 'default',
    status: 'Nothing to read',
    caveat: 'There is nothing here to compare, so nothing is ahead.',
  },
}

/** How a verdict is drawn; an unknown verdict is drawn as the most careful one. */
export function aiExperimentVerdictDisplay(
  verdict: AiExperimentVerdict | string,
): AiExperimentVerdictDisplay {
  return DISPLAY[verdict as AiExperimentVerdict] ?? DISPLAY['unreadable']
}

/**
 * Whether a surface may mark this arm. The verdict decides first, so an arm
 * cannot be marked on a result that named none, whatever `winnerId` holds.
 */
export function aiExperimentArmIsNamed(
  explanation: Pick<AiExperimentExplanationProposal, 'verdict' | 'winnerId'>,
  armId: string,
): boolean {
  return (
    aiExperimentVerdictNamesWinner(explanation.verdict) &&
    explanation.winnerId !== null &&
    explanation.winnerId === armId
  )
}

/** An explanation output's proposal, or `null` when it is not one. */
export function readAiExperimentExplanation(
  value: unknown,
): AiExperimentExplanationProposal | null {
  if (!isRecord(value) || value['task'] !== 'explain') return null
  const verdict = VERDICTS.includes(value['verdict'] as AiExperimentVerdict)
    ? (value['verdict'] as AiExperimentVerdict)
    : null
  const headline = text(value['headline'])
  if (!verdict || !headline) return null
  const arms = (Array.isArray(value['arms']) ? value['arms'] : [])
    .filter(isRecord)
    .map((arm): AiExperimentArm => ({
      id: text(arm['id']),
      exposures: count(arm['exposures']),
      conversions: count(arm['conversions']),
      rate: percent(arm['rate']),
      lift: percent(arm['lift']),
      confidence: percent(arm['confidence']),
    }))
    .filter((arm) => arm.id)
    .slice(0, AI_EXPERIMENT_MAX_VARIANTS)
  const named = text(value['winnerId'])
  // The verdict decides whether there is an arm to name, and the arm must be
  // one the figures carry. A name that passes neither test is dropped rather
  // than shown beside a result that does not support it.
  const winnerId =
    aiExperimentVerdictNamesWinner(verdict) &&
    named &&
    arms.some((arm) => arm.id === named)
      ? named
      : null
  const answered = text(value['next'])
  return {
    verdict,
    test: text(value['test']),
    headline,
    points: (Array.isArray(value['points']) ? value['points'] : [])
      .map(text)
      .filter(Boolean),
    winnerId,
    // Undecided, the next step is the verdict's own sentence — the same one
    // the step substituted — so a surface reading an older document still
    // shows code's answer rather than whatever was stored beside it.
    next: aiExperimentVerdictNamesWinner(verdict)
      ? answered
      : aiExperimentNextStep(verdict),
    threshold: percent(value['threshold']) ?? 0,
    arms,
  }
}

/** A variants output's proposal, or `null` when it is not one. */
export function readAiExperimentVariants(
  value: unknown,
): AiExperimentVariantsProposalView | null {
  if (!isRecord(value) || value['task'] !== 'variants') return null
  const target = (AI_EXPERIMENT_TARGETS as readonly string[]).includes(
    String(value['target']),
  )
    ? (value['target'] as AiExperimentTarget)
    : null
  if (!target) return null
  const variants = (Array.isArray(value['variants']) ? value['variants'] : [])
    .filter(isRecord)
    .map((variant): AiExperimentVariantProposal => ({
      name: text(variant['name']),
      headline: text(variant['headline']),
      body: text(variant['body']),
      subject: text(variant['subject']),
      preheader: text(variant['preheader']),
      rationale: text(variant['rationale']),
    }))
    .filter((variant) => variant.headline || variant.body || variant.subject)
    .slice(0, AI_EXPERIMENT_MAX_VARIANTS)
  if (!variants.length) return null
  return { target, goal: text(value['goal']), variants }
}
