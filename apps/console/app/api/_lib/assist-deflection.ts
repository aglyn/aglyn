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

import type { AssistDocsSection } from '../../../constants/assist-docs-index.generated'
import {
  DOCS_SITE_ORIGIN,
  docsDocumentFrequency,
  tokenize,
  type ScoredSection,
} from './assist-retrieval'

/**
 * Retrieval-first answering for Aglyn Assist (AGL-2486) — the deflection gate.
 *
 * Most assist traffic is "how do I X", and the answer to "how do I X" is
 * already written down in `apps/docs/docs`. Sending that question to a model
 * so the model can read the docs section back to the user pays provider money
 * to reformat prose we wrote ourselves. This module decides when retrieval is
 * confident enough to hand the docs straight over, and composes the answer
 * when it is. Escalation to the model is what happens the rest of the time —
 * it is the fallback, not the default.
 *
 * ## The one rule: never fabricate
 *
 * A deflected answer contains exactly two kinds of text:
 *
 *   1. Fixed template strings from this file, which say nothing about the
 *      product — they name the page and introduce the quote.
 *   2. Section text copied VERBATIM out of the docs index, with the URL of
 *      the page it came from.
 *
 * There is no summarisation, no paraphrase and no stitching of adjacent
 * sections into a claim neither one makes. The spec asserts it by
 * RECONSTRUCTION — "never fabricate — every word is template or verbatim
 * docs" — stripping the template from a composed answer and requiring what is
 * left to be a prefix of a real section's `text`. That property is the whole
 * safety argument, because a wrong retrieval answer is worse than an
 * escalation — it is confidently wrong prose delivered to a paying customer
 * with a citation under it, which is the shape people trust most.
 *
 * ## What "confident" means
 *
 * Seven conditions, ALL of which must hold. Any one failing escalates; there
 * is no partial-credit path where a weak match produces a hedged answer,
 * because a hedged wrong answer is still a wrong answer and it has already
 * cost the user the click.
 *
 *   1. **No prior turn.** A follow-up is not self-contained: "does that work
 *      on the free plan?" retrieves the billing pages beautifully and answers
 *      a question nobody asked. The conversation is the missing half and only
 *      the model has it. This is the single biggest restriction here and it is
 *      deliberate — see the hit-rate note below.
 *   2. **Enough question.** At least {@link MIN_QUESTION_TOKENS} distinct
 *      content tokens after stop-word removal. Below that there is not enough
 *      of a question to be confident ABOUT.
 *   3. **Not a generative request.** "write me a hero headline" is the copy
 *      assistant's job, not a docs lookup, and no docs page answers it.
 *   4. **Not a diagnostic.** "why isn't my domain verifying" has a
 *      troubleshooting page, and dumping that page at someone whose actual
 *      problem is one of nine listed causes is exactly the confidently-wrong
 *      failure. Diagnostics need the workspace's own state, which is the
 *      level-2 context only the model gets.
 *   5. **Absolute score.** The top section scores at least
 *      {@link MIN_TOP_SCORE}.
 *   6. **Page dominance.** The winning page beats the best RIVAL page by at
 *      least {@link MIN_PAGE_MARGIN}. Measured against the runner-up page
 *      rather than as a share of the whole retrieved set, because the set is
 *      six sections wide: a page that is unambiguously right still holds a
 *      minority of a six-way split the moment three neighbouring pages use the
 *      same nouns, and a share test reads that dilution as doubt. And the
 *      comparison is page-to-page, not section-to-section — sections of ONE
 *      page scoring alike is agreement, which a section margin scores as a tie.
 *   7. **Substance.** The winning section carries at least
 *      {@link MIN_SECTION_CHARS} of text. A three-word stub under a heading is
 *      a pointer, not an answer.
 *
 * Below the bar the request proceeds exactly as it did before this module
 * existed: the same sections are still retrieved and still ground the model's
 * prompt. Deflection removes model calls; it never removes grounding.
 *
 * ## The thresholds are measured, not guessed
 *
 * `assist-deflection.spec.ts` carries a fixed set of realistic questions —
 * positives written in user vocabulary rather than lifted from docs headings,
 * and negatives that MUST escalate — and asserts a floor on the deflection
 * rate and a ceiling of zero on the negatives. Retuning a constant here
 * without rerunning that spec is how a threshold ends up set by whoever
 * touched it last.
 */

