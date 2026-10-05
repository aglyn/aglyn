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
import { listPluginSiteExportCollections } from './plugin-site-export'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The host collections plugins declare for the site backup (AGL-3080), read
 * with no plugin loaded — the state the export and restore routes are in.
 *
 * The generator checks each declaration's shape. What it cannot see is the
 * plan table and core's constants, and a restore's count is a key into both:
 * a counter no plan holds refuses every restore, a cap name core does not
 * hold refuses the collection. Both fail CLOSED, which is safe and invisible
 * in review; here they are named.
 */
describe('declared site export collections', () => {
  it('declares at least one, or every case below proves nothing', () => {
    expect(listPluginSiteExportCollections().length).toBeGreaterThan(0)
  })

  it('carries each collection under its owner’s declaration', () => {
    for (const declared of listPluginSiteExportCollections()) {
      const owner = listPluginHostCollections().find((one) => one.name === declared.collection)
      expect([declared.collection, owner?.pluginId]).toEqual([declared.collection, declared.pluginId])
    }
  })

  it('counts every restore against a plan counter every plan holds, or a cap core holds', () => {
    for (const declared of listPluginSiteExportCollections()) {
      if ('quotaKey' in declared.count) {
        for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
          const value = (entitlements as unknown as Record<string, unknown>)[declared.count.quotaKey]
          expect([declared.collection, plan, typeof value]).toEqual([declared.collection, plan, 'number'])
        }
      } else if ('uncapped' in declared.count) {
        // An uncapped collection says why, in a sentence a reviewer can
        // disagree with.
        expect([declared.collection, declared.count.uncapped.length > 20]).toEqual([declared.collection, true])
      } else {
        const cap = declared.count.max
        expect([declared.collection, Number.isInteger(cap) && (cap ?? 0) > 0]).toEqual([
          declared.collection,
          true,
        ])
      }
    }
  })

  it('restores nothing the restore stamps or scopes itself', () => {
    for (const declared of listPluginSiteExportCollections()) {
      const stamped = ['createdAt', 'updatedAt', 'createdBy', 'deletedAt', 'visibleTo']
      expect([declared.collection, declared.fields.filter((field) => stamped.includes(field))]).toEqual([
        declared.collection,
        [],
      ])
    }
  })
})

describe('each carried collection as site package items (AGL-3533)', () => {
  it('names a kind, a label and a field an item is matched by', () => {
    for (const declared of listPluginSiteExportCollections()) {
      const pkg = declared.package
      expect([declared.collection, typeof pkg.kind, pkg.label.length > 0]).toEqual([
        declared.collection,
        'string',
        true,
      ])
      const matchedBy = pkg.slugField ?? pkg.nameField
      expect([declared.collection, matchedBy !== undefined && declared.fields.includes(matchedBy)]).toEqual([
        declared.collection,
        true,
      ])
    }
  })

  it('gives every kind one owner', () => {
    const kinds = listPluginSiteExportCollections().map((one) => one.package.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('names references only through fields a restore writes', () => {
    for (const declared of listPluginSiteExportCollections()) {
      for (const ref of declared.package.references ?? []) {
        expect([declared.collection, ref.field, declared.fields.includes(ref.field)]).toEqual([
          declared.collection,
          ref.field,
          true,
        ])
      }
    }
  })
})

describe('the runtime door', () => {
  afterEach(() => resetPluginServicesForTests())

  it('refuses a site export, which only the compiled declarations can carry', () => {
    expect(() =>
      registerPluginHostCollections(
        [
          {
            name: 'bottles',
            siteExport: { limit: 10, fields: ['name'], package: { kind: 'bottle', label: 'Bottles', nameField: 'name' } },
          },
        ],
        { pluginId: 'cellar' },
      ),
    ).toThrow(/compiled declarations/)
    expect(listPluginHostCollections().some((one) => one.name === 'bottles')).toBe(false)
  })
})
