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
 * A product's own page views in its editor (AGL-4253): counted at
 * `/products/{slug}` in the host day-doc, never the product template screen's
 * counts, which are the whole catalog's.
 */

import { render, screen, waitFor } from '@testing-library/react'

const NOW = Date.parse('2026-11-25T12:00:00Z')
let mockPlan: { org: unknown; ready: boolean } = { org: { plan: 'pro' }, ready: true }
let mockFail = ''
const mockRead = jest.fn()

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: async (path: string) => {
    mockRead(path)
    if (mockFail && path.endsWith(mockFail)) throw new Error('denied')
    return {
      get: () => ({
        '/products/nova-jersey': 3,
        '/products/apex-pant': 40,
      }),
    }
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => mockPlan,
}))
jest.mock('@aglyn/aglyn', () => ({
  analyticsPathKey: jest.requireActual('@aglyn/aglyn/app-utils/analytics-path-key')
    .analyticsPathKey,
  checkEntitlement: (org: { plan?: string } | null) => org?.plan === 'pro',
}))

import ProductTrafficCard, { productTrafficDayIds } from './product-traffic-card.component'

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockPlan = { org: { plan: 'pro' }, ready: true }
  mockFail = ''
  mockRead.mockReset()
})
afterEach(() => jest.restoreAllMocks())

describe('ProductTrafficCard (AGL-4253)', () => {
  it('counts this product’s own address over fourteen days', async () => {
    render(<ProductTrafficCard hostId="host-a" slug="nova-jersey" />)
    // 3 a day × 14 days; never the other product's 40.
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy())
    expect(mockRead).toHaveBeenCalledTimes(14)
    expect(mockRead.mock.calls.every(([path]) => path.startsWith('hosts/host-a/analytics/'))).toBe(true)
  })

  it('says which days could not be read', async () => {
    mockFail = productTrafficDayIds(NOW)[2]
    render(<ProductTrafficCard hostId="host-b" slug="nova-jersey" />)
    await waitFor(() => expect(screen.getByText(/1 of the 14 days could not be read/)).toBeTruthy())
  })

  it('reads nothing on a plan without per-page traffic, or before the plan is known', () => {
    mockPlan = { org: { plan: 'starter' }, ready: true }
    const { container } = render(<ProductTrafficCard hostId="host-c" slug="nova-jersey" />)
    mockPlan = { org: null, ready: false }
    render(<ProductTrafficCard hostId="host-c" slug="nova-jersey" />)
    expect(container.textContent).toBe('')
    expect(mockRead).not.toHaveBeenCalled()
  })
})