/**
 * Distinct content tokens a question needs before it can be answered.
 *
 * Two, not three, and the difference is most of the corpus: "how do I install
 * a plugin", "what are dataset relations" and "how do I cancel my
 * subscription" all reduce to exactly two content tokens once the stop words
 * go, and every one of them is a plain docs lookup. Three excluded them all.
 *
 * Two is safe here only because the gates below are not a checklist a weak
 * question can pass by being short: a two-token question must have BOTH
 * tokens carried by the winning page (the IDF weighting cannot rescue it —
 * there is nothing generic to discount), and the page must still clear the
 * score floor and out-score its rival. "is my site down" has two tokens and
 * fails on dominance, not on length.
 */
const MIN_QUESTION_TOKENS = 2

/**
 * Absolute floor on the winning section's retrieval score.
 *
 * The scorer gives 2.5 for a title hit, 2 for a heading hit and up to ~2.2 per
 * body term — about 6.7 for one term landing everywhere at once. 5 is
 * therefore roughly "two question terms landed and at least one of them hit
 * the page's own statement of topic". Below that the match is incidental
 * vocabulary rather than a page about the thing.
 *
 * Measured down from 6, which cost five ordinary lookups scoring 4.4–5.9
 * ("how do I cancel my subscription", "how do I set up sso for my team") and
 * bought nothing: the negative set does not move between the two values,
 * because what actually stops those is coverage and dominance, not the floor.
 */
const MIN_TOP_SCORE = 5

/**
 * How far the winning page must out-score the best rival page.
 *
 * 1.3x — the winner needs a visible lead, not a photo finish. Two pages
 * within 30% of each other on the same question means retrieval genuinely
 * does not know which one the user meant, and picking is a coin flip dressed
 * up as an answer.
 *
 * A question that retrieves only ONE page has no rival and passes this gate
 * outright; the score floor and coverage are what bound it there.
 */
const MIN_PAGE_MARGIN = 1.3

/**
 * Weighted fraction of the question the winning page must actually contain.
 * Coverage and score answer different questions: score says the page matched
 * strongly, coverage says the page did not IGNORE part of what was asked.
 * "how do I password protect a screen on the free plan" scores highly on the
 * site-protection page while silently dropping "free plan", and the answer
 * that comes back is then wrong in the one way that matters.
 *
 * ⚠️ WEIGHTED BY IDF, and an unweighted version of this test is why nine
 * perfectly ordinary questions escalated in the first measurement. "how do I
 * make a reusable component" covers `reusable` and `component` and misses
 * `make`, because the page says "create" — 2/3, under the bar, escalated. The
 * miss carried no information: `make` appears in a third of the corpus, so
 * its absence from one page says nothing, while `reusable` appearing says
 * almost everything. Counting tokens equally lets the most common words in
 * English veto a match on the rarest. Weighting by how rare a term is in THIS
 * corpus makes the test ask what it always meant to ask — did the page cover
 * the DISTINCTIVE part of the question.
 */
const MIN_COVERAGE = 0.7

/**
 * The relaxed coverage floor, reachable ONLY by a page that has also won
 * overwhelmingly ({@link STRONG_PAGE_MARGIN}).
 *
 * Coverage and dominance are evidence about the same thing from opposite
 * directions, and holding both as independent hard floors throws away the
 * cases where one is emphatic. "what are webhooks used for in workflows"
 * covers 0.69 — a hair under the bar — while out-scoring every rival page by
 * FORTY times. There is no reading of that evidence in which the webhooks
 * page is the wrong page, and escalating it pays a provider to agree.
 *
 * The floor still binds: "what is the difference between screens and layouts"
 * also wins by ~48x and still escalates at 0.39, because a comparison
 * question is not answered by either page on its own however clearly one of
 * them wins. That is the case this pair of numbers is calibrated to keep out.
 */
