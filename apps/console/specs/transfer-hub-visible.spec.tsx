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
 * SETTINGS → IMPORT & EXPORT IS FOR WHOEVER MAY EXPORT SOMETHING (AGL-3554):
 * "Manage data", or a resource that lets the person read its records, as
 * the launcher's `can` answers — and nobody before their permissions have
 * answered.
 */

import { renderHook } from '@testing-library/react'

let mockManages = false
let mockLoaded = true
/** The resources the launcher lets this person export. */
let mockExportable = new Set<string>()

jest.mock('@aglyn/aglyn/app-utils/transfer-launcher-context', () => ({
  useTransferLauncher: () => ({
    can: (action: string, target: { resource: string }) => action === 'export' && mockExportable.has(target.resource),
  }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ loaded: mockLoaded, can: (permission: string) => mockManages && permission === 'data.manage' }),
}))

import useTransferHubVisible from '../hooks/use-transfer-hub-visible'

beforeEach(() => {
  mockManages = false
  mockLoaded = true
  mockExportable = new Set()
})

describe('useTransferHubVisible (AGL-3554)', () => {
  it('is open to whoever holds Manage data', () => {
    mockManages = true
    expect(renderHook(() => useTransferHubVisible()).result.current).toBe(true)
  })

  it('is open to a member who may export a resource’s records, without Manage data', () => {
    mockExportable = new Set(['data.dataset'])
    expect(renderHook(() => useTransferHubVisible()).result.current).toBe(true)
  })

  it('is closed to a member who may export nothing, and until permissions answer', () => {
    expect(renderHook(() => useTransferHubVisible()).result.current).toBe(false)
    mockManages = true
    mockLoaded = false
    expect(renderHook(() => useTransferHubVisible()).result.current).toBe(false)
  })
})
