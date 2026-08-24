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
 * What a REVOKED device's already-open tab can still do must not drift from
 * what we TELL people it can still do (AGL-1881).
 *
 * ## The failure this exists to prevent, which had already happened
 *
 * `30987974e` wired a server-wide revocation check into every API door and,
 * in the same change, rewrote the customer-facing sentence to read:
 *
 *     a tab that is *already open* ... can keep READING your workspace's data
 *     directly for up to an hour ... **It cannot change anything.**
 *
 * The first half is right. The second half was never true, and nothing
 * checked it. Firestore security rules key on the ID TOKEN, and this repo's
 * rules contain no assertion about revocation at all — no `auth_time`, no
 * `tokensValidAfterTime`. So for the remaining lifetime of that token the tab
 * keeps every client WRITE the account already had: publishing, content
 * edits, media metadata, presence and co-editing. The RTDB rules are the same
 * shape (`presence`/`coedit` grant `.write` off token claims).
 *
 * Object storage is the one place the promise held, and it holds for a
 * different reason: `firebase-storage.rules` denies the client outright, so
 * there is no client write to survive.
 *
 * That sentence is a SECURITY PROMISE on a public docs page, and it was
 * relied on twice over — the staff-console runbook told operators to say the
 * same thing to a customer whose laptop had just been stolen.
 *
 * ## Why this is a two-way lock, not a word blocklist
 *
 * Every case asserts the CAPABILITY first and the COPY second, because a
 * blocklist alone would pass if the copy were simply deleted, and would
 * become wrong the day somebody legitimately closes the gap.
 *
 * The capability anchor is: do the rules assert anything about revocation?
 *
 *  - While they do NOT, the copy must not claim the residual is read-only,
 *    and must positively say the tab can still CHANGE data.
 *  - The day someone lands the `auth_time` assertion that would make the
 *    original sentence true, this file goes red on the anchor and names every
 *    surface whose copy may then be narrowed back — rather than leaving four
 *    now-pessimistic surfaces to be found by hand.
 *
 * The storage carve-out is pinned the same way round, so "uploaded files are
 * the exception" cannot outlive a rules change that opens the bucket.
 *
 * PLANTED RED (verified — see the commit message):
 *   1. restore "It cannot change anything" to the customer doc  reddens
 *   2. revert the staff runbook line to "may keep reading data" reddens
 *   3. revert either console dialog string to "reading data"    reddens
 *   4. stub the rules text as if it asserted `auth_time`        reddens
 *      (the two-way half: the anchor flips and demands the copy narrow)
 *   5. point a surface at a path that does not exist            reddens
 *      (anti-vacuity: a sweep matching nothing must not pass)
 *   6. open the storage rules to the client                     reddens
 *      (so "uploaded files are the exception" cannot outlive the deny)
 *
 * Each was planted against a COPY of the tree in a scratch directory, never
 * by mutating the shared checkout; the scratch mirror was confirmed green
 * first, so the reds are the plants and not the mirror.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

const read = (relativePath: string): string =>
  readFileSync(resolve(ROOT, relativePath), 'utf8')

/**
 * Prose in this repo is hard-wrapped and carries markdown emphasis, and the
 * console strings are split across source lines by the formatter. A phrase
 * check against the raw bytes therefore passes or fails on where a line
 * happened to break — which is not a fact about the copy. Normalising first
 * is what makes these assertions about MEANING: emphasis markers dropped,
 * every run of whitespace collapsed to one space, lowercased.
 *
 * This is not cosmetic. The first run of this file went red on exactly that:
 * the customer doc says "**up to an hour**" across a line break, and the
 * anti-vacuity case could not see it.
 */
const normalize = (text: string): string =>
  text
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

const readNormalized = (relativePath: string): string =>
  normalize(read(relativePath))

/**
 * The rules files that decide what a still-valid-but-revoked ID token can do
 * against the databases directly, with no server of ours in the path.
 */
const FIRESTORE_RULES = 'cloud/firebase-firestore.rules'
const RTDB_RULES = 'cloud/firebase-database.rules.json'
const STORAGE_RULES = 'cloud/firebase-storage.rules'

/**
 * Every surface that describes the residual. Four, because this promise is
 * made to the customer, to the operator who repeats it to the customer, and
 * twice in the console at the moment of the click.
 */
const SURFACES = [
  'apps/docs/docs/workspace-and-billing/signing-in-and-sessions.md',
  'apps/docs/docs/staff-console/overview.md',
  'apps/docs/docs/staff-console/lockdown.md',
  'apps/console/components/recent-sign-ins-card.component.tsx',
] as const

/**
 * Present-tense claims that the residual is read-only. Deliberately phrased
 * as assertions about what the tab CAN do today, so that a surface narrating
 * the history ("we used to say it could only read") does not trip this.
 */
const READ_ONLY_CLAIMS = [
  'cannot change anything',
  "can't change anything",
  'keep reading data for up to an hour',
  "keep reading your workspace's data",
  'keep reading the database',
] as const

/**
 * Proof a surface says the residual includes writes, not just reads. Matched
 * against the normalised text, so a re-wrap cannot silence them.
 */
const WRITE_ADMISSIONS = [
  'and to change it',
  'changing data',
  'reading and writing',
  'not read-only',
] as const

/** Does any rules layer condition a client operation on the session's age? */
function rulesAssertRevocation(): boolean {
  const text = read(FIRESTORE_RULES) + read(RTDB_RULES)
  return /auth_time|tokensValidAfterTime/.test(text)
}

/** Is the client denied at the storage rules layer outright? */
function storageDeniesClient(): boolean {
  return /allow read,\s*write:\s*if false/.test(read(STORAGE_RULES))
}

describe('a revoked device’s residual access, and what we say about it', () => {
  it('reads every surface it claims to check (anti-vacuity)', () => {
    for (const surface of SURFACES) {
      const text = readNormalized(surface)
      expect(text.length).toBeGreaterThan(200)
      // Each surface must actually be talking about this, or the sweeps below
      // are asserting nothing about a file that merely exists.
      expect({ surface, mentions: text.includes('up to an hour') }).toEqual({
        surface,
        mentions: true,
      })
    }
  })

  it('the rules still carry no revocation assertion, so the residual includes writes', () => {
    // THE ANCHOR. If this flips, the copy assertions below invert: see the
    // two-way-lock note in the file header.
    expect(rulesAssertRevocation()).toBe(false)
  })

  it('the client is denied at the storage rules layer, so uploads are the one exception', () => {
    expect(storageDeniesClient()).toBe(true)
  })

  it('no surface claims the residual is read-only', () => {
    if (rulesAssertRevocation()) {
      throw new Error(
        'The rules now assert revocation (auth_time / tokensValidAfterTime). ' +
          'The residual may genuinely be read-only. Re-read every surface in ' +
          'SURFACES and narrow the copy deliberately, then invert this case.',
      )
    }
    for (const surface of SURFACES) {
      const text = readNormalized(surface)
      for (const claim of READ_ONLY_CLAIMS) {
        expect({ surface, claim, present: text.includes(claim) }).toEqual({
          surface,
          claim,
          present: false,
        })
      }
    }
  })

  it('every surface positively says the tab can still change data', () => {
    for (const surface of SURFACES) {
      const text = readNormalized(surface)
      const admits = WRITE_ADMISSIONS.some((phrase) => text.includes(phrase))
      expect({ surface, admits }).toEqual({ surface, admits: true })
    }
  })
})