const RELAXED_COVERAGE = 0.6

/** The margin that buys {@link RELAXED_COVERAGE}. */
const STRONG_PAGE_MARGIN = 3

/** Minimum characters of section text before a section counts as an answer. */
const MIN_SECTION_CHARS = 200

/** Sections of the winning page quoted verbatim, at most. */
const MAX_QUOTED_SECTIONS = 2

/** Total verbatim characters in one deflected answer. */
const MAX_ANSWER_CHARS = 2600

/**
 * A request is generative when it asks for something to be WRITTEN, not
 * explained. Anchored to the start of a word and paired with the objects
 * people actually name, because "how do I create a redirect" is a docs
 * question and "create a headline for my hero" is not.
 */
const GENERATIVE_PATTERNS: readonly RegExp[] = [
  /\b(write|draft|compose|generate|rewrite|reword|rephrase|summari[sz]e|translate|brainstorm|suggest)\b/i,
  /\b(make|build|create|give)\s+(me|us)\b/i,
  /\b(come up with|help me write)\b/i,
]

/**
 * A request is diagnostic when it describes something not working. These have
 * docs pages and must still escalate: the page lists every cause, and the
 * user has exactly one of them. Only the model, with the level-2 view context,
 * can narrow it — and when it cannot, saying so is better than quoting nine
 * causes at someone.
 */
const DIAGNOSTIC_PATTERNS: readonly RegExp[] = [
  /\bwhy\s+(is|are|isn'?t|aren'?t|does|doesn'?t|did|didn'?t|won'?t|can'?t|cannot|do)\b/i,
  /\b(not working|isn'?t working|doesn'?t work|stopped working|no longer works)\b/i,
  /\b(was|were|is|are|never)\s+not\s+\w+ed\b/i,
  /\b(broken|failing|failed|stuck|blank|missing|502|404|500)\b/i,
  /\b(troubleshoot|debug|diagnose)\b/i,
  // "error" needs a verb of appearance in front of it, within a clause.
  // Bare `\berrors?\b` reads "how do I customise the error screens" as a
  // support ticket — the docs page for error screens is titled with the word,
  // so the one question the pattern must not catch is the one it caught.
  /\b(getting|got|see|seeing|shows?|showing|throws?|returns?|says?|hit)\b[^.?!]{0,40}\berrors?\b/i,
]

/** Why a question was not answered from the docs. `null` reason = answered. */
export type DeflectionRefusal =
  | 'follow-up'
  | 'too-short'
  | 'generative'
  | 'diagnostic'
  | 'low-score'
  | 'ambiguous'
  | 'low-coverage'
  | 'thin-section'

export interface DeflectionVerdict {
  /** True when the docs answer this without a model call. */
  answered: boolean
  /** Set when `answered` is false — which gate refused. */
  refusal: DeflectionRefusal | null
  /** The composed answer; `''` unless `answered`. */
  answer: string
  /** Sections quoted in the answer; `[]` unless `answered`. */
  quoted: readonly AssistDocsSection[]
  /** The winning page's path; `''` when nothing won. */
  page: string
  /** Top section's retrieval score. 0 when nothing was retrieved. */
  topScore: number
  /** Winning page's score over the best rival page's. 0 when unscored. */
  pageMargin: number
  /** IDF-weighted share of the question the winning page carries. */
  coverage: number
}

function refuse(
  refusal: DeflectionRefusal,
  topScore = 0,
  pageMargin = 0,
  coverage = 0,
): DeflectionVerdict {
  return {
    answered: false,
    refusal,
    answer: '',
    quoted: [],
    page: '',
    topScore,
    pageMargin,
    coverage,
  }
}

/**
 * Inverse document frequency for one token, over the docs corpus.
 *
 * Smoothed (`+1` inside the log's argument and on the denominator) so a token
 * absent from the index — a product name we have not documented, a typo —
 * gets a large but finite weight rather than a division by zero or an
 * infinity that would swallow every other term in the question.
 */
