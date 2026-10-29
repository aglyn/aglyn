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

import { render, screen } from '@testing-library/react'
import { WaiversConsolePage } from './waivers-console-page'

let mockBusinessContact: string | null | undefined = null

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('./use-site-waivers', () => ({
  useSiteWaivers: () => ({
    waivers: [],
    signPageOrigin: null,
    businessContact: mockBusinessContact,
    error: null,
    reload: jest.fn(),
  }),
}))
// The cards have their own specs; here only the page around them matters.
jest.mock('./signatures-card.component', () => ({ SignaturesCard: () => <div>{'Signatures'}</div> }))
jest.mock('./waivers-list-card.component', () => ({ WaiversListCard: () => <div>{'Waivers'}</div> }))
jest.mock('./hand-over-screen.component', () => ({ HandOverScreen: () => null }))
jest.mock('./waiver-editor.component', () => ({ WaiverEditor: () => null }))

/**
 * The e-sign consent tells signers to contact the business for a paper copy
 * or to withdraw. A site that names no contact gets told so on the Waivers
 * page, with the way to its Setup details, instead of signers being told to
 * contact nobody.
 */
const page = () =>
  render(<WaiversConsolePage hostId="track" basePath="/acme/hosts/acme-track/waivers" permissions={{ manageWaivers: true }} entitled />)

describe('the Waivers page', () => {
  it('asks for a support email when signers have no way to reach the business', () => {
    mockBusinessContact = null
    page()
    expect(screen.getByText(/Signers can’t see how to reach you/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add a support email' }).getAttribute('href')).toBe(
      '/acme/hosts/acme-track/setup/details',
    )
  })

  it('says nothing once the site has a contact, or before it is read', () => {
    mockBusinessContact = 'hello@example.com'
    const { unmount } = page()
    expect(screen.queryByText(/Signers can’t see how to reach you/)).toBeNull()
    unmount()
    mockBusinessContact = undefined
    page()
    expect(screen.queryByText(/Signers can’t see how to reach you/)).toBeNull()
  })
})
