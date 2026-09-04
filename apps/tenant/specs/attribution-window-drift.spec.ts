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
 * THE ATTRIBUTION WINDOW IS ONE NUMBER, DECLARED TWICE.
 *
 * `email-revenue-window.ts` holds it for the server joins; `campaign-touch.ts`
 * holds it for the visitor's browser, which decides there whether a remembered
 * touch has expired. Neither can import the other: `shared-util-email` is
 * `scope:shared` and reaches back into `@aglyn/aglyn`, so an edge the other
 * way closes a project cycle that `@nx/enforce-module-boundaries` refuses.
 * That is the same wall `email-media-src.ts` hit, and this is the same answer
 * `email-media-src-drift.spec.ts` gave it: a copy, held to the original by an
 * app spec that can import both sides.
 *
 * ## What drift would actually cost
 *
 * Not a rounding error. If the browser's copy were LONGER, a device would go
 * on sending touches the server refuses — a visitor who reads as attributed
 * on their own machine and as direct in every report, with nothing anywhere
 * saying why. If it were SHORTER, the browser would delete touches the server
 * would still have credited, and the conversions simply vanish. Both look
 * exactly like a campaign that under-performed.
 *
 * `windowDays` is stamped onto every record, so a change to the number is a
 * deliberate act with old records still readable — but it has to be the same
 * deliberate act on both sides, and that is what this asserts.
 */

import {
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  EMAIL_ATTRIBUTION_WINDOW_MS,
} from '@aglyn/shared-util-email/email-revenue-window'
import {
  ATTRIBUTION_WINDOW_DAYS,
  ATTRIBUTION_WINDOW_MS,
} from '@aglyn/aglyn/app-utils/campaign-touch'

describe('the browser and the server agree about the window', () => {
  it('is the same number of days on both sides', () => {
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(EMAIL_ATTRIBUTION_WINDOW_DAYS)
  })

  it('is the same number of milliseconds on both sides', () => {
    // Derived independently on each side, so this catches a copy that got the
    // days right and the arithmetic wrong.
    expect(ATTRIBUTION_WINDOW_MS).toBe(EMAIL_ATTRIBUTION_WINDOW_MS)
  })

  it('is a real window, not zero', () => {
    // The floor. Two copies of `0` would agree with each other perfectly and
    // attribute nothing at all, which is the shape a stubbed constant takes.
    expect(ATTRIBUTION_WINDOW_DAYS).toBeGreaterThan(0)
    expect(ATTRIBUTION_WINDOW_MS).toBe(
      ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
  })
})
