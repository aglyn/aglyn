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
 * EVERY CAMPAIGN-EMAIL READOUT READS THE COUNTER THE GATE CLAIMS AGAINST.
 *
 * `emailSendsPerMonth` is an ORG entitlement, and the claim is taken against
 * `orgs/{orgId}/counters/campaignEmailSends`. Three surfaces report that
 * allowance to a customer — the campaign composer, the billing usage meter and
 * `GET /v1/usage` — and two of them read
 * `hosts/{hostId}/counters/campaignEmailSends` instead, which is a different
 * number about a different scope.
 *
 * The disagreement was invisible on a single-site org and wrong on every
 * other: three sites at 100 each showed `100/5,000` three times while the org
 * stood at 300, and a busy org saw room in the composer right up to the moment
 * the send was refused. That is the AGL-2113 defect — a readout the gate does
 * not agree with — and the number a merchant checks before pressing Send is
 * the worst place for a second opinion.
 *
 * ## Why this is a source guard and not a render test
 *
 * The fault is not "the component shows the wrong figure for these props" —
 * each surface renders exactly what it is handed. It is "the surface asked a
 * different collection", which is a property of which path the file names. A
 * render test passes a number in and cannot see where the number came from.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')

const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** The one place the monthly claim is taken. */
const GATE = 'libs/plugins/marketing/src/lib/server/campaign-send.ts'

/** Every surface that reports the campaign allowance to a customer. */
const READOUTS: Record<string, string> = {
  'the campaign composer':
    'libs/plugins/email/src/lib/components/campaign-composer.tsx',
  'the billing usage meter':
    'apps/console/components/billing/billing-usage.component.tsx',
  'the public usage API':
    'apps/console/utils/api-v1-resources.ts',
}

/**
 * Reads `orgs/…/counters/campaignEmailSends` — in either the web SDK's
 * variadic form (`doc(firestore, 'orgs', id, 'counters', 'campaignEmailSends')`)
 * or the Admin SDK's chained form (`.collection('counters').doc(…)` off an
 * org ref).
 */
function readsOrgCampaignCounter(text: string): boolean {
  const webSdk = /'orgs',[^)]*'counters',\s*'campaignEmailSends'/s
  const adminSdk =
    /orgRef[\s\S]{0,120}?\.collection\(\s*'counters'\s*\)[\s\S]{0,60}?'campaignEmailSends'/
  return webSdk.test(text) || adminSdk.test(text)
}

/** Reads the per-SITE counter, which answers a different question. */
function readsHostCampaignCounter(text: string): boolean {
  return /'hosts',[^)]*'counters',\s*'campaignEmailSends'/s.test(text)
}

describe('the guard can tell the two counters apart', () => {
  /**
   * The control. Both matchers are exercised against text known to contain
   * each path, so a regex that silently stopped matching could not make the
   * assertions below pass by finding nothing.
   */
  it('recognizes an org-counter read', () => {
    expect(
      readsOrgCampaignCounter(
        "doc(firestore, 'orgs', orgId, 'counters', 'campaignEmailSends')",
      ),
    ).toBe(true)
    expect(
      readsOrgCampaignCounter(
        "orgRef.collection('counters').doc('campaignEmailSends').get()",
      ),
    ).toBe(true)
  })

  it('recognizes a host-counter read', () => {
    expect(
      readsHostCampaignCounter(
        "doc(firestore, 'hosts', host.$id, 'counters', 'campaignEmailSends')",
      ),
    ).toBe(true)
  })

  it('does not confuse the two', () => {
    expect(
      readsHostCampaignCounter(
        "doc(firestore, 'orgs', orgId, 'counters', 'campaignEmailSends')",
      ),
    ).toBe(false)
    expect(
      readsOrgCampaignCounter(
        "doc(firestore, 'hosts', hostId, 'counters', 'campaignEmailSends')",
      ),
    ).toBe(false)
  })
})

describe('the gate claims against the org counter', () => {
  it('takes the monthly claim through the org-scoped reservation', () => {
    const gate = read(GATE)
    expect(gate).toMatch(/reserveCampaignEmailSends\s*\(/)
    expect(gate).toMatch(/orgCampaignEmailSendsForMonth\s*\(/)
  })
})

describe('every readout agrees with it', () => {
  for (const [label, path] of Object.entries(READOUTS)) {
    it(`${label} reads the org counter`, () => {
      expect(readsOrgCampaignCounter(read(path))).toBe(true)
    })

    it(`${label} does not read the per-site counter for the cap`, () => {
      expect(readsHostCampaignCounter(read(path))).toBe(false)
    })
  }
})
