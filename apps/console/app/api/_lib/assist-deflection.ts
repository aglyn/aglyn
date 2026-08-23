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
 *   1. **The question stands on its own.** A follow-up is usually not
 *      self-contained: "does that work on the free plan?" retrieves the
 *      billing pages beautifully and answers a question nobody asked. The
 *      conversation is the missing half and only the model has it.
 *
 *      This gate USED TO BE "no prior turn", full stop, and that was wrong in
 *      a way nobody saw until Zach hit it (AGL-2486). Not every follow-up
 *      leans on the transcript: the second question in a thread is very often
 *      a fresh, complete question that happens to be asked second. Refusing
 *      all of them meant a thread answered its first question from the docs
 *      and then escalated forever — and on a deployment with no
 *      `ANTHROPIC_API_KEY` that reads as "Aglyn Assist is not configured",
 *      one question in, to a user who just watched it work. A product that
 *      answers exactly once per thread is worse than one that never answers,
 *      because the second refusal looks like a fault rather than a limit.
 *
 *      So the gate now asks whether THIS question stands alone, and holds a
 *      raised bar when it does — see {@link questionStandsAlone} and the
 *      `FOLLOW_UP_*` constants.
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

/**
 * ── The follow-up bar (AGL-2486) ──────────────────────────────────────────
 *
 * A question asked mid-thread is held to a HIGHER standard than the same
 * question asked first, and the asymmetry is the whole idea rather than
 * timidity about a new path.
 *
 * On turn one, a mediocre match costs a mediocre answer to the question that
 * was actually asked, and the closing line invites the user to ask again.
 * Mid-thread, a mediocre match means something else as well: it is EVIDENCE
 * that the words in front of us are not the whole question. A thread is where
 * ellipsis lives, so "retrieval is unsure" and "the missing half is in the
 * transcript" are the same observation seen twice. Only an emphatic match —
 * one where the page is right whatever came before — may be answered without
 * reading the conversation.
 *
 * The calibration case is Zach's own second question, "how do I add an
 * element to my page": top score 7.9, and the winning page beats its rival by
 * 1.80 with a coming-soon LAUNCH GUIDE, because that guide happens to say
 * "add", "element" and "page". As a first question that is retrieval doing
 * its honest best. As a follow-up it is a coin flip that also ignores the
 * conversation, and it escalates.
 */
const FOLLOW_UP_MIN_TOP_SCORE = 8

/** @see FOLLOW_UP_MIN_TOP_SCORE — 1.3x is a lead; 2x is not arguable. */
const FOLLOW_UP_MIN_PAGE_MARGIN = 2

/**
 * A follow-up must ASK something, not merely name a topic.
 *
 * Mid-thread, a bare fragment — "the free plan?", "on mobile" — is the shape
 * ellipsis takes: the verb it belongs to was in the previous turn, and the
 * fragment is a modifier of a question we cannot see. A first turn cannot be
 * elliptical in that way, which is why this cue is required only when
 * something precedes it.
 *
 * The count of tokens was tried here first and thrown away: it excluded "how
 * do I install a plugin" and "how do I create a site" — two content tokens
 * each, and both complete questions that a user asks second as readily as
 * first. Length is not what separates a question from a fragment; a verb is.
 */
