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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EMPTY_REVIEW_PLATFORMS_SETTINGS } from '../model/review-platforms-settings'
import { ReviewPlatformsOrderWidget } from './review-platforms-order-widget.component'
import { ReviewPlatformsSettingsCards } from './review-platforms-settings-card.component'

/**
 * The console widgets review platforms put in commerce's zones. Trustpilot's
 * card is always drawn — its invitation address needs nothing of the
 * deployment — while the API mode and the Yotpo card appear only where the
 * deployment can keep a key. Credentials go in and are never shown back.
 */

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./review-platforms-api', () => ({
  useReviewPlatformsFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const BCC = 'candles.example+a1b2c3@invite.trustpilot.com'

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
})

describe('ReviewPlatformsSettingsCards', () => {
  it('offers Trustpilot by its invitation address alone where no key can be kept', async () => {
    request.mockResolvedValue({ settings: EMPTY_REVIEW_PLATFORMS_SETTINGS })
    render(<ReviewPlatformsSettingsCards hostId="host-1" />)
    expect(await screen.findByText('Trustpilot')).toBeTruthy()
    expect(screen.queryByText('Yotpo Reviews')).toBeNull()
    expect(screen.getByTestId('review-platforms-trustpilot-status').textContent).toBe('Off')
    fireEvent.mouseDown(screen.getByLabelText('How Trustpilot hears about orders'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Off', 'Copy an order email to my Trustpilot invitation address'])
  })

  it('saves the invitation address from the card’s header', async () => {
    request.mockResolvedValue({ settings: EMPTY_REVIEW_PLATFORMS_SETTINGS })
    render(<ReviewPlatformsSettingsCards hostId="host-1" />)
    fireEvent.mouseDown(await screen.findByLabelText('How Trustpilot hears about orders'))
    fireEvent.click(screen.getByRole('option', { name: 'Copy an order email to my Trustpilot invitation address' }))
    fireEvent.change(screen.getByLabelText('Trustpilot invitation address'), { target: { value: BCC } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('review-platforms/settings', {
        body: { hostId: 'host-1', change: { platform: 'trustpilot', mode: 'bcc', bccAddress: BCC } },
      }),
    )
  })

  it('offers the API and Yotpo where a key can be kept, secrets as password fields', async () => {
    request.mockResolvedValue({
      settings: {
        ...EMPTY_REVIEW_PLATFORMS_SETTINGS,
        apiAvailable: true,
        trustpilot: { ...EMPTY_REVIEW_PLATFORMS_SETTINGS.trustpilot, mode: 'api', apiConnected: true, businessUnitId: 'abc12345' },
        yotpo: { enabled: true, connected: true, appKey: 'AbCdEf0123456789' },
      },
    })
    render(<ReviewPlatformsSettingsCards hostId="host-1" />)
    expect(await screen.findByText('Yotpo Reviews')).toBeTruthy()
    expect(screen.getByTestId('review-platforms-yotpo-status').textContent).toBe('On')
    expect(screen.getByLabelText('API secret').getAttribute('type')).toBe('password')
    expect((screen.getByLabelText('API secret') as HTMLInputElement).value).toBe('')
    expect(screen.getByLabelText('Secret key').getAttribute('type')).toBe('password')
    expect(screen.getByRole('button', { name: 'Disconnect API' })).toBeTruthy()
  })
})

describe('ReviewPlatformsOrderWidget', () => {
  it('draws nothing for an order no service was asked about', async () => {
    request.mockResolvedValue({ order: { trustpilot: null, yotpo: null } })
    const { container } = render(<ReviewPlatformsOrderWidget hostId="host-1" order={{ id: 'o-1' }} />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('says who was invited, and why not', async () => {
    request.mockResolvedValue({
      order: {
        trustpilot: { status: 'sent', via: 'bcc', atMs: 1, reason: null, error: null },
        yotpo: { status: 'skipped', via: null, atMs: 1, reason: 'no_consent', error: null },
      },
    })
    render(<ReviewPlatformsOrderWidget hostId="host-1" order={{ id: 'o-1' }} />)
    expect((await screen.findByTestId('review-platforms-trustpilot-invitation')).textContent).toBe('Invited')
    expect(screen.getByTestId('review-platforms-yotpo-invitation').textContent).toBe('Not invited')
    expect(screen.getByText('The customer has not agreed to marketing email from this store')).toBeTruthy()
  })
})
