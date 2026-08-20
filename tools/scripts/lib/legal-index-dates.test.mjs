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

// Self-test for the /legal index date re-derivation (AGL-1986).
//
// The index fixture below is the real shape of aglyn.com/legal as served on
// 2026-08-20: nine cards, each a `Last updated` Typography node followed by a
// "Read it" button whose href is the document, and TWO footer links to
// /legal/privacy and /legal/terms after the last card. That footer is trap 3
// and it is in the fixture on purpose — a parser that pairs every legal href
// with a date reports eleven cards against nine documents.
//
// The dates are the real ones: seven documents on August 18, the Cookie
// Policy on August 14, the EULA on August 5. A fixture where every card
// carried the same date could not tell a working comparator from one that
// returns the first date it finds.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  compareIndexDates,
  formatLegalDate,
  formatReport,
  overallExitCode,
  parseDocumentDate,
  parseIndexCards,
  parseLegalDate,
  sameDay,
  slugFromLegalHref,
} from './legal-index-dates.mjs'

/** One card as besigner renders it: title, blurb, date, then the link. */
function card(title, date, slug, { origin = 'https://aglyn.com' } = {}) {
  return `
    <div class="card">
      <h2>${title}</h2>
      <p>Some description of the document.</p>
      <p>Last updated ${date}</p>
      <div><a href="${origin}/legal/${slug}">Read it</a></div>
    </div>`
}

const LIVE_INDEX = `<!doctype html><html><body>
  <nav><a href="/">Home</a></nav>
  <h1>Legal</h1>
  ${card('Terms of Service', 'August 18, 2026', 'terms')}
  ${card('Privacy Policy', 'August 18, 2026', 'privacy')}
  ${card('Cookie Policy', 'August 14, 2026', 'cookies')}
  ${card('Data Processing Addendum', 'August 18, 2026', 'dpa')}
  ${card('Subprocessors', 'August 18, 2026', 'subprocessors')}
  ${card('Acceptable Use Policy', 'August 18, 2026', 'acceptable-use')}
  ${card('End User License Agreement', 'August 5, 2026', 'eula')}
  ${card('Copyright &amp; DMCA Policy', 'August 18, 2026', 'dmca')}
  ${card('Marketplace Publisher Agreement', 'August 18, 2026', 'marketplace-publisher-agreement')}
  <footer><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a></footer>
</body></html>`

/** A legal document page, which writes the line with a colon. */
function documentPage(date) {
  return `<!doctype html><html><body><main>
    <h1>Terms of Service</h1>
    <p>Last updated: ${date}</p>
    <p>Body text.</p>
    <p>© 2026 Aglyn LLC</p>
  </main></body></html>`
}

const LIVE_DATES = {
  terms: 'August 18, 2026',
  privacy: 'August 18, 2026',
  cookies: 'August 14, 2026',
  dpa: 'August 18, 2026',
  subprocessors: 'August 18, 2026',
  'acceptable-use': 'August 18, 2026',
  eula: 'August 5, 2026',
  dmca: 'August 18, 2026',
  'marketplace-publisher-agreement': 'August 18, 2026',
}

function documentsFrom(dates) {
  return new Map(
    Object.entries(dates).map(([slug, date]) => [
      slug,
      parseDocumentDate(documentPage(date)),
    ]),
  )
}

describe('parseLegalDate — trap 1, two spellings of one day', () => {
  it('reads the order the rendered pages use', () => {
    assert.deepEqual(parseLegalDate('August 5, 2026'), {
      year: 2026,
      month: 8,
      day: 5,
    })
  })

  it('reads the order the Drive masters use', () => {
    assert.deepEqual(parseLegalDate('5 August 2026'), {
      year: 2026,
      month: 8,
      day: 5,
    })
  })

  it('treats those two spellings as the SAME day', () => {
    // This is the whole of trap 1: a string compare calls these drift.
    assert.equal(
      sameDay(
        parseLegalDate('August 5, 2026'),
        parseLegalDate('5 August 2026'),
      ),
      true,
    )
  })

  it('tolerates a zero-padded day and an ordinal suffix', () => {
    assert.deepEqual(parseLegalDate('August 05, 2026'), {
      year: 2026,
      month: 8,
      day: 5,
    })
    assert.deepEqual(parseLegalDate('5th August 2026'), {
      year: 2026,
      month: 8,
      day: 5,
    })
  })

  it('tolerates the non-breaking space a CMS emits', () => {
    assert.deepEqual(parseLegalDate('August 5, 2026'), {
      year: 2026,
      month: 8,
      day: 5,
    })
  })

  it('REFUSES a month that is not a month', () => {
    assert.equal(parseLegalDate('Augustus 5, 2026'), null)
  })

  it('REFUSES an impossible day and a junk year', () => {
    assert.equal(parseLegalDate('August 41, 2026'), null)
    assert.equal(parseLegalDate('August 5, 12'), null)
  })

  it('REFUSES prose, rather than half-reading it', () => {
    assert.equal(parseLegalDate('soon'), null)
    assert.equal(parseLegalDate(''), null)
    assert.equal(parseLegalDate(null), null)
  })

  it('never calls two different days equal', () => {
    assert.equal(
      sameDay(
        parseLegalDate('August 5, 2026'),
        parseLegalDate('August 6, 2026'),
      ),
      false,
    )
    assert.equal(
      sameDay(
        parseLegalDate('August 5, 2026'),
        parseLegalDate('September 5, 2026'),
      ),
      false,
    )
    assert.equal(
      sameDay(
        parseLegalDate('August 5, 2026'),
        parseLegalDate('August 5, 2027'),
      ),
      false,
    )
  })

  it('never calls an unparsed date equal to anything, including itself', () => {
    assert.equal(sameDay(null, null), false)
    assert.equal(sameDay(parseLegalDate('August 5, 2026'), null), false)
  })
})

