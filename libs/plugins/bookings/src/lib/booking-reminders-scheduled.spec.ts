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
 * AGL-2431: booking reminders are SCHEDULED, and the merchant can see the
 * queue.
 *
 * The same green-looking absence AGL-2227 closed for the two commerce
 * recovery passes, one plugin over and missed by that sweep. `bookings/reminders`
 * has existed since AGL-160 as an `x-cron-secret` HTTP door whose own docblock
 * said "invoke hourly from the scheduler". Nothing invoked it: not
 * `scheduled-crons.yml`, not `vercel.json` (no `crons` key at all), not
 * `registerPluginJob` — the plugin's only registration was `expire-stale-holds`.
 *
 * So a shipped feature with a designed email template (AGL-770) and
 * white-label brand resolution (White-Label Phase 3) had never sent one
 * reminder to anyone, and every test in the repo passed the whole time.
 *
 * This asserts the WIRE, not the handler. Source-text assertions rather than
 * an import, for the reason the commerce guard gives: `server.ts` pulls in
 * firebase-admin at module scope, and importing it here would mean a
 * closed-world `jest.mock` of the whole bookings backend to observe one
 * registry call.
 *
 * The window predicate IS imported, because it is pure and because the point
 * of extracting it was that two callers share one rule — a text assertion
 * would prove they both name it, not that it answers correctly on an edge.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_DOCS_ANCHORS } from '@aglyn/aglyn'
import {
  isBookingReminderDue,
  REMINDER_WINDOW_END_HOURS,
  REMINDER_WINDOW_START_HOURS,
} from './model'

const LIB = __dirname

function source(relative: string): string {
  return readFileSync(join(LIB, relative), 'utf8')
}

/** Body only — an import names a symbol without scheduling anything. */
function body(relative: string): string {
  return source(relative)
    .split('\n')
    .filter(
      (line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line),
    )
    .join('\n')
}

/**
 * The ONE `registerPluginJob({ … })` literal whose `name` is `jobName`.
 *
 * Sliced by index rather than matched with a lazy regex, and that is not a
 * style preference — it is a bug this guard shipped with for one run.
 * `/registerPluginJob\(\{[\s\S]*?name: 'booking-reminders'[\s\S]*?\n\}\)/`
 * begins at the FIRST `registerPluginJob({` in the file, which is
 * `expire-stale-holds` near the top, so the "block" it returned was
 * everything from there to the registration — including the whole
 * `scanBookingReminders` function declaration sitting in between. The
 * assertion "this job's handler calls the scan" was therefore satisfied by
 * the scan's own `export async function scanBookingReminders(` line.
 *
 * Proven by mutation: emptying the handler entirely left this suite green.
 */
function jobBlock(barrel: string, jobName: string): string {
  const nameAt = barrel.indexOf(`name: '${jobName}'`)
  if (nameAt < 0) return ''
  const open = barrel.lastIndexOf('registerPluginJob({', nameAt)
  if (open < 0) return ''
  const close = barrel.indexOf('\n})', nameAt)
  if (close < 0) return ''
  return barrel.slice(open, close + 3)
}

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 19, 12, 0, 0)

/** A booking the pass would mail, so each case below changes ONE thing. */
function dueBooking(overrides: Record<string, unknown> = {}) {
  return {
    status: 'confirmed',
    email: 'guest@example.com',
    startsAtMs: NOW + 24 * HOUR,
    ...overrides,
  }
}

