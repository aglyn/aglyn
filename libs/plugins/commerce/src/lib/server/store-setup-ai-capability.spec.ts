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
 * The store-setup AI capabilities (AGL-3749): four operations, owned by
 * commerce, written by its `store-settings` writer, free of credits and of
 * Free plans, and whose arguments the writer reads as the change asked.
 */

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { readStoreSetupChange, STORE_SETUP_RESOURCE } from '../model/store-setup-content'
import {
  STORE_DELIVERY_AI_OP,
  STORE_PICKUP_AI_OP,
  STORE_SETUP_AI_CAPABILITIES,
  STORE_SHIPPING_AI_OP,
  STORE_TAX_AI_OP,
  registerStoreSetupAiCapabilities,
  storeShippingAiCapability,
  storeTaxAiCapability,
} from './store-setup-ai-capability'

const EXAMPLES: Record<string, Record<string, unknown>> = {
  [STORE_SHIPPING_AI_OP]: {
    zoneName: 'United States',
    countries: ['US'],
    rateName: 'Standard',
    kind: 'free_over',
    amountUsd: 5,
    freeOverUsd: 50,
  },
  [STORE_PICKUP_AI_OP]: { location: 'Austin', hours: 'Mo-Fr 09:00-17:00' },
  [STORE_DELIVERY_AI_OP]: { country: 'US', zoneName: 'Downtown', postcodes: ['78701'], feeUsd: 5, windows: 'Mo-Fr 09:00-12:00' },
  [STORE_TAX_AI_OP]: { originCountry: 'US', originState: 'TX', rateCountry: 'US', rateState: 'TX', ratePercent: 8.25 },
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the store-setup capabilities', () => {
  it('are well-formed, cost nothing, need commerce, and are live', () => {
    for (const capability of STORE_SETUP_AI_CAPABILITIES) {
      expect(pluginAiCapabilityProblem(capability)).toBeNull()
      expect(capability).toMatchObject({
        draftResource: STORE_SETUP_RESOURCE,
        feature: 'commerce',
        freeAllowed: false,
        live: true,
        degrade: 'omit',
      })
      expect(capability.estimateCredits(EXAMPLES[capability.op] as never)).toBe(0)
    }
  })

  it('register under their ops, owned by commerce, and again without complaint', () => {
    registerStoreSetupAiCapabilities()
    registerStoreSetupAiCapabilities()
    for (const op of [STORE_SHIPPING_AI_OP, STORE_PICKUP_AI_OP, STORE_DELIVERY_AI_OP, STORE_TAX_AI_OP]) {
      expect(pluginAiCapability(op)?.pluginId).toBe('commerce')
    }
  })

  it('turn arguments the schema accepts into a change the writer reads', () => {
    for (const capability of STORE_SETUP_AI_CAPABILITIES) {
      const args = EXAMPLES[capability.op]
      expect(pluginAiCapabilityArgsProblems(capability.argsSchema, args)).toEqual([])
      const content = capability.draftContent?.({ name: 'x', args: args as never }, { hostId: 'host-1', dependencies: {} }) ?? {}
      const read = readStoreSetupChange(content)
      expect(read).toMatchObject({ ok: true })
    }
  })

  it('tell the planner every amount and rate is only what the request states, and offer no carrier rates', () => {
    const shipping = storeShippingAiCapability.argsSchema.properties
    expect(shipping['amountUsd']?.description).toMatch(/ONLY when the request states it/)
    expect(shipping['kind']?.enum).not.toContain('carrier')
    expect(storeTaxAiCapability.argsSchema.properties['ratePercent']?.description).toMatch(/ONLY when the request states it/)
    expect(storeTaxAiCapability.intents.join(' ')).toMatch(/Never a rate the request does not state/)
  })

  it('leave out an argument the planner left blank', () => {
    const content = storeTaxAiCapability.draftContent?.(
      { name: 'tax', args: { mode: 'none', rateLabel: '' } },
      { hostId: 'host-1', dependencies: {} },
    )
    expect(content).toEqual({ section: 'tax', mode: 'none' })
  })
})
