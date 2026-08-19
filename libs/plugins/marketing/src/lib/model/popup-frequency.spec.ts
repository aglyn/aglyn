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
 * AGL-2174 — the per-session frequency cap.
 *
 * `/product/marketing` sells "per-session frequency caps" in as many
 * words, twice. The only cap the product had was `Re-show after (days)`,
 * so a visitor who dismissed a popup did not see it again for a week — a
 * different promise, and not one anyone would call a session cap.
 *
 * The choice of STORE is the whole feature, which is why it is a named
 * function with a test rather than an `if` inside a React effect: the read
 * and the write have to agree, and a popup that checks `sessionStorage`
 * while stamping `localStorage` shows on every single page load.
 */

import { popupCapStore, popupSuppressed } from './overlays'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 18, 12, 0)

describe('popupCapStore', () => {
  it('sends a session cap to sessionStorage and a day cap to localStorage', () => {
    expect(popupCapStore({ oncePerSession: true })).toBe('session')
    expect(popupCapStore({})).toBe('local')
    expect(popupCapStore({ oncePerSession: false })).toBe('local')
  })
})

describe('popupSuppressed · per-session', () => {
  const popup = { oncePerSession: true, frequencyDays: 7 }

  it('shows once, then suppresses for the rest of the session', () => {
    expect(popupSuppressed(popup, { sessionFlag: null }, NOW)).toBe(false)
    expect(popupSuppressed(popup, { sessionFlag: '1' }, NOW)).toBe(true)
  })

  it('IGNORES the day stamp entirely', () => {
    // The two caps are alternative answers to the same question.
    // Honouring both would suppress a popup for the session and then for a
    // week on top — a setting reading "Once per session" behaving like
    // "once a week".
    expect(
      popupSuppressed(
        popup,
        { lastShownMs: NOW - 1000, sessionFlag: null },
        NOW,
      ),
    ).toBe(false)
  })

  it('is not suppressed by an empty-string flag', () => {
    expect(popupSuppressed(popup, { sessionFlag: '' }, NOW)).toBe(false)
  })
})

describe('popupSuppressed · per-day', () => {
  const popup = { frequencyDays: 7 }

  it('suppresses inside the window and releases after it', () => {
    expect(popupSuppressed(popup, { lastShownMs: NOW - 2 * DAY }, NOW)).toBe(
      true,
    )
    expect(popupSuppressed(popup, { lastShownMs: NOW - 8 * DAY }, NOW)).toBe(
      false,
    )
  })

  it('shows a popup a visitor has never dismissed', () => {
    expect(popupSuppressed(popup, {}, NOW)).toBe(false)
    expect(popupSuppressed(popup, { lastShownMs: 0 }, NOW)).toBe(false)
    expect(popupSuppressed(popup, { lastShownMs: null }, NOW)).toBe(false)
  })

  it('treats a missing day count as no cap', () => {
    // The enricher floors it at 1, but a doc written before that can carry
    // 0. This is a property of the comparison rather than a branch — see
    // the note in `popupSuppressed` — so it is asserted, not guarded.
    expect(
      popupSuppressed({ frequencyDays: 0 }, { lastShownMs: NOW - 1000 }, NOW),
    ).toBe(false)
    expect(popupSuppressed({}, { lastShownMs: NOW - 1000 }, NOW)).toBe(false)
  })

  it('ignores a session flag left over from a settings change', () => {
    // An author who switches a popup back from session to days must not
    // leave every visitor who saw it permanently suppressed.
    expect(
      popupSuppressed(popup, { sessionFlag: '1', lastShownMs: 0 }, NOW),
    ).toBe(false)
  })
})
