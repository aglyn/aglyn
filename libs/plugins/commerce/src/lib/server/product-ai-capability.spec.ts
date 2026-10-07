/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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
 * The `product` AI capability (AGL-3616): it registers under its op, points
 * at this plugin's writer, and its arguments become content the writer
 * accepts — unpriced unless a price was given.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { PRODUCT_AI_OP, productAiCapability, registerProductAiCapability } from './product-ai-capability'
import { checkProductDraftContent, PRODUCT_DRAFT_RESOURCE } from './product-drafts'

const ARGS = {
  name: 'Soy candle',
  type: 'physical',
  description: 'Hand-poured soy wax with a cotton wick.',
  tags: ['candles', 'soy'],
  optionName: 'Size',
  optionValues: ['8 oz', '16 oz'],
}

const contentOf = (args: Record<string, unknown>) =>
  productAiCapability.draftContent?.({ name: 'candle', args: args as never }, { hostId: 'host-1', dependencies: {} }) ?? {}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the product capability', () => {
  it('is well-formed, and registers under its op owned by commerce, written by its writer', () => {
    expect(pluginAiCapabilityProblem(productAiCapability)).toBeNull()
    registerProductAiCapability()
    registerProductAiCapability()
    expect(pluginAiCapability(PRODUCT_AI_OP)).toEqual({ pluginId: 'commerce', capability: productAiCapability })
    expect(productAiCapability).toMatchObject({
      draftResource: PRODUCT_DRAFT_RESOURCE,
      feature: 'commerce',
      quota: 'productsPerHost',
      freeAllowed: false,
      degrade: 'omit',
    })
    expect(productAiCapability.estimateCredits(ARGS as never)).toBe(0)
  })

  it('turns arguments the schema admits into an unpriced draft the writer accepts', () => {
    expect(pluginAiCapabilityArgsProblems(productAiCapability.argsSchema, ARGS)).toEqual([])
    const content = contentOf(ARGS)
    expect(content).toEqual({
      name: 'Soy candle',
      type: 'physical',
      description: 'Hand-poured soy wax with a cotton wick.',
      tags: ['candles', 'soy'],
      options: [{ name: 'Size', values: ['8 oz', '16 oz'] }],
    })
    expect(checkProductDraftContent(content)).toMatchObject({
      ok: true,
      facts: { status: 'draft', variants: 2, priceMissing: true },
    })
  })

  it('prices it only when a price was given', () => {
    expect(checkProductDraftContent(contentOf({ name: 'Wax melt', priceUsd: 6 }))).toMatchObject({
      ok: true,
      facts: { variants: 1, priceMissing: false },
    })
  })

  it('hands on half an option for the writer to refuse by name', () => {
    expect(checkProductDraftContent(contentOf({ name: 'Wax melt', optionName: 'Scent' }))).toEqual({
      ok: false,
      problems: ['Each option needs a name and at least one value'],
    })
  })
})
