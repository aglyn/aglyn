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

import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Aglyn does not promise that a price is permanent (AGL-1178).
 *
 * While the product is pre-release, plans, prices and included features have
 * to stay changeable — so no "free forever", no grandfathering, no price
 * locks. The marketing designs were swept for exactly these phrases (42
 * instances), but the sweep only covered Figma: the console's own Free plan
 * card still shipped the words **"Free forever"** to every subscriber who
 * opened Billing. A promise made in the product is the one that counts, so
 * the guard belongs in the repo rather than in a reviewer's memory.
 *
 * Scope is every tracked file — a phrase in a doc, an email template or a
 * plugin README commits us just as firmly as one in a button label, and
 * scoping to a directory list is how the console copy was missed.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * Only phrases that promise PERMANENCE. Deliberately not a bare
 * `grandfathered`: plugin review uses that word correctly for versions
 * listed before review existed (AGL-965), and banning it there would train
 * people to add exemptions instead of reading the rule.
 */
const BANNED = [
  /free\s+forever/i,
  /forever\s+free/i,
  /grandfathered\s+(pricing|price|rate|plan)/i,
  /lock\s+in\s+(your\s+)?(founding|price|rate)/i,
  /price\s+(is\s+)?locked/i,
  /price\s+will\s+never/i,
]

/**
 * The WHOLE list, each a deliberate non-pricing use. The staleness test below
 * makes a wrong entry fail rather than quietly widen what is allowed.
 */
const ALLOWED = new Map<string, string>([
  [
    'docs/PLUGIN_LOADING.md',
    'HTTP caching, not money: "cache hits are free forever (a new version ' +
      'is a new URL)" describes immutable content-addressed bundle URLs.',
  ],
  [
    'apps/console/specs/no-price-commitment.spec.ts',
    'This guard — it necessarily contains the phrases it bans.',
  ],
])

const BINARY =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|mov|webm|mp3|wav|node|wasm)$/i

function trackedFiles(): Array<string> {
  return execSync('git ls-files -z', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((path) => !BINARY.test(path))
}

describe('no page promises a price is permanent (AGL-1178)', () => {
  const offenders: Array<string> = []

  beforeAll(() => {
    for (const rel of trackedFiles()) {
      if (ALLOWED.has(rel)) continue
      const abs = join(REPO_ROOT, rel)
      try {
        if (statSync(abs).size > 8 * 1024 * 1024) continue
        const source = readFileSync(abs, 'utf8')
        if (BANNED.some((pattern) => pattern.test(source))) offenders.push(rel)
      } catch {
        // A tracked path that is not readable here (submodule, broken link)
        // is not evidence of a commitment.
      }
    }
  })

  it('has no price-permanence promise in any tracked file', () => {
    expect(offenders).toEqual([])
  })

  it('keeps every exemption honest', () => {
    // A stale exemption is worse than none: it silently permits the phrase in
    // a file that no longer has a reason to use it.
    for (const [rel] of ALLOWED) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(`${rel}: ${BANNED.some((p) => p.test(source))}`).toBe(
        `${rel}: true`,
      )
    }
  })

  it('offers the Free plan without promising permanence', () => {
    // The specific regression: the Free card's CTA. Assert the replacement is
    // present, not merely that the old words are gone — a blank label would
    // pass the negative test.
    const card = readFileSync(
      join(
        REPO_ROOT,
        'apps/console/components/billing/billing-plan-cards.component.tsx',
      ),
      'utf8',
    )
    expect(card).toContain('No credit card required')
  })
})