const QUESTION_CUES =
  /\b(how|what|what'?s|where|when|which|who|whose|whom|can|could|do|does|did|is|are|am|was|were|will|would|should|must|may|explain|show|tell|list|need|want)\b/i

/**
 * Words and shapes that make a question depend on what came before it.
 *
 * Deliberately BROAD, and the asymmetry of the costs is why: a false positive
 * here escalates a question that could have been answered from the docs — the
 * behaviour that existed for every follow-up until this change, so the worst
 * case is the status quo. A false negative answers a question nobody asked,
 * with a citation under it, in a thread where the user can see we had the
 * context and ignored it. These patterns are only ever consulted for a turn
 * WITH history; a first question may say "that" as much as it likes.
 */
const CONTEXT_DEPENDENT_PATTERNS: readonly RegExp[] = [
  // Pronouns and demonstratives standing in for a noun in the transcript.
  // "does IT work on mobile", "how do I move THOSE".
  /\b(it|its|it'?s|they|them|their|theirs|he|him|his|she|her|hers)\b/i,
  /\b(that|this|these|those)\b/i,
  // Naming an item of the previous answer by its position in it.
  /\b(the|either|any|another|each)\s+(other|first|second|third|last|next|same|previous|latter|former)\b/i,
  /\b(other|another|either)\s+one\b/i,
  // Opening by attaching to the previous turn rather than starting a question.
  /^\s*(and|but|so|or|then|also|plus|what about|how about|ok(ay)?|yes|no|yeah|nope|thanks?)\b/i,
  // Elliptical follow-ups that carry the previous turn's verb phrase over.
  /\b(why not|instead|as well|again|neither|both)\b/i,
]

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
 * Whether a question can be read WITHOUT the conversation it was asked in.
 *
 * Only consulted for a turn that has history — see
 * {@link CONTEXT_DEPENDENT_PATTERNS} for why the test errs towards "no", and
 * the class docstring for why the gate is no longer simply "did anything
 * precede this".
 *
 * Purely lexical, and that is a real limit worth naming: "how do I do the
 * same for a blog post" is caught by `the same`, while "how do I change the
 * colour" after a paragraph about buttons is not — nothing in those words
 * says which colour. What saves that case is not this function but the raised
 * evidence bar behind it, which such a question does not clear. The two gates
 * are one argument in two halves: this one reads the question, that one reads
 * the retrieval, and a follow-up must pass both.
 */
export function questionStandsAlone(question: string): boolean {
  if (!QUESTION_CUES.test(question)) return false
  for (const pattern of CONTEXT_DEPENDENT_PATTERNS) {
    if (pattern.test(question)) return false
  }
  return true
}

/**
 * Decide whether the retrieved sections answer the question on their own, and
 * compose the answer when they do.
 *
 * `hasHistory` is passed rather than derived because the caller holds the
 * clamped history and this module must not grow an opinion about how history
 * is budgeted. It is not a hard gate any more (AGL-2486): a turn with history
 * must additionally stand on its own words and clear the raised `FOLLOW_UP_*`
 * bar, and escalates when it does not.
 */
export function deflectToDocs(
  question: string,
  scored: readonly ScoredSection[],
  hasHistory: boolean,
): DeflectionVerdict {
  if (hasHistory && !questionStandsAlone(question)) return refuse('follow-up')
  const intent = questionIsAnswerableFromDocs(question)
  if (intent) return refuse(intent)
  if (!scored.length) return refuse('low-score')

  const minTopScore = hasHistory ? FOLLOW_UP_MIN_TOP_SCORE : MIN_TOP_SCORE
  const minPageMargin = hasHistory ? FOLLOW_UP_MIN_PAGE_MARGIN : MIN_PAGE_MARGIN

  const top = scored[0]
  const topScore = top.score
  if (!(topScore >= minTopScore)) return refuse('low-score', topScore)

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
  if (!(pageMargin >= minPageMargin)) return refuse('ambiguous', topScore, pageMargin)

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
  // The relaxed floor is a FIRST-TURN allowance. It exists because coverage
  // and dominance are evidence about the same thing, so an emphatic winner
  // may carry a coverage miss — but mid-thread a coverage miss has a second
  // reading: the part of the question the page ignored may be the part the
  // conversation supplied. Turn one cannot mean that; a follow-up can, so it
  // pays full coverage.
  const coveredEnough =
    coverage >= MIN_COVERAGE ||
    (!hasHistory && coverage >= RELAXED_COVERAGE && pageMargin >= STRONG_PAGE_MARGIN)
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

/** Closest-pages links offered when nothing could be answered outright. */
const MAX_LINKED_SECTIONS = 4

/**
 * The graceful degrade: the closest pages we found, and an honest sentence
 * saying why that is all there is (AGL-2486).
 *
 * ## Why this exists
 *
 * A deployment with no `ANTHROPIC_API_KEY` — which includes every self-hosted
 * one on the day it comes up, and Aglyn's own production today — can answer
 * only what retrieval is confident about. Everything else used to return a
 * bare 501, which the panel printed as "Assist is not configured on this
 * deployment". Zach met that on the SECOND question of a thread whose first
 * question had just been answered in full, and read it as the product being
 * broken. He was not wrong to: a capability refusal arriving after a working
 * answer looks like a fault, not a limit.
 *
 * The self-host charter says every Aglyn-operated dependency must be
 * configurable AND degrade cleanly. "Degrades cleanly" cannot mean "answers
 * one question per thread and then refuses" — a keyless deployment still has
 * the entire documentation corpus and a retrieval index over it, so the floor
 * is the best pages we found, not nothing.
 *
 * ## What it may and may not say
 *
 * The no-fabrication rule applies here exactly as it does to a deflected
 * answer, and is tighter in one respect: these pages did NOT clear the
 * confidence bar, so this text must not claim they answer the question. It
 * says they are the closest, which is true by construction — they are the
 * top of the retrieval ranking — and every word around them is a fixed
 * template plus a real section label and URL.
 *
 * It also must not name an env var. A user who wanted to read `501` would
 * have opened the network tab; the operator-facing detail stays in the API
 * error body, where an operator looks. This is the plain-English half.
 */
export function composeDocsLinksAnswer(
  sections: readonly AssistDocsSection[],
): string {
  const links = sections
    .slice(0, MAX_LINKED_SECTIONS)
    .map((section) => `[${sectionLabel(section)}](${sectionUrl(section)})`)
  if (!links.length) return ''
  return [
    'I could not find one page in the documentation that clearly answers that, and the part of me that talks a question through with you is not switched on for this deployment yet — an administrator has to finish setting it up.',
    'These are the closest pages I found:',
    links.join('\n'),
    'If none of them cover it, asking again in different words often lands somewhere better.',
  ].join('\n\n')
}
