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

import {
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  EMAIL_ATTRIBUTION_WINDOW_MS,
  emailTouchIsInWindow,
} from './email-revenue-window'

const DAY = 24 * 60 * 60 * 1000

describe('emailTouchIsInWindow', () => {
  it('states the window in days and milliseconds consistently', () => {
    expect(EMAIL_ATTRIBUTION_WINDOW_DAYS).toBe(7)
    expect(EMAIL_ATTRIBUTION_WINDOW_MS).toBe(7 * DAY)
  })

  it('credits a click from inside the window', () => {
    expect(emailTouchIsInWindow(1_000_000, 1_000_000 + 3 * DAY)).toBe(true)
  })

  it('refuses a click older than the window', () => {
    expect(emailTouchIsInWindow(1_000_000, 1_000_000 + 8 * DAY)).toBe(false)
  })

  it('includes both ends of the window it describes', () => {
    // An order in the same millisecond is a checkout from the landing page;
    // one exactly seven days later is inside a window called seven days.
    expect(emailTouchIsInWindow(1_000_000, 1_000_000)).toBe(true)
    expect(emailTouchIsInWindow(1_000_000, 1_000_000 + 7 * DAY)).toBe(true)
    expect(emailTouchIsInWindow(1_000_000, 1_000_000 + 7 * DAY + 1)).toBe(false)
  })

  it('refuses a click that happened AFTER the order', () => {
    // The failure this bound exists for: without it a campaign sent between
    // the sale and the webhook would take the credit for an order it could
    // not possibly have caused.
    expect(emailTouchIsInWindow(1_000_000 + 1, 1_000_000)).toBe(false)
  })

  it('refuses instants that are not instants', () => {
    expect(emailTouchIsInWindow(Number.NaN, 1_000_000)).toBe(false)
    expect(emailTouchIsInWindow(1_000_000, Number.NaN)).toBe(false)
    expect(emailTouchIsInWindow(0, 1_000_000)).toBe(false)
    expect(emailTouchIsInWindow(1_000_000, 0)).toBe(false)
  })

  it('takes a caller-supplied window, so a stored one can be re-applied', () => {
    expect(emailTouchIsInWindow(1_000_000, 1_000_000 + 8 * DAY, 30 * DAY)).toBe(
      true,
    )
  })
})
