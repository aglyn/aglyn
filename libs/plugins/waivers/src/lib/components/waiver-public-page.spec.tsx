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

import { act, render, screen } from '@testing-library/react'
import { WaiverPublicPage, waiverPageNavigation } from './waiver-public-page.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

/**
 * A share link handed out before links opened on the store's own site
 * (AGL-4042), at the console's `/kiosk/waivers/sign?host=…&waiver=…`: it
 * still works, by sending the signer on to the store's signing page, and a
 * site with no public address is still signed right here.
 */

const replace = jest.spyOn(waiverPageNavigation, 'replace').mockImplementation(() => undefined)
let answers: Array<Record<string, unknown>> = []
const asked: string[] = []

beforeEach(() => {
  replace.mockClear()
  asked.length = 0
  answers = []
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    asked.push(String(url))
    const body = answers.shift() ?? {}
    return { ok: true, status: 200, json: async () => body }
  }) as never
})

async function open(search: string) {
  window.history.pushState({}, '', `/kiosk/waivers/sign${search}`)
  await act(async () => {
    render(<WaiverPublicPage pluginId="waivers" path="/sign" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe('the old share link', () => {
  it('sends the signer on to the store’s own signing page for that waiver', async () => {
    answers = [{ signUrl: 'https://rides.example.com/sign-waiver?waiver=w1' }]
    await open('?host=h1&waiver=w1')
    expect(asked[0]).toBe('/api/waivers/public?hostId=h1&waiverId=w1')
    expect(replace).toHaveBeenCalledWith('https://rides.example.com/sign-waiver?waiver=w1')
  })

  it('signs here for a site with no public address', async () => {
    answers = [
      { signUrl: null },
      {
        site: { name: 'Acme Motocross' },
        waiver: { id: 'w1', version: 1, title: 'Rider release', body: 'Ride safe.', checkboxes: [], allowMinors: false, validityText: 'Good for one visit' },
        consent: { text: 'I agree.', version: 1 },
        adultAge: 18,
        signUrl: null,
      },
    ]
    await open('?host=h1&waiver=w1')
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Rider release' })).toBeTruthy()
  })

  it('says so when the link names no site', async () => {
    await open('?waiver=w1')
    expect(asked).toEqual([])
    expect(screen.getByText(/missing the waiver/)).toBeTruthy()
  })
})
