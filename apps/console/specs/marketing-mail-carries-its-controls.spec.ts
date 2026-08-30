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
 * Every sender that mails a MERCHANT'S AUDIENCE carries the controls that
 * come with doing so.
 *
 * ## The bug this replaces had no symptom
 *
 * `List-Unsubscribe` and `List-Unsubscribe-Post` were added in exactly one
 * place — the campaign sender — and the shared `sendEmail` added neither and
 * consulted neither suppression list. Four merchant-triggered bulk paths
 * therefore mailed people who had hard-bounced or pressed "report spam", with
 * no way out of the mail and no ceiling on how much of it one person got:
 * member posts, abandoned-cart reminders, restock alerts and the workflow
 * `sendEmail` step. Each of those senders worked. Each of their tests passed.
 * The only trace was on the shared sending domain, under `p=reject`, where
 * every other tenant's password resets leave by.
 *
 * No test of any one sender can find that, because each one passes. So this
 * enumerates the senders FROM THE SOURCE, the way the cost-meter sweep beside
 * it does, and forces each to be either declared as marketing or explicitly,
 * reasonedly exempt. A fifth bulk path added next month fails here, naming
 * the file, rather than quietly teaching Gmail that `aglyn.com` does not
 * listen.
 *
 * ## Why an audience is decided by the CONTEXT string
 *
 * `context` already names the sender at every call site — it is what the
 * cost tag and the log line are derived from — so it is the one label that
 * exists uniformly and cannot be forgotten without failing something else
 * first. The alternative, reasoning about which recipients a sender reaches,
 * is not something a build-time sweep can do.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SEARCH_ROOTS = ['apps', 'libs'].map((dir) => join(REPO_ROOT, dir))

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
])

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(full))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    // Specs mock the sender; they are not senders.
    if (/\.spec\.tsx?$/.test(entry.name)) continue
    found.push(full)
  }
  return found
}

const CALLS_SEND_EMAIL = /\bsendEmail\s*\(/

/**
 * The `context` labels that name mail sent to a merchant's own audience.
 *
 * Each is a real label passed at a call site today. A sender whose context is
 * not here is transactional as far as this sweep is concerned — which is the
 * safe direction for the reader and the unsafe one for a new bulk path, so
 * the list below is the thing to extend when one is added.
 */
const AUDIENCE_CONTEXTS = [
  'campaign',
  'member post',
  'abandoned cart',
  'restock alert',
  'event action',
]

/** How a sender declares itself, and what the declaration buys. */
const DECLARES_MARKETING = /\bmarketing:\s*\{/

/**
 * Audience senders that deliberately do not pass `marketing`. A reason is
 * mandatory — the value of the sweep is that "we decided" is written down,
 * not that the list is short.
 */
const EXEMPT: Record<string, string> = {
  'libs/plugins/marketing/src/lib/server/campaign-send.ts':
    'The campaign sender discharges every one of the three obligations itself and earlier than the chokepoint could: it mints the signed unsubscribe URL before rendering, because a designed template resolves `{{unsubscribeUrl}}` as a merge value; it filters the whole audience through `filterSendableForHost` in one keyed read rather than one per recipient; and it records the frequency window for the batch after the loop. Asserted positively below rather than taken on trust.',
}

const audienceSenders: Array<{ path: string; text: string }> = []
const undeclared: string[] = []

for (const root of SEARCH_ROOTS) {
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    if (!CALLS_SEND_EMAIL.test(text)) continue
    const path = relative(REPO_ROOT, file).split(sep).join('/')
    const mailsAnAudience = AUDIENCE_CONTEXTS.some((label) =>
      text.includes(`context: '${label}'`),
    )
    if (!mailsAnAudience) continue
    audienceSenders.push({ path, text })
    if (path in EXEMPT) continue
    if (!DECLARES_MARKETING.test(text)) undeclared.push(path)
  }
}

describe('mail to a merchant’s audience carries its controls', () => {
  /** Guards the premise: a sweep that found nothing would pass silently. */
  it('finds the audience senders at all', () => {
    expect(audienceSenders.map(({ path }) => path).sort()).toEqual([
      'libs/plugins/commerce/src/lib/server/member-post.ts',
      'libs/plugins/commerce/src/lib/server/process-abandoned.ts',
      'libs/plugins/commerce/src/lib/server/process-restock.ts',
      'libs/plugins/marketing/src/lib/server/campaign-send.ts',
      'libs/tenant/runtime/src/lib/run-event-actions.ts',
    ])
  })

  it('leaves no audience sender without an unsubscribe and a suppression check', () => {
    expect(undeclared).toEqual([])
  })

  it('records a reason for every exemption', () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(60)
      expect(readFileSync(join(REPO_ROOT, path), 'utf8')).toMatch(
        CALLS_SEND_EMAIL,
      )
    }
  })
})

describe('the campaign sender earns its exemption', () => {
  const sender = () =>
    audienceSenders.find(
      ({ path }) =>
        path === 'libs/plugins/marketing/src/lib/server/campaign-send.ts',
    )!.text

  it('adds the RFC 8058 pair itself', () => {
    // The pair, not the header alone: `List-Unsubscribe` on its own does not
    // satisfy Gmail's and Yahoo's bulk-sender rules.
    expect(sender()).toContain("'List-Unsubscribe'")
    expect(sender()).toContain("'List-Unsubscribe-Post'")
  })

  it('mints its link through the one signer', () => {
    // Not a hand-assembled URL. The signed subject lives in one module
    // because the verifier and two minters have to agree on it forever.
    expect(sender()).toMatch(/buildUnsubscribeUrl\s*\(/)
    expect(sender()).not.toMatch(/createHmac\s*\(/)
  })

  it('consults BOTH suppression lists', () => {
    expect(sender()).toMatch(/filterSendableForHost\s*\(/)
  })

  it('records the frequency window for what it reached', () => {
    // A ceiling that did not count campaigns would describe nothing: a
    // campaign is most of the mail a person receives from a site.
    expect(sender()).toMatch(/recordMarketingSends\s*\(/)
  })
})

describe('the shared chokepoint is where the obligation lives', () => {
  const chokepoint = readFileSync(
    join(REPO_ROOT, 'libs/shared/util/email/src/lib/send-email.ts'),
    'utf8',
  )

  it('asks the marketing gate, and asks it before the hourly governor', () => {
    const gate = chokepoint.indexOf('getMarketingSendGate()')
    const governor = chokepoint.indexOf('getEmailSendGovernor()')
    expect(gate).toBeGreaterThan(-1)
    expect(governor).toBeGreaterThan(-1)
    // A message that must never leave should not spend platform hourly budget
    // being refused.
    expect(gate).toBeLessThan(governor)
  })

  it('adds the header pair and the visible link in one place', () => {
    expect(chokepoint).toMatch(/unsubscribeHeaders\s*\(/)
    expect(chokepoint).toMatch(/appendUnsubscribeText\s*\(/)
    expect(chokepoint).toMatch(/appendUnsubscribeHtml\s*\(/)
  })
})
