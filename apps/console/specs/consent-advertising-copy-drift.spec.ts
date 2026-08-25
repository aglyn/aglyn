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
 * The advertising-consent COPY cannot drift from the advertising-consent
 * BEHAVIOUR (AGL-1649).
 *
 * ## The failure this exists to prevent, which has now happened three times
 *
 * AGL-1649 shipped the advertising category with a genuine default-deny: only
 * an explicit accept could carry a grant. AGL-2402 (`a410d8785`) widened
 * `advertisingGrantedByStatus` so the opt-out posture's `implied` default
 * carried it too. It touched FOUR files, none of which was a sentence a human
 * reads, and NINE surfaces describing the old rule silently became false — the
 * console card, the snackbar shown at the instant a host flips the switch, the
 * customer docs, the generated assist index the in-console assist paraphrases
 * back to hosts, and five doc comments. This spec was written to close that.
 *
 * On 2026-08-24 the behaviour was narrowed BACK to `accepted` only, and this
 * file did its job: it went red on the anchor and named every surface to
 * restore.
 *
 * On 2026-08-25 it was widened AGAIN — `728891f90`, AGL-2193 — and this file
 * did its job a second time, going red on the anchor with fifteen of sixteen
 * cases naming the copy that had become false. That is the whole design
 * working, twice, in opposite directions. The copy and the assertions below
 * now describe the WIDE rule.
 *
 * ## Why the widening stood this time, since it is what this file now pins
 *
 * AGL-2402's case had two halves. The geographic half was always sound: an
 * `implied` record can only be written in the opt-out posture, so an EU
 * visitor can never reach the wider rule. The disclosure half is what failed
 * in August and what was fixed on the 25th — and the order matters, because it
 * is the order [[feedback_legal_docs_are_source_of_truth]] requires.
 *
 * The **Privacy Policy never had to move.** It already said *"We do not 'sell'
 * personal information for money. With your consent, we do 'share' … for
 * cross-context behavioral advertising"*, named Google and Meta, and spelled
 * out the EU/UK-ask-first vs. elsewhere-from-first-visit split. The flat
 * "we do not sell or share" denial that the 2026-08-24 narrowing reasoned from
 * is not in the document; it was a paraphrase in `docs/ANALYTICS.md`.
 *
 * The **Cookie Policy did move, first.** Its "Marketing / advertising"
 * paragraph already described the opt-out posture while five other sentences
 * said opt-in-only — the per-cookie table's ×4 "set only where you have
 * allowed advertising cookies", and "Your choices"' "Advertising cookies are
 * set only where you have consented". All five were rewritten in the master on
 * 2026-08-25. Only then did the code follow.
 *
 * ## Why this test is a two-way lock, not a word blocklist
 *
 * Every case below asserts the BEHAVIOUR first and the copy second. A
 * blocklist alone would pass if the copy were simply deleted, and would also
 * become wrong the day someone legitimately narrows the rule again. So:
 *
 * - while `implied` DOES grant advertising, the copy must not claim an
 *   explicit yes is required AND must positively describe the geographic
 *   split a host is going to ask about;
 * - the behaviour assertion is the anchor — re-narrow the rule and this file
 *   goes red pointing at the copy that then needs rewriting, rather than
 *   silently passing on prose that has quietly become wrong.
 *
 * ⛔ If you are here because the anchor is red, the fix is NOT to edit the
 * anchor. Establish which direction the policy actually moved, and move the
 * published masters first — the code follows the gdoc, never the reverse.
 *
 * The blocklist is deliberately phrased in the PRESENT TENSE about current
 * behaviour, so that the historical notes several of these surfaces carry
 * ("AGL-2402 widened the rule, it was narrowed back, then widened again") do
 * not trip it. Narrating what the rule used to be is not claiming it is the
 * rule — and every entry below was lifted from the NARROW copy as `a9af459a9`
 * left it, so it is the exact prose someone re-narrowing would write.
 *
 * PLANTED RED (verified, all four directions):
 *   1. re-insert "advertising storage stays denied" into `cookie-consent.md`
 *      → the blocklist case fails, naming file and phrase.
 *   2. delete the first-visit sentence from the console card's Alert
 *      → the disclosure case fails.
 *   3. re-narrow `advertisingGrantedByStatus` to `accepted` only
 *      → the anchor fails first, in every case.
 *   4. run this blocklist against the NARROW copy this commit replaced
 *      → NINE surfaces trip it, each naming its own phrase. That is the real
 *      proof the list is not decorative: it is the exact copy someone
 *      re-narrowing the rule would write, and every file of it is caught.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { advertisingGrantedByStatus } from '@aglyn/aglyn/app-utils/visitor-consent'