describe('slugFromLegalHref — origin-agnostic, trap 2', () => {
  it('reads an absolute href', () => {
    assert.equal(
      slugFromLegalHref('https://aglyn.com/legal/acceptable-use'),
      'acceptable-use',
    )
  })

  it('reads a relative href, and a self-host origin', () => {
    assert.equal(slugFromLegalHref('/legal/terms'), 'terms')
    assert.equal(
      slugFromLegalHref('https://legal.example.test/legal/dpa'),
      'dpa',
    )
  })

  it('REFUSES the index itself and anything outside /legal', () => {
    assert.equal(slugFromLegalHref('/legal'), null)
    assert.equal(slugFromLegalHref('/pricing'), null)
  })
})

describe('parseIndexCards — the live index shape', () => {
  const { cards, caveats } = parseIndexCards(LIVE_INDEX)

  it('finds NINE cards, not eleven — the footer is not a card (trap 3)', () => {
    assert.equal(cards.length, 9)
    assert.deepEqual(caveats, [])
  })

  it('pairs each date with the document that card links to', () => {
    const byslug = Object.fromEntries(
      cards.map((c) => [c.slug, formatLegalDate(c.date)]),
    )
    assert.equal(byslug.cookies, 'August 14, 2026')
    assert.equal(byslug.eula, 'August 5, 2026')
    assert.equal(byslug.terms, 'August 18, 2026')
  })

  it('does not invent a card for the two footer links', () => {
    // Both slugs appear exactly once — as their card, not again as chrome.
    assert.equal(cards.filter((c) => c.slug === 'privacy').length, 1)
    assert.equal(cards.filter((c) => c.slug === 'terms').length, 1)
  })

  it('ignores dates hiding in the RSC script payload', () => {
    const withPayload = `${LIVE_INDEX}<script>{"children":"Last updated January 1, 1999"}</script>`
    assert.equal(parseIndexCards(withPayload).cards.length, 9)
  })

  it('REPORTS a dangling date instead of pairing it with the next card', () => {
    const orphaned = `<p>Last updated August 18, 2026</p>${LIVE_INDEX}`
    const parsed = parseIndexCards(orphaned)
    // The orphan takes the first card's href, so the LAST card loses its own.
    assert.equal(parsed.caveats.length, 1)
    assert.match(parsed.caveats[0], /links to no legal document/)
  })

  it('finds nothing in markup that has no cards — and says so by finding none', () => {
    assert.deepEqual(
      parseIndexCards('<html><body><h1>Legal</h1></body></html>').cards,
      [],
    )
  })
})

describe('parseDocumentDate — the operative line', () => {
  it('reads the date the document states about itself', () => {
    assert.deepEqual(parseDocumentDate(documentPage('August 14, 2026')).date, {
      year: 2026,
      month: 8,
      day: 14,
    })
  })

  it('returns null when the document states no such line (trap 4)', () => {
    assert.equal(
      parseDocumentDate('<html><body><p>Terms.</p></body></html>').date,
      null,
    )
  })
})

