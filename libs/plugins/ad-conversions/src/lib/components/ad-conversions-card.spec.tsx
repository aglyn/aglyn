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
import { AdConversionsCard } from './ad-conversions-card.component'

const mockBlockedKeys = new Set<string>()
jest.mock('@aglyn/tenant-feature-instance/hooks/use-site-keys', () => ({
  useSiteKeys: () => ({ blocked: (key: string) => mockBlockedKeys.has(key) }),
}))
jest.mock('./ad-conversions-api', () => ({ useAdConversionsApi: () => null }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

const api = {
  list: jest.fn(async () => ({
    available: true,
    setup: { asksAboutAdvertising: true, tagIds: { meta: 'tag-1', google: 'tag-2', tiktok: 'tag-3' } },
    connections: [],
  })),
} as never

describe('the ad conversions card follows the keys its routes ask (AGL-4047)', () => {
  afterEach(() => mockBlockedKeys.clear())

  it('switches Connect off and names the permission without the manage key', async () => {
    mockBlockedKeys.add('adConversions.manage')
    render(<AdConversionsCard hostId="h" api={api} />)
    for (const connect of (await screen.findAllByRole('button', { name: 'Connect' })) as HTMLButtonElement[]) {
      expect(connect.disabled).toBe(true)
    }
    expect(screen.getByText(/does not include/).textContent).toContain('ask an organization admin')
  })

  it('names the permission rather than drawing nothing without the view key', async () => {
    mockBlockedKeys.add('adConversions.view')
    render(<AdConversionsCard hostId="h" api={api} />)
    expect((await screen.findByText(/does not include/)).textContent).toContain('ask an organization admin')
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('leaves Connect on for a holder', async () => {
    render(<AdConversionsCard hostId="h" api={api} />)
    const connects = (await screen.findAllByRole('button', { name: 'Connect' })) as HTMLButtonElement[]
    expect(connects.some((connect) => !connect.disabled)).toBe(true)
    expect(screen.queryByText(/does not include/)).toBeNull()
  })
})
