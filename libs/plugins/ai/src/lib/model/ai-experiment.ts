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

import type { PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'

/**
 * A/B tests by AI (AGL-2914): what an `experiment` job proposes, and what it
 * is allowed to say about a result.
 *
 * ## The test is not ours
 *
 * A/B testing is the marketing plugin's: it models the experiment document,
 * buckets visitors, counts exposures and conversions, compares a challenger
 * with the control and decides an auto-winner. None of that is restated here,
 * and none of it is imported — a plugin never imports another plugin. This
 * module is the AI layer over it, and it reaches the test through the two
 * generic seams core already publishes: the figure reader marketing registers
 * for its results, and the job inputs a console surface hands the door.
 *
 * ## Variants are proposed, never written
 *
 * A variant of a screen or a section is a screen VERSION, and a variant of an
 * email is that email's own copy: both belong to editors a person already
 * uses, and the experiment document belongs to marketing. So a variants
 * answer is a proposal, like a theme's or a listing's — words a person puts
 * into the A/B testing card, or does not. Nothing here writes an experiment,
 * starts one, or moves traffic.
 *
 * ## The verdict is code's, and the words are the model's
 *
 * `readAiExperimentResult` decides what a result supports BEFORE a model is
 * asked anything, from the arms' own counts and the confidence marketing
 * published beside them. The model is then asked to explain that verdict, and
 * `checkAiExperimentExplanation` holds it to it: an explanation may name a
 * winner only where the reading found one, and a winner it names anyway is
 * dropped rather than shown. A confident explanation of noise is worse than
 * no explanation, so the one thing the model is never trusted with is whether
 * there is something to explain.
 */

/** What an `experiment` job was asked for. */
export type AiExperimentTask = 'variants' | 'explain'

export const AI_EXPERIMENT_TASKS: readonly AiExperimentTask[] = [
  'variants',
  'explain',
]

/** The task a job's inputs name, or `null` when they name none this step runs. */
export function aiExperimentTask(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiExperimentTask | null {
  const value = inputs?.['task']
  return typeof value === 'string' &&
    (AI_EXPERIMENT_TASKS as readonly string[]).includes(value)
    ? (value as AiExperimentTask)
    : null
}

/**
 * What the experiment varies, in the words the A/B testing card uses. The job
 * carries it as an input because the card that opens the job knows it; it is
 * never read out of marketing's own document.
 */
export type AiExperimentTarget = 'screen' | 'section' | 'email'

export const AI_EXPERIMENT_TARGETS: readonly AiExperimentTarget[] = [
  'screen',
  'section',
  'email',
]

/** The target a job's inputs name, or `null` when they name none. */
export function aiExperimentTarget(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiExperimentTarget | null {
  const value = inputs?.['target']
  return typeof value === 'string' &&
    (AI_EXPERIMENT_TARGETS as readonly string[]).includes(value)
    ? (value as AiExperimentTarget)
    : null
}

/**
 * How many variants a proposal may hold, the cap the A/B testing card stores
 * and the page runner buckets against. Proposing a fifth would be proposing
 * something nothing can save.
 */
export const AI_EXPERIMENT_MAX_VARIANTS = 4

/** The fewest a test can be: a control and one challenger. */
export const AI_EXPERIMENT_MIN_VARIANTS = 2

/** How long a variant's name may run, as the card's own field holds one. */
export const AI_EXPERIMENT_NAME_MAX_CHARS = 60

/** How long one line of a variant's copy may run. */
export const AI_EXPERIMENT_LINE_MAX_CHARS = 200

/** How long a variant's body may run. */
export const AI_EXPERIMENT_BODY_MAX_CHARS = 1_200

/** How long the sentence saying what a variant changes may run. */
export const AI_EXPERIMENT_RATIONALE_MAX_CHARS = 200

/** How much of what is under test is sent. Past this it is a document, not a subject. */
export const AI_EXPERIMENT_SUBJECT_MAX_CHARS = 4_000

/**
 * One variant a proposal holds. `headline` and `body` are a screen's or a
 * section's copy; `subject` and `preheader` are an email's. A variant carries
 * the fields its target has and leaves the rest empty, so what a person pastes
 * into the card is what that card has a place for.
 */
export interface AiExperimentVariantProposal {
  name: string
  headline: string
  body: string
  subject: string
  preheader: string
  /** One sentence: what this variant changes and what it is testing. */
  rationale: string
}

/** A variants answer as the step keeps it. */
export interface AiExperimentVariantsProposal {
  /** What the variants are trying to move, in the person's own terms. */
  goal: string
  variants: AiExperimentVariantProposal[]
}

// ── The result ────────────────────────────────────────────────────────────

/**
 * The reader marketing registers for its A/B test results, and the columns it
 * publishes. Named here rather than imported because the owner is another
 * plugin: a table that does not carry these columns is one this step cannot
 * read, and it says so instead of guessing.
 */
export const AI_EXPERIMENT_FIGURE_READER = 'marketing.experiments'

export const AI_EXPERIMENT_FIGURE_COLUMNS = {
  test: 'test',
  variant: 'variant',
  exposures: 'shown',
  conversions: 'conversions',
  rate: 'rate',
  lift: 'lift',
  confidence: 'confidence',
} as const

/**
 * One arm of a test, as the figures report it. `lift` and `confidence` are the
 * owner's own comparison against the control, as percentages, and are `null`
 * on the control row and wherever the owner could not compare.
 */
export interface AiExperimentArm {
  id: string
  /** The exposures the reader counted: visitors shown this arm. */
  exposures: number
  conversions: number
  /** Conversions over exposures, as a percentage; `null` with no exposures. */
  rate: number | null
  /** Relative change against the control, as a percentage; `null` on the control. */
  lift: number | null
  /** The owner's confidence that this arm beats the control, as a percentage. */
  confidence: number | null
}

/**
 * The exposures each arm needs before a comparison is read at all. Below this
 * a test is early rather than inconclusive, which is a different thing to tell
 * someone: one says wait, the other says stop.
 */
export const AI_EXPERIMENT_MIN_EXPOSURES = 200

/**
 * The successes and failures each arm needs, at the pooled rate, for the
 * normal approximation behind a two-proportion test to be worth reading. The
 * textbook condition, and the reason a test with plenty of traffic and almost
 * no conversions is still too early to call.
 */
export const AI_EXPERIMENT_MIN_EXPECTED = 5

/**
 * The confidence a single comparison is called at: the same 95% the A/B
 * testing card's auto-winner offers, so the explanation and the card agree
 * about what "confident" means when there is one challenger.
 */
export const AI_EXPERIMENT_CONFIDENCE = 0.95

/**
 * The confidence ONE comparison must clear when a test has `challengers` of
 * them (Šidák): testing three challengers at 95% each would call a winner by
 * chance about one time in seven, so the bar rises with the number of chances
 * taken. With one challenger this is exactly `AI_EXPERIMENT_CONFIDENCE`.
 */
export function aiExperimentConfidenceThreshold(challengers: number): number {
  const count = Math.max(1, Math.floor(challengers))
  return AI_EXPERIMENT_CONFIDENCE ** (1 / count)
}

/**
 * What a result supports:
 *
 * - `unreadable` — the figures do not describe a test with a control and a
 *   challenger, so there is nothing to read;
 * - `too-early` — an arm is under the exposure floor, or so little has
 *   converted that the comparison behind the confidence is not worth reading;
 * - `inconclusive` — enough has happened, and no arm is far enough from the
 *   control for the difference to be more than chance;
 * - `winner` — a challenger is ahead by more than chance explains;
 * - `control` — every challenger is behind by more than chance explains.
 */
export type AiExperimentVerdict =
  | 'unreadable'
  | 'too-early'
  | 'inconclusive'
  | 'winner'
  | 'control'

/** The verdicts that name an arm, and so let an explanation name one. */
export const AI_EXPERIMENT_DECIDED_VERDICTS: readonly AiExperimentVerdict[] = [
  'winner',
  'control',
]

/** Whether a verdict lets an explanation name a winner. */
export function aiExperimentVerdictNamesWinner(
  verdict: AiExperimentVerdict,
): boolean {
  return AI_EXPERIMENT_DECIDED_VERDICTS.includes(verdict)
}

export interface AiExperimentReading {
  verdict: AiExperimentVerdict
  /** The test's name as the figures label it. */
  test: string
  /** The control first, then its challengers in the order the figures gave them. */
  arms: AiExperimentArm[]
  /** The arm the verdict names, on `winner` and `control`; `null` otherwise. */
  winnerId: string | null
  /** The confidence one comparison had to clear, as a percentage. */
  threshold: number
  /**
   * Why the verdict is not a winner, in the words the explanation is asked to
   * use; empty where it is one. Never a number — the figures carry those.
   */
  reasons: string[]
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const maybe = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** Whether a table is the A/B test results, by the columns it publishes. */
export function isAiExperimentTable(
  table: Pick<PluginFigureTable, 'columns'> | null | undefined,
): boolean {
  const keys = new Set((table?.columns ?? []).map((column) => column.key))
  return Object.values(AI_EXPERIMENT_FIGURE_COLUMNS).every((key) =>
    keys.has(key),
  )
}

/** The tests a results table holds, by the name it labels each with. */
export function aiExperimentTestNames(
  table: Pick<PluginFigureTable, 'columns' | 'rows'> | null | undefined,
): string[] {
  if (!isAiExperimentTable(table)) return []
  const names: string[] = []
  for (const row of table?.rows ?? []) {
    const name = text(row[AI_EXPERIMENT_FIGURE_COLUMNS.test])
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * One test's arms, in the order the table gave them — the control first, as
 * the reader's own note says it publishes them. An empty list where the table
 * is not the results, or holds no such test.
 */
export function readAiExperimentArms(
  table: Pick<PluginFigureTable, 'columns' | 'rows'> | null | undefined,
  test: string,
): AiExperimentArm[] {
  if (!isAiExperimentTable(table)) return []
  const wanted = test.trim()
  const arms: AiExperimentArm[] = []
  for (const row of table?.rows ?? []) {
    if (text(row[AI_EXPERIMENT_FIGURE_COLUMNS.test]) !== wanted) continue
    const id = text(row[AI_EXPERIMENT_FIGURE_COLUMNS.variant])
    if (!id) continue
    arms.push({
      id,
      exposures: Math.max(0, num(row[AI_EXPERIMENT_FIGURE_COLUMNS.exposures])),
      conversions: Math.max(
        0,
        num(row[AI_EXPERIMENT_FIGURE_COLUMNS.conversions]),
      ),
      rate: maybe(row[AI_EXPERIMENT_FIGURE_COLUMNS.rate]),
      lift: maybe(row[AI_EXPERIMENT_FIGURE_COLUMNS.lift]),
      confidence: maybe(row[AI_EXPERIMENT_FIGURE_COLUMNS.confidence]),
    })
    if (arms.length === AI_EXPERIMENT_MAX_VARIANTS) break
  }
  return arms
}

/** What an arm is told to wait for, in words with no figure in them. */
export const AI_EXPERIMENT_REASON_EXPOSURES =
  'at least one variant has not been shown to enough visitors yet'
export const AI_EXPERIMENT_REASON_CONVERSIONS =
  'too little has converted yet for the comparison to mean anything'
export const AI_EXPERIMENT_REASON_SPREAD =
  'no variant is far enough from the first one for the difference to be more than chance'
export const AI_EXPERIMENT_REASON_UNREADABLE =
  'these figures do not describe a test with a first variant and something to compare against it'

/**
 * What a test's figures support (AGL-2914), decided before a model is asked
 * anything.
 *
 * The first arm is the control, as the results reader publishes it. A verdict
 * is reached in this order, and the first answer wins:
 *
 * 1. fewer than two arms — `unreadable`;
 * 2. an arm under `AI_EXPERIMENT_MIN_EXPOSURES`, or one whose expected
 *    successes or failures at the pooled rate are under
 *    `AI_EXPERIMENT_MIN_EXPECTED` — `too-early`. The second is what stops a
 *    test with a hundred thousand visitors and four conversions reading as a
 *    decided one;
 * 3. a challenger whose confidence clears the multiplicity-corrected
 *    threshold — `winner`, the most confident of them;
 * 4. every challenger below `1 - threshold`, which is the same statement made
 *    about the control — `control`;
 * 5. anything else — `inconclusive`.
 *
 * A challenger the owner could not compare (`confidence` is `null`) can never
 * win, and leaves the control undecided too: not knowing is not evidence.
 */
export function readAiExperimentResult(
  test: string,
  arms: readonly AiExperimentArm[],
): AiExperimentReading {
  const kept = arms.slice(0, AI_EXPERIMENT_MAX_VARIANTS)
  const challengers = Math.max(1, kept.length - 1)
  const threshold = aiExperimentConfidenceThreshold(challengers) * 100
  const reading = (
    verdict: AiExperimentVerdict,
    winnerId: string | null,
    reasons: string[],
  ): AiExperimentReading => ({
    verdict,
    test: test.trim(),
    arms: kept,
    winnerId,
    threshold: Math.round(threshold * 100) / 100,
    reasons,
  })

  if (kept.length < AI_EXPERIMENT_MIN_VARIANTS) {
    return reading('unreadable', null, [AI_EXPERIMENT_REASON_UNREADABLE])
  }
  if (kept.some((arm) => arm.exposures < AI_EXPERIMENT_MIN_EXPOSURES)) {
    return reading('too-early', null, [AI_EXPERIMENT_REASON_EXPOSURES])
  }
  const exposures = kept.reduce((sum, arm) => sum + arm.exposures, 0)
  const conversions = kept.reduce((sum, arm) => sum + arm.conversions, 0)
  const pooled = exposures > 0 ? conversions / exposures : 0
  const approximates = kept.every(
    (arm) =>
      arm.exposures * pooled >= AI_EXPERIMENT_MIN_EXPECTED &&
      arm.exposures * (1 - pooled) >= AI_EXPERIMENT_MIN_EXPECTED,
  )
  if (!approximates) {
    return reading('too-early', null, [AI_EXPERIMENT_REASON_CONVERSIONS])
  }

  const rest = kept.slice(1)
  let best: AiExperimentArm | null = null
  let allBehind = true
  for (const arm of rest) {
    if (arm.confidence === null) {
      allBehind = false
      continue
    }
    if (
      arm.confidence >= threshold &&
      (!best || arm.confidence > (best.confidence ?? 0))
    ) {
      best = arm
    }
    if (arm.confidence > 100 - threshold) allBehind = false
  }
  if (best) return reading('winner', best.id, [])
  if (allBehind) return reading('control', kept[0].id, [])
  return reading('inconclusive', null, [AI_EXPERIMENT_REASON_SPREAD])
}

// ── The explanation ───────────────────────────────────────────────────────

/** How long the sentence stating what happened may run. */
export const AI_EXPERIMENT_HEADLINE_MAX_CHARS = 280

/** How many sentences of detail an explanation may carry. */
export const AI_EXPERIMENT_MAX_POINTS = 4

/** How long one of them may run. */
export const AI_EXPERIMENT_POINT_MAX_CHARS = 280

/** How long the sentence saying what to do next may run. */
export const AI_EXPERIMENT_NEXT_MAX_CHARS = 280

/** An explanation as the model answers it. */
export interface AiExperimentExplanationAnswer {
  headline: string
  points: string[]
  /** The variant the answer says won; empty when it names none. */
  winner: string
  next: string
}

/** An explanation as the step keeps it, after the reading has had its say. */
export interface AiExperimentExplanation {
  verdict: AiExperimentVerdict
  test: string
  headline: string
  points: string[]
  /**
   * The arm the explanation names, which is the arm the READING named: an
   * answer that named another, or named one where the reading named none, has
   * had it removed.
   */
  winnerId: string | null
  next: string
  /** What was dropped from the answer, for the log; never shown to a customer. */
  findings: string[]
}

/**
 * Words an explanation may not use where the reading found no winner. A
 * verdict of `too-early` or `inconclusive` describes an experiment that has
 * not answered, and a sentence like "B is the clear winner" contradicts it
 * however the rest of the paragraph is hedged.
 */
const VERDICT_WORDS =
  /\b(?:winner|winning|won|wins|beat(?:s|en)?|out ?perform(?:s|ed|ing)?|clear(?:ly)? (?:ahead|better|best)|significant(?:ly)?|conclusive(?:ly)?|proven?|declare)\b/i

/**
 * Telling someone to ship one variant is naming a winner whatever words it
 * avoids, so a recommendation is refused on an undecided result too. This is
 * the second belt; the first is that `winnerId` is the reading's and the
 * answer cannot set it.
 */
const RECOMMENDS =
  /\b(?:roll(?:ing)? (?:it |them |this |that )?out|ship(?:ping)?|go with|switch(?:ing)? to|adopt|pick|choose|keep) \b/i

/**
 * What to do next where the result decided nothing. Code's sentence rather
 * than the model's: "what next" is where an explanation that may not name a
 * winner would name one anyway, and the honest answer is the same every time.
 */
export const AI_EXPERIMENT_NEXT_TOO_EARLY =
  'Leave the test running until every variant has been shown to enough visitors to compare.'
export const AI_EXPERIMENT_NEXT_INCONCLUSIVE =
  'These variants are too close to separate. Try a bigger change rather than a longer test.'
export const AI_EXPERIMENT_NEXT_UNREADABLE =
  'Open the test in A/B testing and check it has a first variant and at least one to compare against it.'

/** The next step an undecided verdict carries; empty for a decided one, which the answer writes. */
export function aiExperimentNextStep(verdict: AiExperimentVerdict): string {
  if (verdict === 'too-early') return AI_EXPERIMENT_NEXT_TOO_EARLY
  if (verdict === 'inconclusive') return AI_EXPERIMENT_NEXT_INCONCLUSIVE
  if (verdict === 'unreadable') return AI_EXPERIMENT_NEXT_UNREADABLE
  return ''
}

const CLAIM_UNSUPPORTED = 'claims-a-winner'
const WINNER_UNKNOWN = 'names-an-arm-the-figures-do-not'
const WINNER_UNSUPPORTED = 'names-a-winner-the-reading-did-not'

const trim = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '').trim().slice(0, max)

/**
 * The model's explanation held to the reading (AGL-2914).
 *
 * The reading decided the verdict; this decides what may be said about it.
 * Where the reading found no winner, the named arm is removed and any sentence
 * that claims one is dropped — not softened, dropped, because a hedge in front
 * of a claim still reads as the claim. Where it found one, the answer may only
 * name THAT arm; another is removed as well.
 *
 * An explanation left with no headline is no explanation, and the step fails
 * rather than showing an empty card.
 */
export function checkAiExperimentExplanation(
  answer: AiExperimentExplanationAnswer | null,
  reading: AiExperimentReading,
): AiExperimentExplanation | null {
  if (!answer) return null
  const decided = aiExperimentVerdictNamesWinner(reading.verdict)
  const findings: string[] = []

  const named = trim(answer.winner, AI_EXPERIMENT_NAME_MAX_CHARS)
  let winnerId: string | null = null
  if (named) {
    const arm = reading.arms.find(
      (entry) => entry.id.toLowerCase() === named.toLowerCase(),
    )
    if (!arm) findings.push(`${WINNER_UNKNOWN}:${named}`)
    else if (!decided || arm.id !== reading.winnerId) {
      findings.push(`${WINNER_UNSUPPORTED}:${arm.id}`)
    } else winnerId = arm.id
  }
  // The reading's own answer, never the model's: a decided verdict names its
  // arm even where the answer forgot to.
  if (decided && !winnerId) winnerId = reading.winnerId

  const allowed = (sentence: string): boolean =>
    decided || !(VERDICT_WORDS.test(sentence) || RECOMMENDS.test(sentence))

  const headline = trim(answer.headline, AI_EXPERIMENT_HEADLINE_MAX_CHARS)
  if (!headline || !allowed(headline)) {
    if (headline) findings.push(`${CLAIM_UNSUPPORTED}:headline`)
    // An explanation whose one statement of what happened cannot be shown is
    // no explanation; the step fails rather than showing an empty card.
    return null
  }
  const points: string[] = []
  for (const raw of Array.isArray(answer.points) ? answer.points : []) {
    if (points.length === AI_EXPERIMENT_MAX_POINTS) break
    const point = trim(raw, AI_EXPERIMENT_POINT_MAX_CHARS)
    if (!point) continue
    if (!allowed(point)) {
      findings.push(`${CLAIM_UNSUPPORTED}:point`)
      continue
    }
    points.push(point)
  }
  // On an undecided result the next step is the verdict's own sentence, so the
  // one field that invites a recommendation cannot carry a smuggled winner.
  const answered = trim(answer.next, AI_EXPERIMENT_NEXT_MAX_CHARS)
  const next = decided ? answered : aiExperimentNextStep(reading.verdict)
  if (!decided && answered) findings.push(`${CLAIM_UNSUPPORTED}:next`)
  return {
    verdict: reading.verdict,
    test: reading.test,
    headline,
    points,
    winnerId,
    next,
    findings,
  }
}

// ── The variants ──────────────────────────────────────────────────────────

const MARKUP = /<\/?[a-z][^>]*>/i

const VARIANT_COPY_MISSING = 'variant-has-no-copy'
const VARIANT_MARKUP = 'variant-carries-markup'
const VARIANT_DUPLICATE = 'variant-repeats-another'
const VARIANT_OFF_TARGET = 'variant-fills-another-targets-fields'

/**
 * The fields a target's variant fills. An email varies its subject line, its
 * preheader and its body; a screen or a section varies the copy on it. A
 * variant that fills the other target's fields is answering a different
 * question, and those fields are dropped.
 */
export function aiExperimentVariantFields(
  target: AiExperimentTarget,
): Array<keyof AiExperimentVariantProposal> {
  return target === 'email'
    ? ['subject', 'preheader', 'body']
    : ['headline', 'body']
}

/**
 * A variants answer, held to what the A/B testing card can store (AGL-2914):
 * between two and four variants, each with copy for the target under test,
 * none repeating another's copy, and no markup anywhere — the card's fields
 * are plain text and the besigner writes the elements.
 *
 * Returns the proposal with what could not be kept removed, or `null` when
 * nothing usable is left.
 */
export function checkAiExperimentVariants(
  answer: AiExperimentVariantsProposal | null,
  target: AiExperimentTarget,
): { proposal: AiExperimentVariantsProposal; findings: string[] } | null {
  if (!answer) return null
  const fields = aiExperimentVariantFields(target)
  const others = (
    ['headline', 'body', 'subject', 'preheader'] as Array<
      keyof AiExperimentVariantProposal
    >
  ).filter((field) => !fields.includes(field))
  const findings: string[] = []
  const variants: AiExperimentVariantProposal[] = []
  const seen = new Set<string>()

  for (const raw of Array.isArray(answer.variants) ? answer.variants : []) {
    if (variants.length === AI_EXPERIMENT_MAX_VARIANTS) break
    if (!raw) continue
    const variant: AiExperimentVariantProposal = {
      name: trim(raw.name, AI_EXPERIMENT_NAME_MAX_CHARS),
      headline: '',
      body: '',
      subject: '',
      preheader: '',
      rationale: trim(raw.rationale, AI_EXPERIMENT_RATIONALE_MAX_CHARS),
    }
    if (others.some((field) => typeof raw[field] === 'string' && raw[field].trim())) {
      findings.push(VARIANT_OFF_TARGET)
    }
    for (const field of fields) {
      variant[field] = trim(
        raw[field],
        field === 'body'
          ? AI_EXPERIMENT_BODY_MAX_CHARS
          : AI_EXPERIMENT_LINE_MAX_CHARS,
      )
    }
    const copy = fields.map((field) => variant[field]).filter(Boolean)
    if (!copy.length) {
      findings.push(VARIANT_COPY_MISSING)
      continue
    }
    if (copy.some((value) => MARKUP.test(value))) {
      findings.push(VARIANT_MARKUP)
      continue
    }
    const key = copy.join(' ').toLowerCase()
    if (seen.has(key)) {
      findings.push(VARIANT_DUPLICATE)
      continue
    }
    seen.add(key)
    variants.push({
      ...variant,
      name: variant.name || `Variant ${variants.length + 1}`,
    })
  }
  // One variant is not a test: the card refuses it and so does this.
  if (variants.length < AI_EXPERIMENT_MIN_VARIANTS) return null
  return {
    proposal: {
      goal: trim(answer.goal, AI_EXPERIMENT_RATIONALE_MAX_CHARS),
      variants,
    },
    findings,
  }
}
