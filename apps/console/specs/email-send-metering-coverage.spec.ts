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
 * Every `sendEmail` call site counts, and only campaigns can be refused
 * (AGL-1438).
 *
 * The bug this replaces had no symptom either. `counters/emailSends` was
 * written by exactly one caller — the marketing campaign sender — while
 * workflows, commerce, bookings and invites called `sendEmail` and counted
 * nothing. Every individual send worked. The plan looked enforced. The only
 * trace was a COGS figure built from a fraction of its inputs, which is the
 * hazard AGL-1402 documented: a number that omits most of what feeds it still
 * looks precise.
 *
 * No test of any one sender can find that, because each one passes. Only an
 * exhaustive sweep can. So this enumerates the senders FROM THE SOURCE and
 * forces each to be either metered or explicitly, reasonedly exempt — adding
 * a twenty-fourth sender and forgetting the meter fails here, naming the file,
 * rather than quietly under-reporting cost forever.
 *
 * The second half is the other half of the decision: a transactional sender
 * must not be able to consult the cap at all. `emailSendsPerMonth` may appear
 * in exactly one sending file. Blocking a password reset locks somebody out of
 * their own account, and the message explaining why is itself an email that
 * will not send.
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

/**
 * A real call, not the `'sendEmail'` workflow step type, a `case 'sendEmail':`
 * or a doc mention. The declaration in the shared lib matches too, which is
 * why it carries an exemption rather than a silent regex carve-out.
 */
const CALLS_SEND_EMAIL = /\bsendEmail\s*\(/

/**
 * Evidence a file has actually thought about the meter. Any of the one-line
 * helpers, or the function they all delegate to.
 */
const METERS = [
  /\bmeterHostEmail\s*\(/,
  /\bmeterOrgEmail\s*\(/,
  /\bmeterPlatformEmail\s*\(/,
  /\brecordEmailSends\s*\(/,
]

/**
 * Files that call `sendEmail` and are deliberately not metered. A reason is
 * mandatory — the value of the sweep is that "we decided" is written down,
 * not that the list is short.
 */
const EXEMPT: Record<string, string> = {
  'libs/shared/util/email/src/lib/send-email.ts':
    'Defines `sendEmail`. Metering here rather than at the call sites would look tidier and be wrong: this module is `scope:shared` and cannot reach Firestore, and it has no idea WHICH host or org a message belongs to — the attribution is the whole point of the meter.',
}

const meteredSenders: Array<{ path: string; text: string }> = []
const unmetered: string[] = []

for (const root of SEARCH_ROOTS) {
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    if (!CALLS_SEND_EMAIL.test(text)) continue
    const path = relative(REPO_ROOT, file).split(sep).join('/')
    if (path in EXEMPT) continue
    if (METERS.some((pattern) => pattern.test(text))) {
      meteredSenders.push({ path, text })
    } else {
      unmetered.push(path)
    }
  }
}

describe('every sendEmail call site counts toward cost (AGL-1438)', () => {
  /** Guards the premise: a sweep that found nothing would pass silently. */
  it('finds the senders at all', () => {
    expect(meteredSenders.length + unmetered.length).toBeGreaterThan(15)
  })

  it('leaves no sender invisible to the cost meter', () => {
    expect(unmetered).toEqual([])
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

/**
 * The cap enforces against campaigns and nothing else. A transactional sender
 * that never names `emailSendsPerMonth` cannot gate on it — no reasoning about
 * control flow required.
 */
describe('only campaigns may be refused by the quota (AGL-1438)', () => {
  const CAP_ENFORCER = 'libs/plugins/marketing/src/lib/server/campaign-send.ts'

  it('lets exactly one sender see the cap, and it is the campaign sender', () => {
    const namesTheCap = meteredSenders
      .filter(({ text }) => text.includes('emailSendsPerMonth'))
      .map(({ path }) => path)
    expect(namesTheCap).toEqual([CAP_ENFORCER])
  })

  it('caps the campaign meter, not the cost meter', () => {
    const campaignSender = meteredSenders.find(
      ({ path }) => path === CAP_ENFORCER,
    )
    expect(campaignSender).toBeDefined()
    // The counter the quota is measured against. Reading `emailSends` here
    // would refuse a campaign because the site sent order confirmations.
    expect(campaignSender!.text).toMatch(/campaignEmailSendsForMonth\s*\(/)
    // And the old inline increment is gone, so nothing counts twice.
    expect(campaignSender!.text).not.toMatch(/doc\(\s*'emailSends'\s*\)/)
  })
})