/** Repo root: this file is at `<root>/apps/console/specs`. */
const ROOT = resolve(__dirname, '../../..')

/**
 * Collapse a source file to one comparable line.
 *
 * Three normalisations, all load-bearing. Joining `'…' + '…'` concatenations
 * is what lets a claim split across three TSX lines be matched as the
 * sentence a host actually reads — the console card's copy is written that
 * way, so without this every assertion below would be vacuous. Collapsing
 * whitespace does the same for markdown's wrapped prose. Curly apostrophes
 * are folded because the card uses them and the docs do not.
 *
 * Stripping backticks, asterisks and underscores is the one that was MISSING
 * on the first pass here, and it mattered: three of the stale files wrote the
 * claim as "`implied` never does", with the backticks INSIDE the phrase. The
 * blocklist ran clean over all three while every one of them was false — a
 * check that reads the emphasis instead of the sentence. Re-verified against
 * `git show HEAD:` for each surface after the fix.
 */
function flatten(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
    .replace(/'\s*\+\s*'/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * The same, with COMMENTS REMOVED — what a host can actually read on screen.
 *
 * Needed because the first version of the disclosure case below could not
 * fail. It matched "implied default" anywhere in the card file, and the
 * explanatory doc comment above `handleAdvertising` says those words — so
 * replacing the phrase in the visible Alert with a nonsense token left the
 * test green. A disclosure requirement satisfied by a code comment is not a
 * disclosure requirement.
 *
 * PLANTED RED (verified): swap "implied default" for a nonsense token in the
 * card's Alert only → green before this function existed, red after.
 */
function visibleCopy(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/'\s*\+\s*'/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Every surface that describes the advertising category to a human — the
 * console, the customer docs, the generated help index the in-console assist
 * retrieves from, the internal reference, and the doc comments a maintainer
 * reads before changing any of it.
 */
const SURFACES: readonly string[] = [
  'apps/console/components/consent-banner-card.component.tsx',
  'apps/console/constants/cookie-inventory.ts',
  'apps/console/constants/assist-docs-index.generated.ts',
  'apps/docs/docs/marketing-and-automation/analytics/cookie-consent.md',
  'docs/ANALYTICS.md',
  'libs/aglyn/src/lib/app-utils/visitor-consent.ts',
  'libs/aglyn/src/lib/app-utils/advertising-tags.ts',
  'libs/aglyn/src/lib/app-utils/visitor-consent-advertising.spec.ts',
  'apps/tenant/app/[host]/[[...slug]]/site-analytics.tsx',
  // The two this list MISSED on its first pass, both found by grepping
  // AGL-2402 rather than by the list itself — which is the argument for
  // keeping the grep in the loop when the rule next moves.
  //
  // `document-preview.component.tsx` is not prose at all: the console's
  // region simulator BUILDS a fake visitor record, and it was writing
  // `advertising: asksAds` onto an implied one. A preview that disagrees with
  // the engine is worse than stale prose, because a host uses it to check
  // exactly this.
  'apps/console/components/document-preview.component.tsx',
  // `platform-consent-default.ts` carried a live measurement of aglyn.com's
  // own ad signals (`gcs=G111`, ad storage granted) as current fact.
  'libs/aglyn/src/lib/app-utils/platform-consent-default.ts',
  // The PERSISTED schema. `consent.advertising` went undeclared on
  // `AglynHost` for four days while the console wrote it and the tenant read
  // it (`consent-host-schema-coverage.spec.ts` is the guard for that half);
  // declaring it brought a description of the rule with it, and a description
  // of the rule is a surface. It is also the first thing anyone extending the
  // category model reads, which is the audience least able to tell a stale
  // sentence from a current one.
  'libs/aglyn/src/lib/foundation/definitions/platform.types.ts',
]

/**
 * Claims that are UNCONDITIONALLY false while `implied` CAN carry a grant.
 *
 * Every entry is a present-tense assertion that advertising requires an
 * explicit yes, or that the implied default withholds one. Each is lifted from
 * the copy as it stood before 2026-08-25, so re-narrowing the behaviour and
 * re-applying that copy trips this list.
 *
 * Deliberately NOT here: any phrase a historical note needs. Several surfaces
 * say "AGL-2402 widened the rule … it was narrowed back on 2026-08-24 …
 * widened again on the 25th", including direct quotation of the Cookie
 * Policy sentences that were rewritten — *"set only where you have allowed
 * advertising cookies"* is quoted as history in three files and must stay
 * sayable. The entries are therefore assertions about what the rule IS, never
 * mentions or quotations of what it WAS.
 *
 * Also deliberately NOT here: "advertising storage stays denied". It was the
 * conclusion of the narrow rule in the customer docs, but it is ALSO the
 * console's snackbar for switching the advertising question OFF — where it is
 * simply true. A blocklist that reddens correct copy teaches the next person
 * to reword something accurate to appease a test, which is worse than the
 * drift it was guarding.
 */
const CONTRADICTIONS: readonly string[] = [
  'always needs an explicit yes',
  'every visitor needs an explicit yes',
  'is never treated as having allowed',
  'the implied default never does',
  'only an explicit accept can carry',
  'only an explicit accept grants advertising',
  'only an explicit yes to this category grants it',
  'grants analytics and denies advertising',
  'advertising is strict opt-in',
  'needs that explicit yes',
  'advertising never is',
]

describe('advertising-consent copy tracks advertising-consent behaviour', () => {
  it('the anchor: an implied record CAN carry an advertising grant', () => {
    // Everything below is conditioned on this, so if the rule is ever narrowed
    // again this case fails first and the copy cases become the follow-up
    // work rather than a silent inconsistency.
    expect(advertisingGrantedByStatus('implied')).toBe(true)
    expect(advertisingGrantedByStatus('accepted')).toBe(true)
    // The REFUSALS are what keep the widening a widening rather than a
    // surrender. Without these three a function hard-wired to `return true`
    // would satisfy the anchor while handing Google a basis for a visitor who
    // said no — which is the failure mode that actually matters here.
    expect(advertisingGrantedByStatus('declined')).toBe(false)
    expect(advertisingGrantedByStatus('opted-out')).toBe(false)
    expect(advertisingGrantedByStatus('gpc-opt-out')).toBe(false)
  })

  it.each(SURFACES)('%s does not contradict it', (relativePath) => {
    expect(advertisingGrantedByStatus('implied')).toBe(true)
    const text = flatten(relativePath)
    // Non-vacuity: a path typo would otherwise read as an empty file and
    // pass every `not.toContain` below.
    expect(text.length).toBeGreaterThan(200)
    expect(text).toContain('advertising')
    for (const claim of CONTRADICTIONS) {
      expect({ file: relativePath, says: claim, present: text.includes(claim) })
        .toEqual({ file: relativePath, says: claim, present: false })
    }
  })

  /**
   * The other half of the lock. Not saying the false thing is not the same as
   * saying the true one, and silence is its own drift: a host who reads
   * nothing about where advertising starts cannot tell whether their switch
   * reaches their US visitors or not.
   *
   * THREE requirements, because any one alone is satisfiable by accident and
   * each is a different half-truth if it stands alone:
   *
   * - that it runs from the first visit somewhere — without this the copy can
   *   describe only the strict case and leave the widening undisclosed;
   * - that the prior-consent regions are still asked FIRST — without this the
   *   copy reads as a blanket "advertising just runs", which is the claim that
   *   would actually be unlawful in the EU/UK;
   * - that "Your Privacy Choices" exists — for a visitor who is never shown a
   *   banner it is the ONLY control they have, so a disclosure that omits it
   *   describes a practice with no opt-out.
   */
  it.each([
    'apps/console/components/consent-banner-card.component.tsx',
    'apps/docs/docs/marketing-and-automation/analytics/cookie-consent.md',
  ])('%s states WHERE advertising starts, and how to stop it', (relativePath) => {
    expect(advertisingGrantedByStatus('implied')).toBe(true)
    // VISIBLE copy, never the comments — see `visibleCopy`. The doc comments
    // on the card say all of this, so without the stripping this case would
    // pass on a card whose Alert had been blanked.
    const text = visibleCopy(relativePath)
    expect(text.length).toBeGreaterThan(200)
    expect(text).toMatch(/first visit/)
    // Separate assertions rather than one sentence-scoped regex: the docs put
    // the region names and the "asked first" claim in different sentences of a
    // bullet list, and a `[^.]` window would fail on the punctuation rather
    // than on the meaning.
    expect(text).toMatch(/prior-consent|eu\/eea|eu\/uk/)
    expect(text).toMatch(/asked first|banner first|see the banner/)
    expect(text).toMatch(/your privacy choices/)
  })

  it('the generated assist index is in step with the doc it is built from', () => {
    // The index is what the in-console assist retrieves; a stale one puts the
    // old sentence back in front of hosts through a different door. Checking
    // a phrase from the CORRECTED doc proves the generator was re-run, which
    // `not.toContain` on the old phrase alone would not.
    //
    // Regenerate with `node tools/scripts/generate-assist-docs-index.mjs`.
    const index = flatten('apps/console/constants/assist-docs-index.generated.ts')
    expect(index).toContain('runs from their first visit')
  })
})
