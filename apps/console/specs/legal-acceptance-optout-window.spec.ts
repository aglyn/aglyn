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
 * The opt-out window the code computes IS the one the Terms publish
 * (AGL-2316).
 *
 * `ARBITRATION_OPT_OUT_DAYS` is a number in a TypeScript file; §18.5 is a
 * sentence on a page a customer read. Nothing structurally ties them, and a
 * later publish that changes "30 days" to "60 days" would leave the console
 * confidently telling staff a window had closed a month before it had — a
 * wrong answer delivered with a date on it, which is worse than no answer.
 *
 * So the number is re-read out of the immutable snapshot for the CURRENT
 * version. The snapshots are captured from the live page after publication
 * (legal documents here are publication-first — they are besigner content,
 * never hand-written into this repo), so this reads what was actually served.
 *
 * Reading from `LEGAL_DOCUMENT_VERSION` rather than a pinned `v6` folder is
 * the point: the guard follows the next publish instead of going stale beside
 * it, and a version bump that changes the clause fails HERE, at the bump,
 * rather than in a dispute.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
// The SOURCE module, not the `@aglyn/tenant-data-admin` barrel: the barrel
// pulls `next/cache` in through the render-cache module, which needs a Next
// request context this plain node spec has no business standing up.
//
// That relative path is what `@nx/enforce-module-boundaries` forbids, and it
// fails as an ERROR rather than a warning — `console:lint` was red on main
// from the moment this landed (AGL-2387). Suppressed at the line rather than
// satisfied, because satisfying it means importing the barrel, which is the
// one thing the paragraph above says not to do. Same call, and the same
// spelling, as the five other places this repo makes it: both middlewares,
// `csp-img-src-report-only.spec.ts` and `csp-script-src-report-only.spec.ts`
// next door, and the generated plugin manifests.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ARBITRATION_OPT_OUT_DAYS } from '../../../libs/tenant/data/admin/src/lib/server/legal-acceptance'
import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'

jest.mock('firebase-admin/firestore', () => ({ FieldValue: {} }))
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({ __esModule: true, default: {} }),
)

const termsPath = join(
  __dirname,
  '..',
  'constants',
  'legal',
  LEGAL_DOCUMENT_VERSION,
  'terms.txt',
)

describe('AGL-2316 · §18.5 as published vs §18.5 as computed', () => {
  it('reads the same number of days out of the snapshot the users were shown', () => {
    // Whitespace-normalised: the snapshot is the published page's text, where
    // the number sits on its own line inside a run of emphasis markup.
    const terms = readFileSync(termsPath, 'utf8').replace(/\s+/g, ' ')
    const clause =
      /opt out of arbitration[\s\S]{0,160}?within (\d+) days of first accepting these Terms/i.exec(
        terms,
      )
    // A null match is a failure too: the clause moving or being reworded is
    // exactly the change this guard exists to notice.
    expect(clause).not.toBeNull()
    expect(Number(clause?.[1])).toBe(ARBITRATION_OPT_OUT_DAYS)
  })

  it('measures the window from FIRST accepting, as the clause words it', () => {
    const terms = readFileSync(termsPath, 'utf8').replace(/\s+/g, ' ')
    // "of first accepting these Terms" — not "of your most recent
    // acceptance". The evaluator runs the clock from the earliest record for
    // this reason, and this pins the wording that justifies it.
    expect(terms).toContain('of first accepting these Terms')
  })
})
