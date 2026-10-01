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

import { PLAN_ENTITLEMENTS } from '../app-utils/plan-entitlements'
import { listPluginHostCollections, registerPluginHostCollections } from './plugin-host-collections'
import {
  hostResourcePlatformCap,
  listPluginHostResources,
  pluginHostResource,
} from './plugin-host-resources'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The kinds a plugin declares for the platform's generic create route
 * (AGL-3080), read with no plugin loaded — the state `/api/hosts/resources`
 * and `duplicateResource` are in.
 *
 * Every key a declaration names is a key into something core owns: the plan
 * table's counters and features, and core's flat caps. The generator cannot
 * read those tables, so this is where a misspelled key goes red. Each one
 * fails CLOSED at runtime — a counter the plan does not hold refuses every
 * create, an unknown cap refuses the kind — which is safe and invisible in
 * review; here it names the key.
 */
describe('declared host resource kinds', () => {
  const plans = Object.entries(PLAN_ENTITLEMENTS)

  it('declares at least one, or every case below proves nothing', () => {
    expect(listPluginHostResources().length).toBeGreaterThan(0)
  })

  it('gives each kind one declaration, written into its own plugin’s collection', () => {
    const kinds = listPluginHostResources().map((one) => one.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const resource of listPluginHostResources()) {
      const owner = listPluginHostCollections().find((one) => one.name === resource.collection)
      expect([resource.kind, owner?.pluginId]).toEqual([resource.kind, resource.pluginId])
    }
  })

  it('names a plan counter every plan holds', () => {
    for (const resource of listPluginHostResources()) {
      if (!resource.quotaKey) continue
      for (const [plan, entitlements] of plans) {
        const value = (entitlements as unknown as Record<string, unknown>)[resource.quotaKey]
        expect([resource.kind, plan, typeof value]).toEqual([resource.kind, plan, 'number'])
      }
    }
  })

  it('names a feature every plan answers', () => {
    for (const resource of listPluginHostResources()) {
      if (!resource.entitlement) continue
      for (const [plan, entitlements] of plans) {
        const value = (entitlements.features as unknown as Record<string, unknown>)[resource.entitlement]
        expect([resource.kind, plan, typeof value]).toEqual([resource.kind, plan, 'boolean'])
      }
    }
  })

  it('names a platform cap core holds', () => {
    for (const resource of listPluginHostResources()) {
      if (!resource.platformCap) continue
      const cap = hostResourcePlatformCap(resource.platformCap)
      expect([resource.kind, Number.isInteger(cap) && (cap ?? 0) > 0]).toEqual([resource.kind, true])
    }
  })

  it('never lets a client write what the server stamps', () => {
    for (const resource of listPluginHostResources()) {
      const writable = new Set(resource.fields)
      const stamped = [
        'createdAt',
        'updatedAt',
        'createdBy',
        'deletedAt',
        ...Object.keys(resource.stamps ?? {}),
        ...(resource.externalDestination ? [resource.externalDestination.approvedByField] : []),
      ]
      expect([resource.kind, stamped.filter((field) => writable.has(field))]).toEqual([resource.kind, []])
    }
  })
})

describe('a kind nobody declared', () => {
  it('resolves to nothing, whatever it is called', () => {
    for (const kind of ['nonesuch', 'constructor', 'toString', '__proto__', '', null, undefined, 7]) {
      expect(pluginHostResource(kind)).toBeNull()
    }
  })

  it('has no cap core would lend it', () => {
    expect(hostResourcePlatformCap('NONESUCH_MAX_PER_HOST')).toBeNull()
    expect(hostResourcePlatformCap('constructor')).toBeNull()
  })
})

describe('the runtime door', () => {
  afterEach(() => resetPluginServicesForTests())

  it('refuses a resource kind, which only the compiled declarations can carry', () => {
    expect(() =>
      registerPluginHostCollections(
        [
          {
            name: 'bottles',
            resource: {
              kind: 'bottle',
              label: 'bottles',
              activityNoun: 'bottle',
              quotaKey: 'bottlesPerHost',
              fields: ['name'],
            },
          },
        ],
        { pluginId: 'cellar' },
      ),
    ).toThrow(/compiled declarations/)
    expect(listPluginHostCollections().some((one) => one.name === 'bottles')).toBe(false)
  })
})
