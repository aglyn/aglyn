/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * `LockdownNotice` renders the WHOLE parsed 423 (AGL-1558).
 *
 * The defect this pins: `parseLockdownRefusal` returns
 * `{title, message, contact?, until?, …}` and `lockdownRefusalText` — the
 * one-line flattener every snackbar surface uses — emits `title — message
 * [until]` and drops `contact` entirely. `contact` is the "how do I get out
 * of this" affordance, and the SERVER goes out of its way to protect it: a
 * staff-typed custom message replaces the notice BODY only, so `title` and
 * `contact` stay per-reason constants a hurried staff member cannot strip.
 * The client then threw it away anyway.
 *
 * Every fixture below is built by feeding a real server body — assembled the
 * way `lockdownJsonResponse` assembles it, from `lockdownNotice` — through
 * the real `parseLockdownRefusal`. Nothing here hand-writes the copy, so a
 * change to either half of the wire contract lands in this spec rather than
 * passing against a stale fixture.
 *
 * Rendering only; driving the billing page that mounts it is AGL-1557.
 */

import {
  lockdownNotice,
  lockdownRefusalText,
  parseLockdownRefusal,
  type LockdownRefusalNotice,
  type LockdownState,
} from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import LockdownNotice from '../components/lockdown-notice.component'

/**
 * The 423 body a chokepoint actually emits, mirroring
 * `lockdownJsonResponse` — which lives in the admin lib and drags the Admin
 * SDK in with it. The body construction is what matters here, and it is one
 * spread of `lockdownNotice`, the same pure builder the server calls.
 */
function refusalBody(state: LockdownState): Record<string, unknown> {
  const notice = lockdownNotice(state)
  return {
    error: 'locked',
    scope: state.scope,
    ...(state.feature ? { feature: state.feature } : {}),
    reason: state.reason,
    title: notice.title,
    message: notice.body,
    ...(notice.contact ? { contact: notice.contact } : {}),
    ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
  }
}

function parsed(state: LockdownState): LockdownRefusalNotice {
  const notice = parseLockdownRefusal(423, refusalBody(state))
  if (!notice) throw new Error('a 423 must always parse to a notice')
  return notice
}

const CHECKOUT_LOCK: LockdownState = {
  scope: 'feature',
  feature: 'checkout',
  reason: 'maintenance',
}

describe('AGL-1558 · LockdownNotice renders the fields the snackbar drops', () => {
  it('renders the support contact as a real mailto link', () => {
    const notice = parsed(CHECKOUT_LOCK)
    // The premise: the flattener the snackbar surfaces use loses it.
    expect(notice.contact).toBe('support@aglyn.com')
    expect(lockdownRefusalText(notice)).not.toContain('support@aglyn.com')

    render(<LockdownNotice notice={notice} />)
    const link = screen.getByRole('link', { name: 'support@aglyn.com' })
    expect(link.getAttribute('href')).toBe('mailto:support@aglyn.com')
  })

  it('renders the title and the honest checkout body', () => {
    render(<LockdownNotice notice={parsed(CHECKOUT_LOCK)} />)
    expect(
      screen.getByText('Checkout is temporarily unavailable'),
    ).toBeTruthy()
    // The sentence this whole affordance exists for: a paused checkout is
    // NOT a declined card, and the notice has to say so in words.
    expect(screen.getByText(/this is not a payment failure/i)).toBeTruthy()
  })

  it('renders the expiry as its own line, in local time, never a UTC blob', () => {
    const untilMs = Date.parse('2026-09-01T12:00:00Z')
    const notice = parsed({ ...CHECKOUT_LOCK, untilMs })
    render(<LockdownNotice notice={notice} />)

    const expected = notice.until as string
    expect(expected).toMatch(/^Expected back around /)
    // A distinct element, not glued onto the message — the parser strips the
    // server's UTC "Expected back by …" suffix precisely so it can be
    // restated here on the reader's own clock.
    const line = screen.getByText(expected)
    expect(line.textContent).toBe(expected)
    expect(
      screen.queryByText(new Date(untilMs).toUTCString(), { exact: false }),
    ).toBeNull()
  })

  it('a staff-typed message keeps the contact affordance', () => {
    // The server-side guarantee, verified end to end through the client:
    // `message` is the only field staff can type, and the contact line is
    // built outside its reach.
    const notice = parsed({
      ...CHECKOUT_LOCK,
      message: 'Back once the payment provider incident clears.',
    })
    render(<LockdownNotice notice={notice} />)
    expect(
      screen.getByText('Back once the payment provider incident clears.'),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'support@aglyn.com' })
        .getAttribute('href'),
    ).toBe('mailto:support@aglyn.com')
  })

  it('omits the contact line when the notice carries none', () => {
    // A platform maintenance window has no contact by design — the notice
    // must not invent one, and must not render an orphaned "Questions?".
    const notice = parsed({ scope: 'platform', reason: 'maintenance' })
    expect(notice.contact).toBeUndefined()
    render(<LockdownNotice notice={notice} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Questions\?/)).toBeNull()
  })

  it('omits the expiry line when the lock has no end', () => {
    const { container } = render(<LockdownNotice notice={parsed(CHECKOUT_LOCK)} />)
    expect(screen.queryByText(/Expected back/)).toBeNull()
    // …and never the word `undefined`, the failure mode the fallback copy
    // exists to prevent.
    expect(container.textContent).not.toContain('undefined')
  })

  it('renders nothing without a notice', () => {
    const { container } = render(<LockdownNotice notice={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('announces itself — the reader may not be looking at it', () => {
    render(<LockdownNotice notice={parsed(CHECKOUT_LOCK)} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
