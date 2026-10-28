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
 *
 * @jest-environment node
 */

/**
 * The commerce plugin's console-only declarations, for the in-person card
 * reader sale (AGL-4038): a workspace created by a buyer who bought a reader
 * in person before they had one claims it, through core's `org.created`,
 * and only while the in-person sale is on.
 */

const mockClaim = jest.fn(async () => ({ claimed: 1 }))
jest.mock('./server/pos-hardware-attach', () => ({
  claimPosHardwareForNewWorkspace: (...args: unknown[]) => mockClaim(...(args as [])),
}))

import {
  listPluginEventHandlers,
  resetPluginEventHandlersForTests,
  runPluginEventHandlers,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCommerceConsoleServerDeclarations } from './declarations.console-server'
import { POS_HARDWARE_ENV } from './model/pos-hardware'

const KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]
const CREATED = {
  orgId: 'org-new',
  owner: { uid: 'uid-new', email: 'new@example.com', emailVerified: true },
  via: 'workspace-page' as const,
}

describe('org.created claims card readers bought in person (AGL-4038)', () => {
  beforeEach(() => {
    resetPluginEventHandlersForTests()
    mockClaim.mockClear()
    for (const key of KEYS) delete process.env[key]
  })
  afterAll(() => {
    for (const key of KEYS) delete process.env[key]
  })

  it('is subscribed once, as commerce', () => {
    registerCommerceConsoleServerDeclarations()
    registerCommerceConsoleServerDeclarations()
    expect(listPluginEventHandlers('org.created')).toEqual([BUNDLE_ID])
  })

  it('does nothing while the in-person sale is off, and claims for the new owner while it is on', async () => {
    registerCommerceConsoleServerDeclarations()
    await runPluginEventHandlers('org.created', CREATED)
    expect(mockClaim).not.toHaveBeenCalled()
    process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
    process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
    process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
    await runPluginEventHandlers('org.created', CREATED)
    expect(mockClaim).toHaveBeenCalledWith({
      config: { sellerHostId: 'host-seller', sellerOrgId: 'org-seller' },
      orgId: 'org-new',
      ownerUid: 'uid-new',
      ownerEmail: 'new@example.com',
      emailVerified: true,
    })
  })
})