describe('AGL-2431 · the reminder pass is actually scheduled', () => {
  const serverBarrel = source('server.ts')

  it('registers a booking-reminders plugin job', () => {
    expect(serverBarrel).toMatch(
      /registerPluginJob\(\{[\s\S]*?name:\s*'booking-reminders'/,
    )
  })

  it('that job drives scanBookingReminders from its own object literal', () => {
    // The registration and the call must be in the SAME literal. A job
    // registered with an empty handler, beside an unrelated call to the scan,
    // would satisfy two separate greps and schedule nothing.
    const block = jobBlock(serverBarrel, 'booking-reminders')
    expect(block).toContain('scanBookingReminders(')
  })

  it('the block slicer really isolates ONE registration', () => {
    // Guard on the guard. If `jobBlock` ever went back to swallowing the
    // file, the assertion above would pass on the scan's own declaration and
    // an empty handler would ship. Two properties pin it: the slice starts at
    // a registration, and it contains no OTHER registration.
    const block = jobBlock(serverBarrel, 'booking-reminders')
    expect(block.startsWith('registerPluginJob({')).toBe(true)
    expect(block.match(/registerPluginJob\(\{/g)?.length).toBe(1)
    // The sibling job must be outside the slice — it is the thing the broken
    // regex used to start from.
    expect(block).not.toContain('expire-stale-holds')
  })

  it('exports the scan the job drives', () => {
    expect(serverBarrel).toContain(
      'export async function scanBookingReminders(',
    )
  })

  it('registers at module scope, not inside a register* function', () => {
    // The runner route reaches jobs through `ensureAll(['tenantApi'])`, so a
    // registration inside `registerBookingsApi` would never enter the
    // registry the beat reads. This is the AGL-2227 lesson, asserted rather
    // than trusted.
    const lastJob = serverBarrel.lastIndexOf('registerPluginJob({')
    const firstRegisterFn = serverBarrel.indexOf('export function register')
    expect(lastJob).toBeGreaterThan(-1)
    expect(firstRegisterFn).toBeGreaterThan(-1)
    expect(lastJob).toBeLessThan(firstRegisterFn)
  })

  it('the route no longer claims a scheduler it does not have', () => {
    // The exact sentence that let this stay dark for as long as it has
    // existed: a docblock asserting the wiring instead of having it.
    expect(serverBarrel).not.toContain('invoke hourly from the scheduler')
  })

  it('the manual HTTP door survives the extraction', () => {
    // Losing the cron-secret route while gaining the beat would be a
    // different regression — ops still needs to force a pass.
    expect(serverBarrel).toContain(`registerPluginApiRoute('bookings/reminders'`)
    expect(serverBarrel).toContain('x-cron-secret')
  })

  it('the scan tests each booking with the shared predicate', () => {
    // Not a local copy of the three conditions. If the scan re-implements
    // them, the card's count and the sender's behaviour drift silently —
    // which is the whole reason the predicate was lifted into the model.
    const scan = /export async function scanBookingReminders\([\s\S]*?\n\}\n/.exec(
      serverBarrel,
    )
    expect(scan).not.toBeNull()
    expect(scan?.[0]).toContain('isBookingReminderDue(')
  })

  it('takes ONE instant for the query bounds and the predicate', () => {
    // Two `Date.now()` calls would put a booking sitting on an edge inside
    // the query and outside the test: fetched, skipped, and reported as a
    // `skipped` nobody could explain.
    const scan = /export async function scanBookingReminders\([\s\S]*?\n\}\n/.exec(
      serverBarrel,
    )?.[0]
    expect(scan).toContain('const nowMs = Date.now()')
    expect(scan).toContain('nowMs + REMINDER_WINDOW_START_HOURS')
    expect(scan).toContain('nowMs + REMINDER_WINDOW_END_HOURS')
    // Exactly one clock read in the whole pass — counted over CODE only.
    // Counting the raw text made this fail on the comment directly above,
    // which names `Date.now()` to explain why there is one of them; a guard
    // that a comment can break is a guard a comment can also satisfy.
    const code = scan
      ?.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code?.match(/Date\.now\(\)/g)?.length).toBe(1)
  })
})

describe('AGL-2431 · the shared window predicate', () => {
  it('is a real two-hour band around 24 hours out', () => {
    expect(REMINDER_WINDOW_START_HOURS).toBe(23)
    expect(REMINDER_WINDOW_END_HOURS).toBe(25)
  })

  it('mails a confirmed, unreminded booking inside the band', () => {
    expect(isBookingReminderDue(dueBooking(), NOW)).toBe(true)
  })

  it('includes both edges of the band', () => {
    // Exclusive edges would drop a booking that lands exactly on the
    // boundary the query itself includes (`>=` / `<=`), so the pass would
    // fetch it and refuse it.
    expect(
      isBookingReminderDue(dueBooking({ startsAtMs: NOW + 23 * HOUR }), NOW),
    ).toBe(true)
    expect(
      isBookingReminderDue(dueBooking({ startsAtMs: NOW + 25 * HOUR }), NOW),
    ).toBe(true)
  })

  it('refuses a booking outside the band on either side', () => {
    expect(
      isBookingReminderDue(dueBooking({ startsAtMs: NOW + 22 * HOUR }), NOW),
    ).toBe(false)
    expect(
      isBookingReminderDue(dueBooking({ startsAtMs: NOW + 26 * HOUR }), NOW),
    ).toBe(false)
  })

  it('refuses a canceled booking, an already-reminded one, and one with no address', () => {
    expect(isBookingReminderDue(dueBooking({ status: 'canceled' }), NOW)).toBe(
      false,
    )
    expect(
      isBookingReminderDue(dueBooking({ reminderSentAt: 1 }), NOW),
    ).toBe(false)
    expect(isBookingReminderDue(dueBooking({ email: '' }), NOW)).toBe(false)
  })

  it('is not a constant — the negative cases are reached individually', () => {
    // A predicate stuck at `true` passes every positive case above, and one
    // stuck at `false` passes every negative. Both directions are asserted
    // over the SAME base booking, so the only difference between a true and
    // a false here is the single field each case changes.
    const base = dueBooking()
    expect(isBookingReminderDue(base, NOW)).toBe(true)
    expect(isBookingReminderDue({ ...base, status: 'canceled' }, NOW)).toBe(
      false,
    )
  })
})

describe('AGL-2431 · the merchant can see the reminder queue', () => {
  const page = body('components/bookings-console-page.tsx')

  it('counts the queue with the SENDER\'s predicate, not its own', () => {
    // A card that re-derived the window would report a depth the beat does
    // not act on — a number that looks authoritative and is not.
    expect(page).toContain('isBookingReminderDue(')
    expect(page).not.toMatch(/23\s*\*\s*60\s*\*\s*60/)
  })

  it('asks about one instant, like the pass does', () => {
    expect(page).toContain('const reminderNowMs = Date.now()')
    expect(page).toContain('isBookingReminderDue(booking, reminderNowMs)')
  })

  it('RENDERS the counts, rather than only computing them', () => {
    // The failure this whole issue is about is a capability that exists and
    // reaches nobody. A computed count that no JSX prints is that defect
    // reproduced inside the fix.
    expect(page).toContain('24-hour reminders')
    expect(page).toContain('${reminderQueue} due in the next pass')
    expect(page).toContain('${remindersSent} already sent')
  })

  it('points its help at the reminders heading, not the card\'s', () => {
    // Presence is not correctness. The card's own help anchors `#manage`,
    // which is right for a bookings list and wrong for the one line about
    // timing and the once-only rule. A coverage check that only asks
    // "is there a help affordance" passes either way.
    expect(page).toContain(
      "pluginDocsHelp('bookings', { anchor: '#reminders' })",
    )
    expect(PLUGIN_DOCS_ANCHORS.bookings).toContain('#reminders')
  })

  it('imports the predicate from the model, not from the server barrel', () => {
    // `server.ts` loads firebase-admin at module scope; importing it into a
    // client component would pull the Admin SDK into the browser bundle.
    expect(source('components/bookings-console-page.tsx')).toContain(
      "import { type HostBookingService, isBookingReminderDue } from '../model'",
    )
    expect(source('components/bookings-console-page.tsx')).not.toContain(
      "from '../server'",
    )
  })
})
