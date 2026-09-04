/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and the shared health lib this grades markers with
 * expects the node globals.
 *
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
 * THE BLOCKING FUNCTION'S DECISIONS REACH THE MONITOR (AGL-2583).
 *
 * `signupRefusalsHealth` reads `rateLimits/signupRefused_*` markers, and for
 * as long as the rate limiter was their only writer, the one check whose
 * literal subject is "signup refusals" could not see what was actually
 * happening: `beforeUserCreated` decides on the Identity Platform path, in
 * front of everything `consumeRateLimit` can observe. AGL-2581 spent three
 * days there, from launch day, with every monitor green.
 *
 * TWO EVENTS. A refusal (`locked`, or `held` on an earlier read) and an
 * admission made BLIND, where the lock could not be read at all. The second
 * refuses nobody, so no refusal threshold can see it — and it is the one that
 * says Firestore is failing on the account-creation path, which is the read
 * AGL-2581 was.
 *
 * The function now writes the marker itself. It cannot import the constants —
 * `cloud/functions` is a plain npm package outside the nx workspace that can
 * resolve only firebase-admin and firebase-functions, the same constraint
 * that gave `signups-lock.ts` its copied region — so this spec is what stops
 * the two ends drifting apart. A marker written under a collection, an id
 * prefix or a field name the reader does not query is indistinguishable from
 * no marker at all, which is the failure this whole issue is about.
 *
 * Every assertion is written to fail on a plausible edit: rename the field,
 * change the bucket size, drop the `await`, write the cause under a different
 * key, or let the retention drift, and exactly one of these reddens.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MAX_SIGNUP_REFUSALS_PER_WINDOW,
  SIGNUP_LOCK_UNREADABLE_FIELD,
  signupRefusalsHealth,
} from '@aglyn/aglyn/server'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const FUNCTION_INDEX = join(REPO_ROOT, 'cloud/functions/src/index.ts')
const RATE_LIMIT_STORE = join(
  REPO_ROOT,
  'libs/tenant/data/admin/src/lib/server/rate-limit-store.ts',
)
const source = readFileSync(FUNCTION_INDEX, 'utf8')
const store = readFileSync(RATE_LIMIT_STORE, 'utf8')

/**
 * A string constant's VALUE, read out of the library's source.
 *
 * Read as text rather than imported, because importing the admin barrel for
 * two string literals drags firebase-admin — and its open handles — into a
 * spec whose whole job is comparing two files. The comparison is the same
 * one either way: rename the constant on either side and this reddens.
 */
function libConstant(name: string): string {
  const match = store.match(
    new RegExp(`export const ${name} = '([^']*)'`),
  )
  if (match === null) {
    throw new Error(
      `${name} is gone from rate-limit-store.ts — the writer and the reader ` +
        'cannot be compared, so they cannot be trusted.',
    )
  }
  return match[1]
}

const RATE_LIMIT_COLLECTION = libConstant('RATE_LIMIT_COLLECTION')
const SIGNUP_REFUSAL_DOC_PREFIX = libConstant('SIGNUP_REFUSAL_DOC_PREFIX')

