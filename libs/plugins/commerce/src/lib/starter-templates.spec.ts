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
 * The shop starters are this plugin's, and the build offers them (AGL-3080).
 *
 * The gallery, the seed route and the AI plugin's examples read core's
 * `STARTER_TEMPLATES`, which compiles in what this plugin declares. So the
 * declaration and the compiled copy must be one list — a starter edited here
 * and not regenerated would seed yesterday's pages — and every element a shop
 * page places must name the bundle that registers it.
 */

import { PLUGIN_STARTER_TEMPLATES } from '@aglyn/aglyn/app-utils/plugin-starter-templates.generated'
import { STARTER_TEMPLATES } from '@aglyn/aglyn/app-utils/starter-templates'
import { BUNDLE_ID } from './constants/bundle-common'
import { commerceStarterTemplates } from './starter-templates'

describe('the shop starters', () => {
  it('are compiled into the build exactly as this plugin declares them', () => {
    const declared = commerceStarterTemplates()
    expect(declared.map((starter) => starter.id)).toEqual(['physical-shop', 'digital-shop'])
    expect(
      PLUGIN_STARTER_TEMPLATES.filter((starter) =>
        declared.some((own) => own.id === starter.id),
      ),
    ).toEqual(declared)
  })

  it('are offered after the platform’s own starters, each id once', () => {
    const ids = STARTER_TEMPLATES.map((starter) => starter.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(-2)).toEqual(['physical-shop', 'digital-shop'])
  })

  it('place this plugin’s elements under its own bundle id', () => {
    const placed = commerceStarterTemplates()
      .flatMap((starter) => starter.screens)
      .flatMap((screen) => Object.values(screen.nodes))
      .filter((node: any) =>
        ['product-grid', 'product-detail', 'cart', 'customer-account', 'newsletter-signup'].includes(
          node.componentId,
        ),
      )
    expect(placed.length).toBeGreaterThan(0)
    for (const node of placed as any[]) {
      expect(`${node.componentId}: ${node.pluginId}`).toBe(`${node.componentId}: ${BUNDLE_ID}`)
    }
  })
})