describe('compareIndexDates — the verdict', () => {
  const { cards } = parseIndexCards(LIVE_INDEX)

  it('passes the index as it actually stands today', () => {
    const verdicts = compareIndexDates(cards, documentsFrom(LIVE_DATES))
    assert.equal(verdicts.length, 9)
    assert.deepEqual([...new Set(verdicts.map((v) => v.status))], ['agrees'])
    assert.equal(overallExitCode(verdicts), 0)
  })

  it('CATCHES the failure this check exists for: one document republished, its card forgotten', () => {
    // The AGL-1623 shape, one document at a time. Privacy moves to the 20th;
    // nobody edits the card. Everything else still agrees.
    const drifted = compareIndexDates(
      cards,
      documentsFrom({ ...LIVE_DATES, privacy: 'August 20, 2026' }),
    )
    const privacy = drifted.find((v) => v.slug === 'privacy')
    assert.equal(privacy.status, 'drifted')
    assert.equal(formatLegalDate(privacy.cardDate), 'August 18, 2026')
    assert.equal(formatLegalDate(privacy.documentDate), 'August 20, 2026')
    assert.equal(drifted.filter((v) => v.status === 'drifted').length, 1)
    assert.equal(overallExitCode(drifted), 1)
  })

  it('CATCHES the blanket-line shape: every card asserting one date', () => {
    // AGL-1623 as originally filed — "All last updated 5 August 2026" over
    // nine documents. Two of the nine genuinely are the 5th and the 14th.
    const blanket = parseIndexCards(
      LIVE_INDEX.replace(
        /Last updated August \d{1,2}, 2026/g,
        'Last updated August 5, 2026',
      ),
    )
    const verdicts = compareIndexDates(blanket.cards, documentsFrom(LIVE_DATES))
    assert.equal(verdicts.filter((v) => v.status === 'drifted').length, 8)
    assert.equal(overallExitCode(verdicts), 1)
  })

  it('does NOT report drift between two spellings of the same day', () => {
    const masters = new Map(
      Object.entries(LIVE_DATES).map(([slug, date]) => {
        const [month, day, year] = [
          date.split(' ')[0],
          date.split(' ')[1].replace(',', ''),
          date.split(' ')[2],
        ]
        return [
          slug,
          parseDocumentDate(documentPage(`${day} ${month} ${year}`)),
        ]
      }),
    )
    const verdicts = compareIndexDates(cards, masters)
    assert.deepEqual([...new Set(verdicts.map((v) => v.status))], ['agrees'])
  })

  it('reports cannot-check when a document was never fetched', () => {
    const partial = documentsFrom(LIVE_DATES)
    partial.delete('eula')
    const verdicts = compareIndexDates(cards, partial)
    const eula = verdicts.find((v) => v.slug === 'eula')
    assert.equal(eula.status, 'cannot-check')
    assert.match(eula.detail, /not fetched/)
    assert.equal(overallExitCode(verdicts), 2)
  })

  it('reports cannot-check when the document states no date (trap 4)', () => {
    const documents = documentsFrom(LIVE_DATES)
    documents.set(
      'dpa',
      parseDocumentDate('<html><body><p>No line here.</p></body></html>'),
    )
    const verdicts = compareIndexDates(cards, documents)
    assert.equal(verdicts.find((v) => v.slug === 'dpa').status, 'cannot-check')
    assert.equal(overallExitCode(verdicts), 2)
  })

  it('reports cannot-check when the CARD date is unparseable, rather than passing it', () => {
    const vague = parseIndexCards(
      LIVE_INDEX.replace(
        'Last updated August 14, 2026',
        'Last updated recently',
      ),
    )
    const verdicts = compareIndexDates(vague.cards, documentsFrom(LIVE_DATES))
    const cookies = verdicts.find((v) => v.slug === 'cookies')
    assert.equal(cookies.status, 'cannot-check')
    assert.match(cookies.detail, /unparseable/)
    assert.equal(overallExitCode(verdicts), 2)
  })
})

describe('overallExitCode — trap 2, cannot-check must never read as clean', () => {
  it('fails an EMPTY verdict set rather than calling it drift-free', () => {
    // The parser found nothing. That is exit 2, never 0.
    assert.equal(overallExitCode([]), 2)
    assert.equal(overallExitCode(null), 2)
  })

  it('prefers cannot-check over drift when both are present', () => {
    const mixed = [{ status: 'drifted' }, { status: 'cannot-check' }]
    assert.equal(overallExitCode(mixed), 2)
  })

  it('is 0 only when every row agreed', () => {
    assert.equal(
      overallExitCode([{ status: 'agrees' }, { status: 'agrees' }]),
      0,
    )
  })
})

describe('formatReport', () => {
  const { cards } = parseIndexCards(LIVE_INDEX)

  it('names both dates for a drifted card, so the reader can act on it', () => {
    const verdicts = compareIndexDates(
      cards,
      documentsFrom({ ...LIVE_DATES, privacy: 'August 20, 2026' }),
    )
    const report = formatReport(verdicts)
    assert.match(report, /DRIFTED {2}\/legal\/privacy/)
    assert.match(report, /index card says {2}August 18, 2026/)
    assert.match(report, /the document says August 20, 2026/)
    assert.match(report, /never by editing the document to match/)
  })

  it('says plainly that an empty run is a failure, not a clean bill', () => {
    const report = formatReport([])
    assert.match(report, /FAILURE, not a clean run/)
    assert.doesNotMatch(report, /0 drifted, 0 could not be checked\n$/)
  })

  it('drops the agreeing rows under --summary but keeps the count', () => {
    const verdicts = compareIndexDates(cards, documentsFrom(LIVE_DATES))
    const summary = formatReport(verdicts, { summary: true })
    assert.match(summary, /9 agree/)
    assert.doesNotMatch(summary, /agrees {2}\/legal\/terms/)
  })
})
