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
 * THE CHIP THAT SAYS WHY A CONSENTING RECORD IS SKIPPED (AGL-3686): an
 * address held by a banned or locked Aglyn account reads so on the record,
 * from `crm/email-check`; anything else draws nothing.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { CrmAccountLockChip } from './crm-email-check'

let mockAnswer: Record<string, unknown> = {}
const mockApi = jest.fn(async (_route: string, _body: unknown) => ({
  response: { ok: true },
  payload: mockAnswer,
}))

jest.mock('./use-crm-api', () => ({
  useCrmApi: () => mockApi,
}))

beforeEach(() => {
  mockApi.mockClear()
  mockAnswer = { ok: true, checked: true, code: null, message: null, gateway: null, chip: null, accountLock: null }
})

it('reads "Account banned" for a ban', async () => {
  mockAnswer = { ...mockAnswer, accountLock: 'banned' }
  render(<CrmAccountLockChip hostId="house-banned" email="pat@x.example" />)
  expect((await screen.findByTestId('crm-account-lock')).textContent).toContain('Account banned')
  expect(mockApi).toHaveBeenCalledWith('email-check', { email: 'pat@x.example' })
})

it('reads "Account locked" for any other lock', async () => {
  mockAnswer = { ...mockAnswer, accountLock: 'locked' }
  render(<CrmAccountLockChip hostId="house-locked" email="pat@x.example" />)
  expect((await screen.findByTestId('crm-account-lock')).textContent).toContain('Account locked')
})

it('draws nothing for an address no lock holds, or an answer it does not know', async () => {
  mockAnswer = { ...mockAnswer, accountLock: 'something-else' }
  render(<CrmAccountLockChip hostId="shop" email="pat@x.example" />)
  await waitFor(() => expect(mockApi).toHaveBeenCalled())
  expect(screen.queryByTestId('crm-account-lock')).toBeNull()
})

it('asks nothing where the page cannot ask', () => {
  render(<CrmAccountLockChip hostId="no-suite" email="pat@x.example" enabled={false} />)
  expect(mockApi).not.toHaveBeenCalled()
  expect(screen.queryByTestId('crm-account-lock')).toBeNull()
})