describe('AGL-2583 · the function writes what the check reads', () => {
  it('finds the writer at all — the positive control', () => {
    // Without this, a renamed helper would empty every assertion below and
    // the guard would pass by reading nothing.
    expect(source).toContain('async function recordSignupsLockEvent(')
  })

  it('writes into the collection the health probe queries', () => {
    expect(source).toContain(`const REFUSAL_COLLECTION = '${RATE_LIMIT_COLLECTION}'`)
  })

  it('uses the document-id prefix the health probe filters on', () => {
    // The probe filters `doc.id.startsWith(SIGNUP_REFUSAL_DOC_PREFIX)` after
    // the read. A different prefix means the markers are read and then
    // silently thrown away.
    expect(source).toContain(
      `const REFUSAL_DOC_PREFIX = '${SIGNUP_REFUSAL_DOC_PREFIX}'`,
    )
  })

  it('stamps refusedAtMs — the field the range query is served by', () => {
    // NOT `lastAtMs` (AGL-1679), NOT `erroredAtMs` (AGL-1921), NOT
    // `servedAtMs` (this issue's drought denominator). Four signals, four
    // disjoint indexes, so no signal's flood can fill another's read limit.
    expect(source).toMatch(/refusedAtMs: nowMs/)
    expect(source).not.toMatch(/recordSignupsLockEvent[\s\S]*?lastAtMs/)
  })

  it('carries the count and the per-cause split the verdict sums', () => {
    expect(source).toMatch(/\[field\]: FieldValue\.increment\(1\)/)
    expect(source).toMatch(/byReason: \{ \[cause\]: FieldValue\.increment\(1\) \}/)
  })

  it('counts a BLIND admission under its own field, never as a refusal', () => {
    // It refused nobody. Incrementing `refusals` for it would inflate the
    // wave count with events that are not refusals, and — worse — would hide
    // the blind decision inside a number the wave threshold already tolerates
    // fifty of.
    expect(source).toContain(
      `recordSignupsLockEvent('${SIGNUP_LOCK_UNREADABLE_FIELD}')`,
    )
    expect(source).toContain("recordSignupsLockEvent('refusals', verdict.cause)")
  })

  it('sets expiresAt, so the TTL policy sweeps these like every sibling', () => {
    // Without it the markers accumulate forever in a collection whose whole
    // cost model assumes they do not.
    expect(source).toMatch(/expiresAt: new Date\(nowMs \+ REFUSAL_RETENTION_MS\)/)
  })

  it('buckets by the minute, so concurrent refusals converge on one document', () => {
    expect(source).toContain('const REFUSAL_BUCKET_MS = 60_000')
  })

  it('AWAITS both writes — a function may be frozen the moment it returns', () => {
    // Fire-and-forget is right inside a long-lived server instance and wrong
    // here: an unawaited promise in a Cloud Function may never reach
    // Firestore, and a breadcrumb that lands only sometimes feeds an alarm a
    // silently low count.
    expect(source).toContain(
      "await recordSignupsLockEvent('refusals', verdict.cause)",
    )
    expect(source).toContain(
      `await recordSignupsLockEvent('${SIGNUP_LOCK_UNREADABLE_FIELD}')`,
    )
  })

  it('bounds the write, because `unreadable` means Firestore is already sick', () => {
    // The cause most worth recording is the one where the write is likeliest
    // to hang. An unbounded write here would burn the blocking function's
    // whole budget on a breadcrumb.
    expect(source).toContain('const REFUSAL_WRITE_TIMEOUT_MS')
    expect(source).toMatch(/signups lock marker write timed out/)
  })

  it('records the cause and nothing else — no email, no uid, no provider', () => {
    // The health body is public. The verdict itself is deliberately blind to
    // identity, and the marker must not quietly reintroduce it.
    // The function body alone: from its signature to the first unindented
    // closing brace. Reading past it would sweep in the surrounding prose and
    // assert on documentation rather than on code.
    const from = source.indexOf('async function recordSignupsLockEvent(')
    const writer = source.slice(from, source.indexOf('\n}\n', from))
    expect(writer).not.toMatch(/\bemail\b/)
    expect(writer).not.toMatch(/\buid\b/)
    expect(writer).not.toMatch(/tenantId/)
    expect(writer).not.toMatch(/providerId/)
  })

  it('passes the verdict cause straight through, with no translation', () => {
    // `signupsCreationVerdict` answers `locked` or `held`, and the check sums
    // both under the wave threshold. A cause renamed on the way out would
    // land under a key nothing grades — green forever.
    expect(source).toContain('verdict.cause')
    expect(SIGNUP_LOCK_UNREADABLE_FIELD).toBe('unreadable')
  })
})

describe('AGL-2583 · the two ends meet', () => {
  /**
   * A refusal marker as the function writes it, in the shape the source above
   * was just asserted to produce: one refusal, the cause under `byReason`,
   * `refusedAtMs` stamped.
   */
  const refusalAsWritten = (cause: string) => ({
    refusals: 1,
    byReason: { [cause]: 1 },
    refusedAtMs: Date.now(),
  })

  /** A blind admission as the function writes it: its own field, no refusal. */
  const blindAsWritten = () => ({
    [SIGNUP_LOCK_UNREADABLE_FIELD]: 1,
    refusedAtMs: Date.now(),
  })

  it('one blind decision turns the check RED', () => {
    // The end-to-end claim: what the blocking function writes is what the
    // monitor grades, and a single one of these is an alarm. Before this
    // issue the same event produced a log line and a green dashboard.
    const check = signupRefusalsHealth([blindAsWritten()], 7)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('signups-lock-unreadable')
    expect(check.lockUnreadable).toBe(1)
    // And it refused nobody, which is exactly why no refusal threshold on
    // this check could ever have caught it.
    expect(check.refusedSignups).toBe(0)
    expect(check.refusedSignups).toBeLessThan(MAX_SIGNUP_REFUSALS_PER_WINDOW)
  })

  it('a deliberate staff lock does not, however many there are', () => {
    // Pulling the signups lever must not page the person who pulled it.
    const check = signupRefusalsHealth([refusalAsWritten('locked')], 7)
    expect(check.ok).toBe(true)
    expect(check.lockUnreadable).toBe(0)
  })

  it('a refusal HELD on an earlier read does not either', () => {
    const check = signupRefusalsHealth([refusalAsWritten('held')], 7)
    expect(check.ok).toBe(true)
    expect(check.lockUnreadable).toBe(0)
  })

  it('a marker under a mistyped field would go unnoticed — the red control', () => {
    // Proof that the guards above are load-bearing rather than decorative:
    // change the field the function writes and the alarm silently stops
    // firing. This is the failure mode, asserted.
    const check = signupRefusalsHealth(
      [{ unredable: 1, refusedAtMs: Date.now() } as never],
      7,
    )
    expect(check.ok).toBe(true)
    expect(check.lockUnreadable).toBe(0)
  })
})
