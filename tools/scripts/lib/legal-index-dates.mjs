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

// Re-derives every `/legal` index card's date from the document that card
// links to (AGL-1986). Pure functions only — no network — so the self-test
// can pin the shapes that would otherwise produce a wrong answer.
//
// THE PROBLEM THIS EXISTS FOR. AGL-1623 found `aglyn.com/legal` asserting
// "All last updated 5 August 2026" over nine documents that said nine
// different things. That blanket line is gone; each card now carries its own
// `Last updated <date>`. Both the old line and the new ones are HAND-TYPED
// Typography nodes in besigner, so the index restates a date rather than
// reading it, and the next legal publish that forgets a card puts the index
// back into contradiction — slower than before, and harder to notice.
//
// This matters more than a stale label because of what the date DOES. ToS
// §5.3 and Privacy §12 both make the `Last updated` date the MECHANISM by
// which amended terms take effect. Two different dates for one document are
// therefore two different claims about when the current terms began to bind,
// and the contradicting one is on the page a user lands on first.
//
// WHY THIS IS A CHECK AND NOT A RENDER-TIME BINDING. Three candidate sources
// were considered for a genuinely derived date, and two of them are worse
// than the typed string:
//
//   1. `screen.publishedAt` (Firestore, already projected onto `PublicScreen`
//      by apps/tenant/utils/get-all-screens.ts). Stamped by
//      `publishScreenRoute` and cleared on unpublish, so it records WHEN THE
//      ROUTE WENT LIVE, not when the text changed. Every legal page was
//      routed long before its current wording; this date is frozen and wrong.
//   2. `screen.updatedAt`. Moves on a version-pointer republish — but
//      `screenConverter.toFirestore` stamps it on ANY converter-mediated
//      write, so an SEO tweak or a slug edit moves it too. It answers "when
//      did this document row last change" and would silently publish that as
//      the date the terms began to apply.
//   3. The document's own `Last updated:` line. This one is not metadata: it
//      IS the operative text, the thing ToS §5.3 points at.
//
// Sources 1 and 2 would not remove the contradiction, they would add a THIRD
// assertion to it — a machine timestamp disagreeing with the operative line
// on the very page it summarises. So the truth is source 3, and the index
// must agree with it. Legal versions carry no date at all by design; see the
// "WHY THE VERSION IS NOT A DATE" note in apps/console/constants/
// legal-documents.ts, which is why there is no `publishedAt` to add to a
// legal version record instead.
//
// Making the index READ source 3 at render time is a besigner content change
// — a binding from the index screen to a sibling screen's markdown body —
// and legal copy is publication-first: it is authored and published in the
// browser, never hand-written into this repo. What the repo CAN own is the
// re-derivation. This module recomputes what every card should say from the
// documents themselves, so a card that drifts fails a check instead of
// waiting to be noticed. The date stays typed; it stops being remembered.
//
// FOUR TRAPS, each pinned by a test in the sibling .test.mjs:
//
//   1. DATE FORMATS DIFFER ACROSS THE TWO SIDES. Cards render `Last updated
//      August 5, 2026`; documents render `Last updated: August 5, 2026`, and
//      the Drive masters have used `5 August 2026`. Comparing strings reports
//      drift between two spellings of one day. Compare PARSED (y, m, d).
//   2. A PARSE FAILURE MUST NOT READ AS AGREEMENT. An index whose markup
//      changed yields zero cards, and "zero disagreements" is the same
//      verdict as "all nine agree". Zero cards is `cannot-check`, never pass.
//   3. THE FOOTER LINKS TO LEGAL PAGES TOO. `/legal` carries chrome links to
//      /legal/privacy and /legal/terms after the last card. Pairing every
//      legal href with a date would invent two extra cards. A card is a date
//      followed by an href BEFORE THE NEXT DATE, which excludes trailing
//      chrome by construction.
//   4. A DOCUMENT WITH NO `Last updated:` LINE IS NOT A MATCH. If the
//      document side yields nothing, there is nothing to derive from and the
//      card cannot be confirmed — that is `cannot-check` for that row, not a
//      pass and not a drift.

/** The index page whose cards this module checks. */
export const LEGAL_INDEX_PATH = '/legal'

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** Strip `<script>`/`<style>` bodies so RSC payloads cannot be read as text. */
function stripScriptsAndStyles(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
}

