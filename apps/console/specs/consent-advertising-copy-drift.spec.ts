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
 * ## The failure this exists to prevent, which already happened once
 *
 * AGL-1649 shipped the advertising category with a genuine default-deny:
 * only an explicit accept could carry a grant. Six hours later AGL-2402
 * (`a410d8785`) widened `advertisingGrantedByStatus` so the opt-out posture's
 * `implied` default carries it too — a defensible change, safe by geography,
 * with its own tests.
 *
 * It touched FOUR files, none of which was a sentence a human reads. Every
 * surface describing the old rule survived the change and became false:
 *
 * - the console card told a host, in-product, that "a visitor tracked under
 *   implied consent is never treated as having allowed advertising";
 * - the snackbar shown at the instant the host flips the switch said
 *   "nothing is granted until one says yes" — while in geo mode the switch
 *   starts `ad_storage` for every US visitor on the site;
 * - the customer docs said advertising is "never implied";
 * - and the generated assist index carried that sentence into the in-console
 *   AI help, which paraphrases it back to hosts.
 *
 * That is not a documentation nit. A host configuring a privacy control was
 * being told the opposite of what their own site does, which is the
 * deceptive-practices exposure AGL-2402's own commit message says it updated
 * the published policy to avoid — and then it missed every in-repo surface.
 *
 * ## Why this test is a two-way lock, not a word blocklist
 *
 * Every case below asserts the BEHAVIOUR first and the copy second. A
 * blocklist alone would pass if the copy were simply deleted, and would also
 * become wrong the day someone legitimately narrows the rule back. So:
 *
 * - if `implied` grants advertising, the copy must not deny it AND must
 *   disclose it;
 * - the behaviour assertion is the anchor — revert AGL-2402 and this file
 *   goes red pointing at the copy that now needs restoring, rather than
 *   silently passing on prose that has quietly become right again.
 *
 * PLANTED RED (verified, both directions):
 *   1. re-insert "This one is **never implied**." into `cookie-consent.md`
 *      → the blocklist case fails, naming the file and the phrase.
 *   2. delete the implied-default sentence from the console card's Alert
 *      → the disclosure case fails.
 *   3. narrow `advertisingGrantedByStatus` back to `accepted` only
 *      → the anchor fails first, in every case.
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
]

/**
 * Claims that are UNCONDITIONALLY false while `implied` can carry a grant.
 *
 * Deliberately excludes anything a mode-scoped sentence could legitimately
 * say. "nothing is granted until one says yes" is TRUE in `strict` mode and
 * the console card still says it on that branch, so it is not here — a
 * blocklist that punished true statements would be edited away rather than
 * obeyed. Each entry below is false in every posture.
 */
const CONTRADICTIONS: readonly string[] = [
  'never implied',
  'never by the implied default',
  'implied default never',
  'implied never does',
  'implied never grants',
  'implied state grants analytics and denies advertising',
  'implied consent is never treated as having allowed',
  'merely defaulted into analytics',
  'no amount of not-objecting adds up to a yes',
  'not an implied default',
  'only where a visitor has explicitly allowed',
]

describe('advertising-consent copy tracks advertising-consent behaviour', () => {
  it('the anchor: an implied record CAN carry an advertising grant', () => {
    // AGL-2402. Everything below is conditioned on this, so if the rule is
    // ever narrowed again this case fails first and the copy cases become
    // the follow-up work rather than a silent inconsistency.
    expect(advertisingGrantedByStatus('implied')).toBe(true)
    // The refusal paths are what keep the widened rule honest; if one of
    // these ever flipped, the copy would need a far bigger rewrite than a
    // blocklist could describe.
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
   * The other half of the lock. Denying the old claim is not the same as
   * telling a host the true one, and the true one is the surprising one:
   * flipping the switch on a geo-conditional site starts advertising storage
   * for visitors who are never shown a banner.
   */
  it.each([
    'apps/console/components/consent-banner-card.component.tsx',
    'apps/docs/docs/marketing-and-automation/analytics/cookie-consent.md',
  ])('%s positively discloses the implied grant', (relativePath) => {
    expect(advertisingGrantedByStatus('implied')).toBe(true)
    // VISIBLE copy, never the comments — see `visibleCopy`.
    const text = visibleCopy(relativePath)
    expect(text.length).toBeGreaterThan(200)
    // The disclosure has to name the mechanism (the implied default) AND the
    // remedy (the persistent opt-out), because one without the other is
    // still a misleading description of what the host just turned on.
    expect(text).toMatch(/implied default/)
    expect(text).toMatch(/privacy choices|opt-out/)
  })

  it('the generated assist index is in step with the doc it is built from', () => {
    // The index is what the in-console assist retrieves; a stale one puts the
    // old sentence back in front of hosts through a different door. Checking
    // a phrase from the CORRECTED doc proves the generator was re-run, which
    // `not.toContain` on the old phrase alone would not.
    const index = flatten('apps/console/constants/assist-docs-index.generated.ts')
    expect(index).toContain('prior-consent regions always need an explicit yes')
  })
})
