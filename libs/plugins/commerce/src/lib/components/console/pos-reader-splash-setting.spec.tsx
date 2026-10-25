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
 * "Reader start-up screen" on the POS devices card (AGL-4048): the brand is
 * the configured one, a white-label workspace is never offered the platform's
 * screen, a missing logo is a prerequisite with a link rather than a vanished
 * option, and an image of the wrong shape is refused before anything is saved.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

let statusAnswer: any
const calls: Array<{ url: string; body: any }> = []
const snackbar = jest.fn()
let pickResult: any = null
let imageSize = { width: 1080, height: 1920 }

jest.mock('@aglyn/aglyn/app-utils/media-picker-context', () => ({
  useMediaPicker: () => ({ pickMedia: async () => pickResult }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/blocked-control.component', () => ({
  BlockedControl: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/prerequisite-notice.component', () => ({
  PrerequisiteNotice: ({ children, href }: { children: ReactNode; href?: string }) => (
    <div role="note" data-href={href}>
      {children}
    </div>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: snackbar }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useConsoleHostRoute: () => ({ base: '/acme/hosts/shop', orgSlug: 'acme', subdomain: 'shop' }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body })
    const answer = body?.action === 'save' ? { ...statusAnswer, choice: body.choice, effectiveChoice: body.choice } : statusAnswer
    return { ok: true, status: 200, json: async () => answer }
  },
}))

import { PosReaderSplashSetting } from './pos-reader-splash-setting.component'

beforeAll(() => {
  // jsdom loads no images; report the size the test asks for.
  Object.defineProperty(global.Image.prototype, 'src', {
    set(this: HTMLImageElement) {
      Object.defineProperty(this, 'naturalWidth', { value: imageSize.width, configurable: true })
      Object.defineProperty(this, 'naturalHeight', { value: imageSize.height, configurable: true })
      setTimeout(() => this.onload?.(new Event('load')))
    },
    configurable: true,
  })
})

beforeEach(() => {
  calls.length = 0
  snackbar.mockClear()
  pickResult = null
  imageSize = { width: 1080, height: 1920 }
  statusAnswer = {
    available: true,
    choice: null,
    effectiveChoice: 'platform',
    whiteLabel: false,
    productName: 'Brandname',
    platformReady: true,
    logoUrl: '/api/media/cdn/org:org-1/logo1',
    image: null,
    locationReady: true,
    appliedAtMs: null,
    problem: null,
  }
})

describe('the reader start-up screen setting', () => {
  it('names the configured brand and saves a choice', async () => {
    render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('The Brandname start-up screen')).toBeTruthy())
    fireEvent.click(screen.getByLabelText(/Your logo/))
    await waitFor(() =>
      expect(calls.some((call) => call.body?.action === 'save' && call.body.choice === 'logo')).toBe(true),
    )
  })

  it('never offers a white-label workspace the platform’s screen', async () => {
    statusAnswer = { ...statusAnswer, whiteLabel: true, effectiveChoice: 'logo', productName: 'Harbor Suite' }
    render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Your logo')).toBeTruthy())
    expect(screen.queryByText(/^The .* start-up screen$/)).toBeNull()
    expect(screen.queryByText(/Harbor Suite/)).toBeNull()
  })

  it('keeps the logo option on screen, disabled, with a link to add one', async () => {
    statusAnswer = { ...statusAnswer, logoUrl: null }
    render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByRole('note')).toBeTruthy())
    expect((screen.getByLabelText(/Your logo/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('note').getAttribute('data-href')).toBe('/acme/settings/profile')
  })

  it('refuses an image of the wrong shape before anything is saved', async () => {
    pickResult = { url: '/api/media/cdn/host-1/wide', mediaId: 'wide', mediaScope: 'host-1', contentType: 'image/png' }
    imageSize = { width: 1920, height: 1080 }
    render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Your own image')).toBeTruthy())
    fireEvent.click(screen.getByLabelText(/Your own image/))
    await waitFor(() => expect(snackbar).toHaveBeenCalledWith(expect.stringMatching(/9:16/), expect.anything()))
    expect(calls.some((call) => call.body?.action === 'save')).toBe(false)
  })

  it('saves a portrait image picked from the library', async () => {
    pickResult = { url: '/api/media/cdn/host-1/tall', mediaId: 'tall', mediaScope: 'host-1', contentType: 'image/png' }
    render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(screen.getByText('Your own image')).toBeTruthy())
    fireEvent.click(screen.getByLabelText(/Your own image/))
    await waitFor(() =>
      expect(calls.find((call) => call.body?.action === 'save')?.body).toMatchObject({
        choice: 'image',
        mediaScope: 'host-1',
        mediaId: 'tall',
      }),
    )
  })

  it('disables every choice for someone who cannot run the register', async () => {
    render(<PosReaderSplashSetting hostId="host-1" canManagePos={false} />)
    await waitFor(() => expect(screen.getByText('Your logo')).toBeTruthy())
    for (const label of [/Brandname start-up screen/, /Your logo/, /Your own image/]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('renders nothing where card readers are not offered', async () => {
    statusAnswer = { ...statusAnswer, available: false }
    const { container } = render(<PosReaderSplashSetting hostId="host-1" canManagePos />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(container.textContent).toBe('')
  })
})