/**
 * Parse a legal date into `{ year, month, day }`, or null.
 *
 * Accepts both orders the two sides actually use — `August 5, 2026` on the
 * rendered pages and `5 August 2026` in the Drive masters — because trap 1 is
 * that these are the same day and a string compare says otherwise. Returns a
 * structure rather than a Date so the comparison never touches a timezone.
 */
export function parseLegalDate(text) {
  const raw = String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (!raw) return null

  const monthDayYear =
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(raw)
  const dayMonthYear =
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/.exec(raw)

  let monthName
  let day
  let year
  if (monthDayYear) {
    ;[, monthName, day, year] = monthDayYear
  } else if (dayMonthYear) {
    ;[, day, monthName, year] = dayMonthYear
  } else {
    return null
  }

  const month = MONTHS.indexOf(String(monthName).toLowerCase()) + 1
  if (month === 0) return null
  const dayNumber = Number(day)
  const yearNumber = Number(year)
  if (!(dayNumber >= 1 && dayNumber <= 31)) return null
  if (!(yearNumber >= 2000 && yearNumber <= 2999)) return null
  return { year: yearNumber, month, day: dayNumber }
}

/** Whether two parsed dates are the same day. Nulls are never equal. */
export function sameDay(a, b) {
  if (!a || !b) return false
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** `{ year, month, day }` rendered the way the pages render it. */
export function formatLegalDate(date) {
  if (!date) return '(none)'
  const month = MONTHS[date.month - 1]
  const name = month
    ? month[0].toUpperCase() + month.slice(1)
    : String(date.month)
  return `${name} ${date.day}, ${date.year}`
}

/**
 * The slug a `/legal/<slug>` href points at, absolute or relative, or null.
 *
 * Origin-agnostic on purpose: `LEGAL_ORIGIN` is env-driven for self-host
 * (libs/aglyn/src/lib/app-utils/published-legal-pages.ts), so pinning
 * `https://aglyn.com` here would make the parser find zero cards on any
 * other deployment — trap 2, arriving as a silent pass.
 */
export function slugFromLegalHref(href) {
  const match = /^(?:https?:\/\/[^/]+)?\/legal\/([a-z0-9-]+)\/?$/i.exec(
    String(href ?? '').trim(),
  )
  return match ? match[1].toLowerCase() : null
}

/**
 * Every card on the `/legal` index, as `{ slug, date, raw }`.
 *
 * A card is a `Last updated …` line followed by a link to a legal document
 * BEFORE THE NEXT such line (trap 3). Anything after the final card — the
 * footer's own legal links — has no date in front of it and is dropped.
 *
 * @returns `{ cards, caveats }`. Caveats describe why a card was skipped;
 *   they never suppress one silently.
 */
export function parseIndexCards(html) {
  const body = stripScriptsAndStyles(html)
  const caveats = []

  const marks = []
  for (const match of body.matchAll(/Last updated\s*:?\s*([^<]{0,64})/gi)) {
    marks.push({ at: match.index, kind: 'date', text: match[1] })
  }
  for (const match of body.matchAll(
    /href\s*=\s*"([^"]*\/legal\/[a-z0-9-]+\/?)"/gi,
  )) {
    const slug = slugFromLegalHref(match[1])
    if (slug) marks.push({ at: match.index, kind: 'href', slug })
  }
  marks.sort((a, b) => a.at - b.at)

  const cards = []
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].kind !== 'date') continue
    // The first href before the next date mark. Trap 3 lives in this bound.
    let slug = null
    for (let j = i + 1; j < marks.length && marks[j].kind !== 'date'; j++) {
      if (marks[j].kind === 'href') {
        slug = marks[j].slug
        break
      }
    }
    const raw = String(marks[i].text ?? '').trim()
    if (!slug) {
      caveats.push(
        `a "Last updated ${raw}" line on the index links to no legal document`,
      )
      continue
    }
    cards.push({ slug, date: parseLegalDate(raw), raw })
  }
  return { cards, caveats }
}

/**
 * The `Last updated:` date a legal document states about itself.
 *
 * Anchored on the SAME line the clickwrap capture and
 * tools/scripts/lib/legal-doc-diff.mjs both treat as the start of the content
 * block, so all three agree on which line is operative.
 */
