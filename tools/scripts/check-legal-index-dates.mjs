#!/usr/bin/env node
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

// Re-derives every `/legal` index card's date from the document it links to
// (AGL-1986).
//
//   npm run check:legal-index-dates
//   npm run check:legal-index-dates -- --summary
//   npm run check:legal-index-dates -- --origin=https://staging.example.test
//
// Nothing here writes. It fetches the index and the documents it links to,
// and compares them. The comparison itself is in lib/legal-index-dates.mjs,
// which is pure and self-tested.
//
// WHY THIS EXISTS. The nine index cards are hand-typed Typography nodes in
// besigner. They restate a date that the document below them also states, and
// ToS §5.3 / Privacy §12 make that date the mechanism by which amended terms
// take effect — so a card that drifts is a second, contradictory claim about
// when the current terms began to bind. Deriving the card at render time is a
// besigner content change (legal copy is publication-first and is never
// hand-written into this repo); what the repo owns is this re-derivation, so
// drift fails a check instead of waiting to be noticed. The long form of that
// reasoning, including why `screen.publishedAt` and `screen.updatedAt` are
// the WRONG sources, is in the module header of the lib.
//
// NO CREDENTIAL. Unlike check:legal-drift — which needs a Drive service
// account and a repo variable, and which spent its first day inert waiting
// for one (AGL-2379) — this reads two public pages. It can run unattended on
// every schedule, which is the point: the failure it catches is somebody
// forgetting, so it must not itself depend on somebody remembering.
//
// ⚠️ ISR AND WHAT A STALE READ CAN AND CANNOT DO HERE. Both sides are served
// through the tenant's ISR cache. A stale read of BOTH pages from the same
// publish generation still compares correctly — this check asks whether the
// index AGREES WITH the document, not whether either is the newest text. The
// asymmetric case (index fresh, document stale) can manufacture a FALSE
// DRIFT, which is noisy but safe. It cannot manufacture a false pass: for
// that, a stale card would have to coincidentally match a stale document that
// has since changed, and both dates would then be equally stale and equally
// wrong on the live site too — which is a real defect, correctly reported.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  every card agrees with the document it links to
//   1  at least one card contradicts its document
//   2  the comparison could not be made (a fetch failed, the index yielded no
//      cards, or a document states no date). Zero cards is exit 2 on purpose.

import {
  LEGAL_INDEX_PATH,
  compareIndexDates,
  formatReport,
  overallExitCode,
  parseDocumentDate,
  parseIndexCards,
} from './lib/legal-index-dates.mjs'

const DEFAULT_ORIGIN = (
  process.env.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN || 'https://aglyn.com'
).replace(/\/+$/, '')

const FETCH_TIMEOUT_MS = 30_000

function parseArgs(argv) {
  const options = { origin: DEFAULT_ORIGIN, summary: false }
  for (const arg of argv) {
    if (arg === '--summary') options.summary = true
    else if (arg.startsWith('--origin='))
      options.origin = arg.slice(9).replace(/\/+$/, '')
    else {
      console.error(`Unknown argument: ${arg}`)
      console.error(
        'Usage: check:legal-index-dates [--summary] [--origin=https://…]',
      )
      process.exit(2)
    }
  }
  return options
}

/** Fetch one page as text. Returns `{ html, error }` — never throws. */
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        // Ask for the freshest render the edge will give us. This narrows the
        // asymmetric-staleness window described above; it does not close it,
        // and the check is designed not to need it closed.
        'cache-control': 'no-cache',
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return { html: null, error: `HTTP ${response.status}` }
    return { html: await response.text(), error: null }
  } catch (error) {
    return { html: null, error: error?.message || String(error) }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const indexUrl = `${options.origin}${LEGAL_INDEX_PATH}`

  const index = await fetchPage(indexUrl)
  if (index.error) {
    console.error(
      `Could not fetch the legal index at ${indexUrl}: ${index.error}`,
    )
    console.error('Nothing was compared. This is exit 2, not a clean run.')
    process.exit(2)
  }

  const { cards, caveats } = parseIndexCards(index.html)
  if (cards.length === 0) {
    console.error(`No cards were parsed from ${indexUrl}.`)
    console.error(formatReport([], { caveats }))
    process.exit(2)
  }

  // One fetch per distinct document. The index links each document once, so
  // this is nine requests — deliberately not a crawl of every route.
  const slugs = [...new Set(cards.map((card) => card.slug))]
  const documents = new Map()
  const failures = []
  await Promise.all(
    slugs.map(async (slug) => {
      const url = `${options.origin}/legal/${slug}`
      const page = await fetchPage(url)
      if (page.error) {
        failures.push(`${url}: ${page.error}`)
        return
      }
      documents.set(slug, parseDocumentDate(page.html))
    }),
  )

  const verdicts = compareIndexDates(cards, documents)
  console.log(`Legal index date check — ${indexUrl}`)
  console.log(formatReport(verdicts, { summary: options.summary, caveats }))
  for (const failure of failures) console.error(`  FETCH FAILED  ${failure}`)

  process.exit(failures.length > 0 ? 2 : overallExitCode(verdicts))
}

main().catch((error) => {
  console.error(error?.stack || String(error))
  process.exit(2)
})
