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
 * The email-capture popup BAITS the form honeypot rather than satisfying it
 * (AGL-1665, split out of AGL-1655).
 *
 * `/api/forms/submit` drops a submission only when the `website` field comes
 * back NON-empty. The popup used to hardcode `website: ''` into the request
 * body, which is why this was never a rejection bug — nothing the popup sent
 * was ever dropped. It was the opposite: with no field on the page to fill
 * and no value a script could set, the check could not fire, so the one
 * overlay that appears unprompted on every page was the only form surface on
 * the site with no honeypot behind it.
 *
 * Two contracts, and the first is the one that was missing:
 *
 *  1. THE BAIT EXISTS. A hidden `website` input is rendered, off-screen and
 *     `aria-hidden`, the same shape `libs/plugins/mui/.../form.tsx` renders —
 *     so a form-filling bot meets the same field it meets on the site form.
 *  2. IT IS FORWARDED UNJUDGED. Whatever lands in that input is what gets
 *     POSTed. The client never decides; `/api/forms/submit` is the single
 *     place that does, and a client that filtered would be back to sending a
 *     constant.
 *
 * The empty-field case is asserted too, because "always sends the typed
 * value" must not have been bought by breaking the ordinary human path.
 *
 * jsdom has no `navigator.sendBeacon`, so the impression beacon throws into
 * the component's own catch — `fetch` here sees form posts only.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PopupData } from '../model/site-contract'
import { MarketingSiteRuntime } from './site-runtime'

const POPUP: PopupData = {
  body: 'Join the list',
  // Fires on the next macrotask — no scroll or exit-intent to simulate.
  trigger: 'delay',
  triggerValue: 0,
  frequencyDays: 30,
  collectEmail: true,
  contentHash: 'hash-agl-1665',
}

let posted: Array<Record<string, any>>

beforeEach(() => {
  posted = []
  window.localStorage.clear()
  global.fetch = jest.fn(async (_input: any, init: any) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    return { ok: true, json: async () => ({ received: true }) }
  }) as any
})

const mountPopup = () =>
  render(
    <MarketingSiteRuntime
      hostId="host-1"
      screens={{}}
      page={{
        announcementBar: null,
        popup: POPUP,
        experiments: [],
        automationOverlays: null,
        clientAutomations: [],
      }}
    />,
  )

/** The off-screen bait, addressed the way a form-filling bot would find it. */
const honeypot = (): HTMLInputElement | null =>
  document.querySelector('input[name="website"]')

async function openPopup(): Promise<void> {
  mountPopup()
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
}

function submitEmail(value = 'ada@example.test'): void {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value },
  })
  fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest(
    'form',
  ) as HTMLFormElement)
}

describe('the email-capture popup presents the form honeypot (AGL-1665)', () => {
  it('renders a hidden `website` field for a bot to fall into', async () => {
    await openPopup()

    const field = honeypot()
    expect(field).not.toBeNull()
    // Off-screen, not `display:none` — the naive bots this check is aimed at
    // skip fields they can tell are hidden.
    expect(field?.style.position).toBe('absolute')
    expect(field?.style.left).toBe('-5000px')
    // …and never announced to anyone using the page for real.
    expect(field?.getAttribute('aria-hidden')).toBe('true')
    expect(field?.tabIndex).toBe(-1)
  })

  it('forwards whatever was typed into it, unjudged', async () => {
    await openPopup()

    // A bot filling every input it finds — the exact behaviour the route's
    // check exists to catch.
    fireEvent.change(honeypot() as HTMLInputElement, {
      target: { value: 'http://spam.example' },
    })
    submitEmail()

    await waitFor(() => expect(posted.length).toBe(1))
    // Non-empty, so `/api/forms/submit` drops it. Before this fix the popup
    // sent a constant `''` and the route had nothing to act on.
    expect(posted[0]['website']).toBe('http://spam.example')
    // The rest of the submission is unchanged — this is still the capture
    // that feeds the inbox and contacts.
    expect(posted[0]['formName']).toBe('Popup')
    expect(posted[0]['fields']).toEqual({ email: 'ada@example.test' })
  })

  it('still sends an empty honeypot for a visitor who never touched it', async () => {
    await openPopup()
    submitEmail('grace@example.test')

    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0]['website']).toBe('')
    expect(posted[0]['fields']).toEqual({ email: 'grace@example.test' })
    // The human path is untouched: the thank-you replaces the form.
    await waitFor(() =>
      expect(screen.getByText('Thanks — you are on the list!')).toBeTruthy(),
    )
  })
})