export function parseDocumentDate(html) {
  const body = stripScriptsAndStyles(html)
  const match = /Last updated\s*:?\s*([^<\n]{0,64})/i.exec(body)
  if (!match) return { date: null, raw: null }
  const raw = match[1].trim()
  return { date: parseLegalDate(raw), raw }
}

/**
 * Compare each card against the document it links to.
 *
 * @param cards from {@link parseIndexCards}
 * @param documents `Map<slug, { date, raw }>` — the document's own line, from
 *   {@link parseDocumentDate}. A slug absent from the map was not fetched.
 * @returns `[{ slug, status, cardDate, documentDate, detail }]` where status
 *   is `agrees` | `drifted` | `cannot-check`.
 */
export function compareIndexDates(cards, documents) {
  const map =
    documents instanceof Map
      ? documents
      : new Map(Object.entries(documents ?? {}))
  const verdicts = []
  for (const card of cards ?? []) {
    const document = map.get(card.slug)
    if (!document) {
      verdicts.push({
        slug: card.slug,
        status: 'cannot-check',
        cardDate: card.date,
        documentDate: null,
        detail: 'the linked document was not fetched',
      })
      continue
    }
    if (!card.date) {
      verdicts.push({
        slug: card.slug,
        status: 'cannot-check',
        cardDate: null,
        documentDate: document.date,
        detail: `the card's date is unparseable: "${card.raw}"`,
      })
      continue
    }
    if (!document.date) {
      // Trap 4. Nothing to derive from, so the card is unconfirmed.
      verdicts.push({
        slug: card.slug,
        status: 'cannot-check',
        cardDate: card.date,
        documentDate: null,
        detail: 'the document states no "Last updated:" date',
      })
      continue
    }
    verdicts.push({
      slug: card.slug,
      status: sameDay(card.date, document.date) ? 'agrees' : 'drifted',
      cardDate: card.date,
      documentDate: document.date,
      detail: '',
    })
  }
  return verdicts
}

/**
 * Exit code for a set of verdicts.
 *
 * 1 for drift — a card contradicting its document is the whole point.
 * 2 for `cannot-check` AND for an empty set: trap 2 says an index that
 * yielded no cards must never render as "no drift found".
 */
export function overallExitCode(verdicts) {
  const rows = verdicts ?? []
  if (rows.length === 0) return 2
  if (rows.some((v) => v.status === 'cannot-check')) return 2
  return rows.some((v) => v.status === 'drifted') ? 1 : 0
}

/** Human-readable report. `summary` drops the per-card agreeing rows. */
export function formatReport(verdicts, { summary = false, caveats = [] } = {}) {
  const rows = verdicts ?? []
  const drifted = rows.filter((v) => v.status === 'drifted')
  const blocked = rows.filter((v) => v.status === 'cannot-check')
  const agreed = rows.filter((v) => v.status === 'agrees')
  const lines = []

  lines.push(
    `${rows.length} card(s) on ${LEGAL_INDEX_PATH}: ${agreed.length} agree, ` +
      `${drifted.length} drifted, ${blocked.length} could not be checked`,
  )

  for (const verdict of drifted) {
    lines.push(
      `  DRIFTED  /legal/${verdict.slug}`,
      `      index card says  ${formatLegalDate(verdict.cardDate)}`,
      `      the document says ${formatLegalDate(verdict.documentDate)}`,
    )
  }
  for (const verdict of blocked) {
    lines.push(`  CANNOT CHECK  /legal/${verdict.slug} — ${verdict.detail}`)
  }
  if (!summary) {
    for (const verdict of agreed) {
      lines.push(
        `  agrees  /legal/${verdict.slug}  ${formatLegalDate(verdict.documentDate)}`,
      )
    }
  }
  for (const caveat of caveats ?? []) lines.push(`  NOTE  ${caveat}`)

  if (rows.length === 0) {
    lines.push(
      '',
      'No cards were parsed at all. That is a FAILURE, not a clean run: the index',
      'markup changed shape, or the page did not render. Do not read this as "no',
      'drift" — re-check the parser against the live page before trusting a pass.',
    )
  }
  if (drifted.length > 0) {
    lines.push(
      '',
      'The DOCUMENT is right and the card is wrong. A legal document amends itself',
      'by its own "Last updated" line (ToS §5.3, Privacy §12), so that line is the',
      'operative date and the index only restates it. Fix the card by republishing',
      'the index screen in besigner — never by editing the document to match.',
    )
  }
  return lines.join('\n')
}