function tokenWeight(token: string): number {
  const { frequency, sections } = docsDocumentFrequency()
  const seen = frequency.get(token) ?? 0
  return Math.log(1 + sections / (1 + seen))
}

/** The docs-site URL for one section. */
export function sectionUrl(section: AssistDocsSection): string {
  return `${DOCS_SITE_ORIGIN}${section.path}${section.anchor}`
}

/** `Title — Heading`, or just the title on a page intro. */
export function sectionLabel(section: AssistDocsSection): string {
  return section.heading ? `${section.title} — ${section.heading}` : section.title
}

/**
 * Trim verbatim text to `limit` characters on a sentence boundary, so a quote
 * never ends mid-clause. Returns the text unchanged when it already fits.
 *
 * A truncated quote is still verbatim — it is a PREFIX of the section, which
 * is what the spec's substring check asserts. Cutting on a boundary matters
 * for a different reason: a sentence stopped halfway reads as a broken
 * feature, and the user cannot tell whether the missing half contradicted the
 * visible one.
 */
export function trimToSentence(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  const window = trimmed.slice(0, limit)
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  )
  // A boundary in the first third would throw most of the quote away; better
  // a hard cut with an ellipsis than an answer reduced to one sentence.
  if (lastStop > limit / 3) return window.slice(0, lastStop + 1)
  return `${window.trimEnd()}…`
}

/** Question intent, ahead of any retrieval work. */
export function questionIsAnswerableFromDocs(question: string): DeflectionRefusal | null {
  const tokens = new Set(tokenize(question))
  if (tokens.size < MIN_QUESTION_TOKENS) return 'too-short'
  for (const pattern of GENERATIVE_PATTERNS) {
    if (pattern.test(question)) return 'generative'
  }
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    if (pattern.test(question)) return 'diagnostic'
  }
  return null
}

/**
 * Decide whether the retrieved sections answer the question on their own, and
 * compose the answer when they do.
 *
 * `hasHistory` is passed rather than derived because the caller holds the
 * clamped history and this module must not grow an opinion about how history
 * is budgeted. It is a hard gate: a conversation in progress always escalates.
 */
export function deflectToDocs(
  question: string,
  scored: readonly ScoredSection[],
  hasHistory: boolean,
): DeflectionVerdict {
  if (hasHistory) return refuse('follow-up')
  const intent = questionIsAnswerableFromDocs(question)
  if (intent) return refuse(intent)
  if (!scored.length) return refuse('low-score')

  const top = scored[0]
  const topScore = top.score
  if (!(topScore >= MIN_TOP_SCORE)) return refuse('low-score', topScore)

  // Score by PAGE. Sections of one page agreeing is the signal; treating them
  // as rivals is how a strong, unambiguous match reads as a tie.
  const perPage = new Map<string, number>()
  for (const entry of scored) {
    perPage.set(entry.section.path, (perPage.get(entry.section.path) ?? 0) + entry.score)
  }
  // The winning page is the highest-scoring PAGE, not the home of the
  // highest-scoring section — three mid-scoring sections of one page can beat
  // one strong section elsewhere, and when they do, that page is the answer.
  let winner = ''
  let winnerScore = 0
  let rivalScore = 0
  for (const [path, score] of perPage) {
    if (score > winnerScore) {
      rivalScore = winnerScore
      winner = path
      winnerScore = score
    } else if (score > rivalScore) {
      rivalScore = score
    }
  }
  // No rival is not a tie — it is the cleanest possible result, one page and
  // nothing else. `Infinity` would be honest but propagates badly through the
  // telemetry, so a lone winner reports its own score as the margin.
  const pageMargin = rivalScore > 0 ? winnerScore / rivalScore : winnerScore
  if (!(pageMargin >= MIN_PAGE_MARGIN)) return refuse('ambiguous', topScore, pageMargin)

  const pageSections = scored.filter((entry) => entry.section.path === winner)
  const pageTokens = new Set<string>()
  for (const entry of pageSections) {
    for (const token of tokenize(entry.section.title)) pageTokens.add(token)
    for (const token of tokenize(entry.section.heading)) pageTokens.add(token)
    for (const token of tokenize(entry.section.text)) pageTokens.add(token)
  }
  const questionTokens = [...new Set(tokenize(question))]
  let wanted = 0
  let covered = 0
  for (const token of questionTokens) {
    const weight = tokenWeight(token)
    wanted += weight
    if (pageTokens.has(token)) covered += weight
  }
  const coverage = wanted > 0 ? covered / wanted : 0
  const coveredEnough =
    coverage >= MIN_COVERAGE ||
    (coverage >= RELAXED_COVERAGE && pageMargin >= STRONG_PAGE_MARGIN)
  if (!coveredEnough) {
    return refuse('low-coverage', topScore, pageMargin, coverage)
  }

  const usable = pageSections.filter(
    (entry) => entry.section.text.trim().length >= MIN_SECTION_CHARS,
  )
  if (!usable.length) return refuse('thin-section', topScore, pageMargin, coverage)

  const quoted = usable.slice(0, MAX_QUOTED_SECTIONS).map((entry) => entry.section)
  return {
    answered: true,
    refusal: null,
    answer: composeDocsAnswer(quoted),
    quoted,
    page: winner,
    topScore,
    pageMargin,
    coverage,
  }
}

