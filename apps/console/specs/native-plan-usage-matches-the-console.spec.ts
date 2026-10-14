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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CRM_EMAIL_USAGE_COLLECTION,
  resolveOrgEntitlements,
} from '@aglyn/aglyn'
import { orgCountedPluginBands } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { pluginOrgCapacities } from '@aglyn/aglyn/plugin-manager/plugin-org-capacity'

/**
 * The native Usage screens read plan limits from `/api/orgs/entitlements` and
 * counters from the documents the console's `BillingUsageComponent` reads. A
 * misspelled quota key reads as `null`, which the meter shows as Unlimited, so
 * every key and counter name the screens use is checked against the source
 * the console uses.
 */
const SPEC = join(
  __dirname,
  '../../../libs/native/screens/billing.screens.json',
)
const text = readFileSync(SPEC, 'utf8')
const { features, ...quotas } = resolveOrgEntitlements({ plan: 'pro' } as never)

describe('native plan usage', () => {
  it('names only quotas the entitlements route returns', () => {
    const used = new Set(
      [...text.matchAll(/data\.ent\.quotas\.([A-Za-z]+)/g)].map((m) => m[1]),
    )
    expect(used.size).toBeGreaterThan(10)
    for (const key of used) expect(Object.keys(quotas)).toContain(key)
  })

  it('names only feature flags the route returns', () => {
    for (const m of text.matchAll(/data\.ent\.features\.([A-Za-z]+)/g)) {
      expect(Object.keys(features)).toContain(m[1])
    }
  })

  it('reads the same counters the console reads', () => {
    expect(text).toContain(`orgs/{org.id}/${CRM_EMAIL_USAGE_COLLECTION}/{now.day}`)
    for (const band of orgCountedPluginBands()) {
      expect(text).toContain(`orgs/{org.id}/counters/${band.orgCounter}`)
      expect(text).toContain(`data.ent.quotas.${band.entitlement}`)
    }
    for (const capacity of pluginOrgCapacities()) {
      expect(text).toContain(`orgs/{org.id}/${capacity.collection}`)
      expect(text).toContain(`data.ent.quotas.${capacity.includedEntitlement}`)
    }
  })
})
