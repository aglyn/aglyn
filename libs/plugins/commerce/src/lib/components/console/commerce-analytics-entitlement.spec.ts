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
 * AGL-2056: EVERY commerce-analytics surface reads `commerceAnalytics`.
 *
 * AGL-1938 gated one of them — the dashboard widget — and a spec written
 * against that widget passed for the whole period the Analytics tab beside
 * it was open to Starter orgs. So this asserts over the SET of surfaces,
 * not over any one of them: the defect was a sibling nobody checked, and a
 * per-component test reproduces the blind spot that caused it.
 *
 * `commerceAnalytics` has no server enforcement — the figures derive from
 * `hosts/{hostId}/orders`, which the org may read — so these client checks
 * are the entire mechanism behind the pricing claim. There is no backstop
 * to catch a surface that forgets.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The components that render measured commerce figures. Adding one here
 * without gating it is the failure this file exists to make loud.
 */
const SURFACES = [
  'commerce-glance-card.component.tsx',
  'commerce-analytics-card.component.tsx',
] as const

function source(file: string): string {
  return readFileSync(join(__dirname, file), 'utf8')
}

describe('commerceAnalytics is read at every surface that renders it', () => {
  it.each(SURFACES)('%s checks the entitlement', (file) => {
    const text = source(file)
    expect(text).toContain('checkEntitlement')
    expect(text).toContain(`'commerceAnalytics'`)
  })

  it.each(SURFACES)('%s waits for the plan before refusing', (file) => {
    // `checkEntitlement(undefined)` resolves the FREE tier, not "unknown".
    // A surface that renders its upsell before `ready` tells a paying org
    // it has not paid — the loading-default trap, and the reason this is
    // asserted rather than left to the reviewer.
    const text = source(file)
    expect(text).toContain('useOrgPlan')
    expect(text).toMatch(/ready:\s*orgReady/)
    expect(text).toContain('if (!orgReady)')
  })

  it.each(SURFACES)('%s routes the upsell through AppLink', (file) => {
    // Never a MUI `href` — it bypasses the client router and reloads the
    // console.
    const text = source(file)
    expect(text).toContain('<AppLink')
    expect(text).toContain('/billing')
  })
})
