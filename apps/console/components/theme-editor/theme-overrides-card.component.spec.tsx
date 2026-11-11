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
 * A per-field Reset on "What you have changed" is never refused on its first
 * press just because the server is late (AGL-4047).
 *
 * The reset recomputes the whole stored patch from the host document, so it
 * is guarded by that read. While the read is the cache's, each Reset is held
 * with the reason above the table, and comes on the moment the server answers.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { overrideWriteValue } from '@aglyn/aglyn/app-utils/artifact-overrides'

const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/scroll-table.component', () => ({
  ScrollTable: ({ children }: { children: ReactNode }) => <table>{children}</table>,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-owner' } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
}))
jest.mock('../../constants/docs-links', () => ({ docsHelp: () => undefined }))

import ThemeOverridesCard from './theme-overrides-card.component'

const host = {
  theme: { spacing: 8 },
  themeInstalledFrom: { listingId: 'listing-1', sha256: 'sha-v1' },
  themeOverride: overrideWriteValue({ spacing: 4 }, 'sha-v1'),
}

describe('ThemeOverridesCard while the host read is unconfirmed (AGL-4047)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('holds each Reset, with the reason above the table', () => {
    const onWriteOverride = jest.fn()
    render(
      <ThemeOverridesCard
        hostId="host-1"
        host={host}
        onWriteOverride={onWriteOverride}
        checkingText="Checking your theme overrides with the server…"
      />,
    )
    const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(
      'Checking your theme overrides with the server…',
    )
    fireEvent.click(reset)
    expect(onWriteOverride).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
  })

  it('resets on the first press once the server has answered', async () => {
    const onWriteOverride = jest.fn().mockResolvedValue({ ok: true })
    const { rerender } = render(
      <ThemeOverridesCard
        hostId="host-1"
        host={host}
        onWriteOverride={onWriteOverride}
        checkingText="Checking your theme overrides with the server…"
      />,
    )
    rerender(
      <ThemeOverridesCard hostId="host-1" host={host} onWriteOverride={onWriteOverride} />,
    )
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(onWriteOverride).toHaveBeenCalledTimes(1))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/back to the theme/),
      expect.objectContaining({ variant: 'success' }),
    )
  })
})
