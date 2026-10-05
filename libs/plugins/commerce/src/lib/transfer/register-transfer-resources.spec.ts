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

/*
 * Every commerce resource the plugin declares (AGL-3531) registers both
 * halves, with a catalog the core accepts, before any store-touching module
 * loads.
 */

import {
  pluginTransferResourceUi,
  resetTransferResourcesForTests,
  resetTransferResourceUisForTests,
  resolveTransferResource,
  transferResourceCatalog,
  transferWizardSteps,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { registerCommerceTransferResources } from './register-transfer-resources'
import { registerCommerceTransferUi } from './register-transfer-ui'
import { COMMERCE_TRANSFER_RESOURCES } from './transfer-keys'

jest.mock('./products.server', () => {
  throw new Error('loaded at boot')
})
jest.mock('./records.server', () => {
  throw new Error('loaded at boot')
})
jest.mock('./gift-cards.server', () => {
  throw new Error('loaded at boot')
})

beforeEach(() => {
  resetTransferResourcesForTests()
  resetTransferResourceUisForTests()
})

describe('the commerce transfer resources', () => {
  it('register both halves of every declared resource, without loading a server module', async () => {
    registerCommerceTransferResources()
    registerCommerceTransferUi()
    // Each by its key: other plugins' resources register in their own processes.
    const resolved = await Promise.all(COMMERCE_TRANSFER_RESOURCES.map((key) => resolveTransferResource(key)))
    expect(resolved.every((entry) => entry.pluginId === 'commerce')).toBe(true)
    for (const resource of resolved) {
      const catalog = await transferResourceCatalog(resource, {
        resource: resource.key,
        orgId: 'org-1',
        hostId: 'h1',
        actorUid: 'uid-1',
      })
      expect(catalog.fields.some((field) => field.id === 'id')).toBe(true)
      expect(pluginTransferResourceUi(resource.key)?.label).toBeTruthy()
    }
  })

  it('offers the Shopify preset on products, and the After import step before the review', async () => {
    registerCommerceTransferResources()
    registerCommerceTransferUi()
    const products = await resolveTransferResource('commerce.products')
    expect(products.impl.presets?.map((preset) => preset.id)).toEqual(['shopify'])
    expect(transferWizardSteps('commerce.products').map((step) => step.id)).toEqual([
      'upload',
      'mapping',
      'values',
      'matching',
      'conflicts',
      'afterImport',
      'dryRun',
      'apply',
    ])
  })

  it('imports gift cards, with the Confirm step before the review and the issuable rule failing a refused row', async () => {
    registerCommerceTransferResources()
    registerCommerceTransferUi()
    const cards = await resolveTransferResource('commerce.gift-cards')
    expect(transferWizardSteps('commerce.gift-cards').map((step) => step.id)).toEqual([
      'upload',
      'mapping',
      'values',
      'matching',
      'conflicts',
      'gift-card-total',
      'dryRun',
      'apply',
    ])
    const issuable = cards.impl.invariants?.find((rule) => rule.id === 'gift-card-issuable')
    const row = { index: 0, verdict: 'create' as const, recordId: null, diff: [], heldBack: [], warnings: [], match: { kind: 'new' as const } }
    expect(issuable?.check({ ...row, giftCard: { problem: 'No.' } } as never, null)).toBe('No.')
    expect(issuable?.check(row, null)).toBeNull()
  })
})
