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
 * Staff → Reader start-up screen (AGL-4048): each reader family's default
 * with its required size, writes only for super staff, and an upload is put
 * on every store's readers straight after it is kept.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const calls: Array<{ url: string; method: string; body: any }> = []
const snackbar = jest.fn()

const STATE = {
  ready: false,
  updatedAtMs: null,
  canWrite: true,
  families: [
    { id: 'portrait-large', label: 'Stripe Reader S700 and S710', width: 1080, height: 1920, image: null },
    { id: 'portrait-small', label: 'BBPOS WisePOS E', width: 720, height: 1280, image: null },
  ],
}

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/blocked-control.component', () => ({
  BlockedControl: ({ children, blocked }: { children: any; blocked: boolean }) =>
    blocked ? { ...children, props: { ...children.props, disabled: true } } : children,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: snackbar }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'staff-1' } }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init?.method ?? 'GET', body })
    const answer =
      body?.action === 'apply'
        ? { applied: 3, unchanged: 1, failed: 0, more: false }
        : body?.action === 'upload'
          ? { ...STATE, ready: true }
          : STATE
    return { ok: true, status: 200, json: async () => answer, blob: async () => new Blob() }
  },
}))

import { PosReaderSplashStaffPage } from './pos-reader-splash-staff-page.component'

beforeEach(() => {
  calls.length = 0
  snackbar.mockClear()
})

const props = (staffRole: string) => ({ basePath: '/admin/reader-start-up-screen', staffRole }) as any

describe('the reader start-up screen staff page', () => {
  it('lists each family with the size Stripe requires', async () => {
    render(<PosReaderSplashStaffPage {...props('super')} />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S700 and S710')).toBeTruthy())
    expect(screen.getByText(/1080 × 1920 pixels/)).toBeTruthy()
    expect(screen.getByText(/720 × 1280 pixels/)).toBeTruthy()
  })

  it('offers no write to a staff role other than super', async () => {
    render(<PosReaderSplashStaffPage {...props('support')} />)
    await waitFor(() => expect(screen.getByText('BBPOS WisePOS E')).toBeTruthy())
    for (const button of screen.getAllByRole('button', { name: 'Upload' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('uploads a screen and then updates every store', async () => {
    render(<PosReaderSplashStaffPage {...props('super')} />)
    await waitFor(() => expect(screen.getByText('Stripe Reader S700 and S710')).toBeTruthy())
    const input = screen.getByLabelText('Upload the Stripe Reader S700 and S710 screen') as HTMLInputElement
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'splash.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(calls.some((call) => call.body?.action === 'apply')).toBe(true))
    const upload = calls.find((call) => call.body?.action === 'upload')
    expect(upload?.body).toMatchObject({ family: 'portrait-large', dataBase64: 'iVBORw==' })
    expect(snackbar).toHaveBeenCalledWith('Updated 3 stores.', expect.anything())
  })
})
