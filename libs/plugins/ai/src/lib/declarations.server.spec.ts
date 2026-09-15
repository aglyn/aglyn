/**
 * @jest-environment node
 */
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
 * The server declarations (AGL-2939): the platform events core raises
 * reach the plugin's activity writers. The routes prove they RAISE the
 * events (`addon-ai-toggle`, `billing-webhook-ai-addon`, the member and
 * role routes); this proves the subscription turns each into the row
 * `ai-activity.spec.ts` pins.
 */

const mockAddon = jest.fn(async () => true)
const mockPermission = jest.fn(async () => undefined)
jest.mock('./activity/ai-activity', () => ({
  __esModule: true,
  logAiAddonChanged: (...args: unknown[]) => mockAddon(...(args as [])),
  logAiPermissionChanged: (...args: unknown[]) => mockPermission(...(args as [])),
}))

/** One held Firestore: the eraser must hand the meter the app's own. */
const mockFirestore = { name: 'the app firestore' }
const mockEraseUserAiUsage = jest.fn(async () => ({ orgs: 2, sweptMonths: 1 }))
jest.mock('./usage/ai-usage-by-user', () => ({
  __esModule: true,
  eraseUserAiUsage: (...args: unknown[]) => mockEraseUserAiUsage(...(args as [])),
}))
/** The allotments set on the person (AGL-2942), erased beside their months. */
const mockEraseAllotments = jest.fn(async () => 3)
jest.mock('./usage/ai-allotments', () => ({
  __esModule: true,
  eraseAiAllotmentsForUser: (...args: unknown[]) => mockEraseAllotments(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
}))

import {
  listPluginEventHandlers,
  listPluginLockdownFeatures,
  listPluginSeatAddons,
  listPluginUserErasers,
  resetPluginEntitlementsForTests,
  resetPluginEventHandlersForTests,
  resetPluginUserErasersForTests,
  runPluginEventHandlers,
  runPluginUserErasers,
} from '@aglyn/aglyn/server'
import { AI_PLUGIN_ENTITLEMENTS, registerAiDeclarations } from './declarations'
import { registerAiServerDeclarations } from './declarations.server'

const ACTOR = { uid: 'u1', email: 'owner@example.test' }

beforeEach(() => {
  mockAddon.mockClear()
  mockPermission.mockClear()
})

describe('the AI plugin declares its keys through the generic seams', () => {
  it('registers the add-on, the two levers and their paths', () => {
    resetPluginEntitlementsForTests()
    // The module registered at import; a second call is idempotent.
    registerAiDeclarations()
    expect(listPluginSeatAddons().map((addon) => addon.key)).toEqual([])
    // The reset forgot it; the declaration itself is what the plugin owns.
    expect(AI_PLUGIN_ENTITLEMENTS.seatAddons?.[0]).toMatchObject({
      key: 'aiAddon',
      maxUnits: 1,
      quota: { key: 'assistCreditsPerMonth' },
      features: ['aiGenerative', 'aiAssist'],
    })
    expect(AI_PLUGIN_ENTITLEMENTS.lockdownFeatures?.map((lever) => lever.key)).toEqual([
      'ai-assist',
      'ai-generate',
    ])
    expect(listPluginLockdownFeatures()).toEqual([])
  })
})

describe('the server declarations subscribe the activity writers', () => {
  beforeEach(() => {
    resetPluginEventHandlersForTests()
  })

  it('subscribes once, attributed to the plugin, and again after a reset', () => {
    expect(listPluginEventHandlers('org.seatAddons.changed')).toEqual([])
    registerAiServerDeclarations()
    registerAiServerDeclarations()
    expect(listPluginEventHandlers('org.seatAddons.changed')).toEqual(['ai'])
    expect(listPluginEventHandlers('org.permissions.changed')).toEqual(['ai'])
  })

  it('an add-on change reaches the add-on writer with the actor and both maps', async () => {
    registerAiServerDeclarations()
    await runPluginEventHandlers('org.seatAddons.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      before: {},
      after: { aiAddon: 1 },
    })
    expect(mockAddon).toHaveBeenCalledWith('org-1', ACTOR, { before: {}, after: { aiAddon: 1 } })
  })

  it('an ai.* permission change reaches the permission writer; another key does not', async () => {
    registerAiServerDeclarations()
    await runPluginEventHandlers('org.permissions.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      subject: { type: 'role', id: 'role-1', name: 'Editors' },
      permission: 'ai.generate',
      granted: false,
    })
    await runPluginEventHandlers('org.permissions.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      subject: { type: 'member', id: 'u2' },
      permission: 'billing.manage',
      granted: true,
    })
    expect(mockPermission).toHaveBeenCalledTimes(1)
    expect(mockPermission).toHaveBeenCalledWith('org-1', ACTOR, {
      subject: { type: 'role', id: 'role-1', name: 'Editors' },
      permission: 'ai.generate',
      granted: false,
    })
  })
})

describe('the server declarations register the AI usage eraser', () => {
  beforeEach(() => {
    resetPluginUserErasersForTests()
    mockEraseUserAiUsage.mockClear()
  })

  it('registers once, attributed to the plugin, and again after a reset', () => {
    expect(listPluginUserErasers()).toEqual([])
    registerAiServerDeclarations()
    registerAiServerDeclarations()
    expect(listPluginUserErasers()).toEqual(['ai'])
  })

  it('an account erasure reaches the meter\'s eraser with every org the person was in', async () => {
    registerAiServerDeclarations()
    const reports = await runPluginUserErasers({ uid: 'person-1', orgIds: ['org-a', 'org-b'] })
    expect(mockEraseUserAiUsage).toHaveBeenCalledWith(mockFirestore, 'person-1', [
      'org-a',
      'org-b',
    ])
    expect(mockEraseAllotments).toHaveBeenCalledWith(mockFirestore, 'person-1', ['org-a', 'org-b'])
    expect(reports).toEqual({ ai: { orgs: 2, sweptMonths: 1, allotments: 3 } })
  })
})
