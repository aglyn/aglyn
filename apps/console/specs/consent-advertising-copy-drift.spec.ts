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
 * ## The failure this exists to prevent, which already happened twice
 *
 * AGL-1649 shipped the advertising category with a genuine default-deny:
 * only an explicit accept could carry a grant. AGL-2402 (`a410d8785`) then
 * widened `advertisingGrantedByStatus` so the opt-out posture's `implied`
 * default carried it too. It touched FOUR files, none of which was a sentence
 * a human reads, and NINE surfaces describing the old rule silently became
 * false — the console card, the snackbar shown at the instant a host flips
 * the switch, the customer docs, the generated assist index the in-console
 * assist paraphrases back to hosts, and five doc comments. This spec was
 * written to close that, and rewrote all nine to match the wider rule.
 *
 * On 2026-08-24 the behaviour was narrowed BACK to `accepted` only, and this
 * file did its job: it went red on the anchor and named every surface to
 * restore. The copy and the assertions below now describe the narrow rule.
 *
 * ## Why the narrowing happened, since it is what this file now pins
 *
 * AGL-2402's case had two halves. The geographic half is sound: an `implied`
 * record can only be written in the opt-out posture, so an EU visitor can
 * never reach the wider rule. The disclosure half is the one that failed. That
 * commit stated the published Cookie Policy had been updated FIRST; read
 * against the live page, the policy says two different things. Its "Marketing
 * / advertising" paragraph does describe the opt-out posture — but the
 * per-cookie table says `_gac`, `_gcl_au`, `_fbp` and `_fbc` are "set only
 * where you have allowed advertising cookies", and "Your choices" repeats
 * that advertising cookies "are set only where you have consented". A policy
 * that says both cannot authorise the wider behaviour, so the behaviour now
 * matches the strictest thing it says.
 *
 * ## Why this test is a two-way lock, not a word blocklist
 *
 * Every case below asserts the BEHAVIOUR first and the copy second. A
 * blocklist alone would pass if the copy were simply deleted, and would also
 * become wrong the day someone legitimately widens the rule again. So:
 *
 * - while `implied` does NOT grant advertising, the copy must not claim it
 *   does AND must positively say that an explicit yes is required;
 * - the behaviour assertion is the anchor — re-widen the rule and this file
 *   goes red pointing at the copy that then needs rewriting, rather than
 *   silently passing on prose that has quietly become wrong.
 *
 * The blocklist is deliberately phrased in the PRESENT TENSE about current
 * behaviour, so that the historical notes several of these surfaces now carry
 * ("AGL-2402 widened the rule, and it was narrowed back") do not trip it.
 * Narrating what the rule used to be is not claiming it is the rule.
 *
 * PLANTED RED (verified, all four directions — see the commit message):
 *   1. re-insert "the implied default covers advertising too" into
 *      `cookie-consent.md` → the blocklist case fails, naming file and phrase.
 *   2. delete the explicit-yes sentence from the console card's Alert
 *      → the disclosure case fails.
 *   3. re-widen `advertisingGrantedByStatus` to accept `implied`
 *      → the anchor fails first, in every case.
 *   4. run this blocklist against the WIDENED copy (`git show ca324b4e6:…`)
 *      → ALL ELEVEN surfaces trip it, each naming its own phrase. That is the
 *      real proof the list is not decorative: it is the exact copy someone
 *      re-widening the rule would write, and every file of it is caught.
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
 * Claims that are UNCONDITIONALLY false while `implied` CANNOT carry a grant.
 *
 * Every entry is a present-tense assertion that the implied default produces
 * advertising, or that advertising tracks the analytics posture. Each one is
 * lifted from the copy as `ca324b4e6` wrote it for the widened rule, so
 * re-widening the behaviour and re-applying that copy trips this list.
 *
 * Deliberately NOT here: any phrase a historical note needs. Several surfaces
 * now say "AGL-2402 widened the rule … it was narrowed back on 2026-08-24",
 * which is true and must stay sayable. The entries are therefore assertions
 * about what the rule IS, never mentions of what it WAS.
 */
const CONTRADICTIONS: readonly string[] = [
  'implied default covers advertising',
  'implied default now carries',
  'granted by the implied default',
  'implied default that grants analytics',
  'implied default outside the prior-consent regions',
  'same consent mode as analytics',
  'follows the same posture as analytics',
  'a us implied visitor can',
  'implied default carries the advertising grant',
  'runs on implied consent',
  'get advertising storage from their next visit',
  'does start advertising storage',
  'it starts advertising storage',
  'status set includes implied',
]

describe('advertising-consent copy tracks advertising-consent behaviour', () => {
  it('the anchor: an implied record CANNOT carry an advertising grant', () => {
    // Everything below is conditioned on this, so if the rule is ever widened
    // again this case fails first and the copy cases become the follow-up
    // work rather than a silent inconsistency.
    expect(advertisingGrantedByStatus('implied')).toBe(false)
    // The refusal paths refuse too, and `accepted` is the ONE that grants.
    // Without this line a function hard-wired to `return false` would satisfy
    // the anchor while breaking the product.
    expect(advertisingGrantedByStatus('accepted')).toBe(true)
    expect(advertisingGrantedByStatus('declined')).toBe(false)
    expect(advertisingGrantedByStatus('opted-out')).toBe(false)
    expect(advertisingGrantedByStatus('gpc-opt-out')).toBe(false)
  })

  it.each(SURFACES)('%s does not contradict it', (relativePath) => {
    expect(advertisingGrantedByStatus('implied')).toBe(false)
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
   * nothing about the implied default cannot tell whether their switch is
   * inert or not.
   *
   * Two requirements, because either alone is satisfiable by accident. The
   * copy must say an explicit yes is REQUIRED, and it must say specifically
   * that the implied default does NOT supply one — the exact question a host
   * in geo mode is going to ask.
   */
  it.each([
    'apps/console/components/consent-banner-card.component.tsx',
    'apps/docs/docs/marketing-and-automation/analytics/cookie-consent.md',
  ])('%s positively states that an explicit yes is required', (relativePath) => {
    expect(advertisingGrantedByStatus('implied')).toBe(false)
    // VISIBLE copy, never the comments — see `visibleCopy`. The doc comments
    // on the card say all of this, so without the stripping this case would
    // pass on a card whose Alert had been blanked.
    const text = visibleCopy(relativePath)
    expect(text.length).toBeGreaterThan(200)
    expect(text).toMatch(/explicit yes/)
    // The denial, allowing for either surface's phrasing: "implied default is
    // NEVER treated as having allowed" (card) and "implied state grants
    // analytics and DENIES advertising" (docs). `[^.]` keeps the two halves
    // inside one sentence, so an unrelated later "never" cannot satisfy it.
    expect(text).toMatch(
      /implied (?:default|state|consent)[^.]{0,120}(?:never|denies|denied)/,
    )
  })

  it('the generated assist index is in step with the doc it is built from', () => {
    // The index is what the in-console assist retrieves; a stale one puts the
    // old sentence back in front of hosts through a different door. Checking
    // a phrase from the CORRECTED doc proves the generator was re-run, which
    // `not.toContain` on the old phrase alone would not.
    const index = flatten('apps/console/constants/assist-docs-index.generated.ts')
    expect(index).toContain('every visitor needs an explicit yes')
  })
})