/**
 * The deflected answer: template + verbatim docs + real links, and nothing
 * else. Kept exported so the spec can assert the reconstruction property
 * against it directly rather than through the route.
 *
 * ⚠️ COMPOSED FOR A SURFACE THAT DOES NOT RENDER MARKDOWN. The Assist panel
 * says so in its own docstring — `renderAssistText` turns `[label](url)` and
 * bare URLs into links and renders everything else literally, under
 * `whiteSpace: 'pre-wrap'`. That is a deliberate phase-1 decision, not a gap.
 *
 * This template shipped once with the heading wrapped in `**…**`, and Zach's
 * besigner drawer duly showed `**Drag-and-drop hierarchy — Moving an element
 * without dragging**`, asterisks and all. The lesson is not "escape the
 * asterisks" — it is that the composer has to know what renders it.
 *
 * So the heading is a bare `[label](url)` on its own line — a LINK, which is
 * the one markup the panel speaks, and which is why the title in Zach's
 * screenshot was correctly clickable even while the asterisks around it were
 * not. Everything else is carried by NEWLINES, which `pre-wrap` renders,
 * rather than by markup, which it does not.
 *
 * The link has to live in the TEXT, and that is still true now that the
 * `docs` array on the `done` event IS rendered (AGL-2486, `AssistSources`).
 * It was tempting to treat that array as the structural home for the citation
 * even when nothing rendered it; it is still the wrong home, for a different
 * reason. `docs` carries every section RETRIEVED, whereas this template
 * quotes only the sections it actually used — so the array is a superset, and
 * a citation moved there would credit pages this answer never drew a word
 * from. `AssistSources` drops any url already linked in the text, which means
 * a deflected answer renders exactly as it does below and gains no duplicate
 * list underneath.
 *
 * Three specs in `assist-deflection.spec.ts` hold the line — no emphasis
 * markers, no heading markers, and a link still present.
 *
 * The closing line is not decoration. A user who reads this and finds it did
 * not answer them needs to know that asking again in different words reaches
 * something else — otherwise the cheap path looks like the assistant simply
 * being worse, and the next thing they do is stop using it.
 */
export function composeDocsAnswer(sections: readonly AssistDocsSection[]): string {
  const parts: string[] = []
  let budget = MAX_ANSWER_CHARS
  for (const section of sections) {
    if (budget <= MIN_SECTION_CHARS) break
    const quote = trimToSentence(section.text, budget)
    budget -= quote.length
    parts.push(`[${sectionLabel(section)}](${sectionUrl(section)})\n${quote}`)
  }
  parts.push(
    'That is straight from the documentation — the headings above link to the full page. If it did not cover what you meant, ask again with more detail and I will work through it with you.',
  )
  return parts.join('\n\n')
}
