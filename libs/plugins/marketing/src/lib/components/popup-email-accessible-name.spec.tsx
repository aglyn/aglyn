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
 * The email-capture popup's field must have an accessible NAME (AGL-2392).
 *
 * Sibling of the newsletter-block defect found on aglyn.com/blog: this input
 * carried a `placeholder` and nothing else. It is the worse of the two, because
 * the popup opens unbidden over whatever the visitor was reading — there is no
 * surrounding context for a screen-reader user to fall back on, and the
 * `role="dialog"` announcement gives them the popup's body copy, not the
 * field's purpose.
 *
 * The honeypot is asserted to stay OUT of the accessibility tree in the same
 * breath, because "give the email field a name" is one careless edit away from
 * naming the bait too — which would tell exactly the assistive-tech users who
 * must skip it that there is a second field to fill (AGL-1665).
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { PopupData } from '../model/site-contract'
import { MarketingSiteRuntime } from './site-runtime'

const POPUP: PopupData = {
  body: 'Join the list',
  trigger: 'delay',
  triggerValue: 0,
  frequencyDays: 30,
  collectEmail: true,
  contentHash: 'hash-agl-2382',
}

beforeEach(() => {
  window.localStorage.clear()
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ received: true }),
  })) as any
})

async function openPopup(): Promise<void> {
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
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
}

describe('the email-capture popup names its field (AGL-2392)', () => {
  it('exposes the email input to the accessibility tree by name', async () => {
    await openPopup()

    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeTruthy()
  })

  it('does not let the placeholder stand in for the name', async () => {
    // Negative control: before the fix this was the only string on the field,
    // so a name derived from it would mean nothing changed.
    await openPopup()

    expect(
      screen.queryByRole('textbox', { name: 'you@example.com' }),
    ).toBeNull()
  })

  it('leaves the honeypot nameless and out of the tree', async () => {
    await openPopup()

    // Exactly one named textbox: the real one. The `website` bait must not
    // have acquired a name alongside it.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(document.querySelector('input[name="website"]')).not.toBeNull()
  })
})
