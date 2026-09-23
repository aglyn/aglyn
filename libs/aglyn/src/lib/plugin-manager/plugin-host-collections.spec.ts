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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  listPluginHostCollections,
  pluginHostArtifactCollections,
  pluginHostCollection,
  pluginHostCollectionLabel,
  pluginHostCollectionRouteSlug,
  pluginHostCollectionsExcludedFromMediaScan,
  pluginHostCollectionsScannedGenerically,
  pluginIdForHostCollection,
  listPluginOrgCollections,
  pluginOrgCollection,
  pluginOrgCollectionsScannedGenerically,
  registerPluginHostCollections,
} from './plugin-host-collections'
import {
  resetPluginServicesForTests,
  unregisterPluginServices,
} from './plugin-services'

/**
 * The seam with no bookings, marketing or logic in it: a `cellar` plugin
 * declares the collections it writes under a site, an unrelated `almanac`
 * plugin declares its own, and the three core readers — the media scan, the
 * reference row's deep link and the artifact counters — are driven entirely
 * by what the two plugins said.
 *
 * Since AGL-3080 the real first-party plugins' declarations are COMPILED and
 * always present, so every reader here answers with those rows too. The
 * fixture plugins are invented names that no config can hold, and each
 * assertion below reads only their rows — except the one case that asserts
 * the compiled floor is there, which is the property the readers depend on.
 */

/** Only the fixture plugins' rows, so the compiled floor stays out of the way. */
const FIXTURE_PLUGINS = ['cellar', 'almanac']
const fixtureRows = () =>
  listPluginHostCollections().filter((one) =>
    FIXTURE_PLUGINS.includes(one.pluginId),
  )
const fixtureNames = () => new Set(fixtureRows().map((one) => one.name))

/** The media scan, written against the registry and nothing else. */
function mediaScanPlan(): { reads: string[]; skips: string[] } {
  const mine = fixtureNames()
  return {
    reads: pluginHostCollectionsScannedGenerically().filter((one) =>
      mine.has(one),
    ),
    skips: pluginHostCollectionsExcludedFromMediaScan()
      .filter((one) => mine.has(one.name))
      .map((one) => one.name),
  }
}

/** A reference row, which names a collection and never a plugin. */
function referenceRow(collection: string): string {
  const slug = pluginHostCollectionRouteSlug(collection)
  const label = pluginHostCollectionLabel(collection)
  return slug ? `${label} → /${slug}` : label
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('plugin host collections', () => {
  it('lets a plugin declare what it owns, and drives the scan, the deep link and the counters from it', () => {
    setRegisteringPluginId('cellar')
    registerPluginHostCollections([
      { name: 'bottles', routeSlug: 'cellar', artifact: true },
      { name: 'tastings', label: 'Tasting note', routeSlug: 'cellar' },
      {
        name: 'cellarTemperatures',
        mediaScan: 'none',
        mediaScanReason:
          'One reading per sensor per minute, none of which can hold an ' +
          'asset reference: scanning it would cost the whole sweep and find ' +
          'nothing.',
      },
    ])
    setRegisteringPluginId(undefined)

    expect(pluginIdForHostCollection('bottles')).toBe('cellar')
    expect(pluginHostCollection('tastings')).toEqual({
      name: 'tastings',
      label: 'Tasting note',
      routeSlug: 'cellar',
      pluginId: 'cellar',
    })
    expect(mediaScanPlan()).toEqual({
      reads: ['bottles', 'tastings'],
      skips: ['cellarTemperatures'],
    })
    expect(
      pluginHostArtifactCollections().filter((one) => fixtureNames().has(one)),
    ).toEqual(['bottles'])
    // The label is derived when the plugin declares none.
    expect(referenceRow('bottles')).toBe('Bottle → /cellar')
    expect(referenceRow('tastings')).toBe('Tasting note → /cellar')
    expect(referenceRow('cellarTemperatures')).toBe('Cellar temperature')
  })

  it('scans a new collection by default, so a plugin is covered the day it ships', () => {
    registerPluginHostCollections([{ name: 'corks' }], { pluginId: 'cellar' })
    expect(mediaScanPlan().reads).toEqual(['corks'])
    expect(pluginHostCollection('corks')?.mediaScan).toBeUndefined()
  })

  it('refuses an unexplained exclusion, and registers nothing from that call', () => {
    expect(() =>
      registerPluginHostCollections(
        [{ name: 'corks' }, { name: 'cellarTemperatures', mediaScan: 'none' }],
        { pluginId: 'cellar' },
      ),
    ).toThrow(
      'host collection "cellarTemperatures" is not scanned for media and says no reason',
    )
    expect(fixtureRows()).toEqual([])
  })

  it('answers nothing for a collection nobody declares, and after its owner unloads', () => {
    expect(pluginHostCollection('bottles')).toBeNull()
    expect(pluginIdForHostCollection('bottles')).toBeUndefined()
    expect(pluginHostCollectionRouteSlug('bottles')).toBeUndefined()

    registerPluginHostCollections([{ name: 'bottles', routeSlug: 'cellar' }], {
      pluginId: 'cellar',
    })
    expect(pluginHostCollectionRouteSlug('bottles')).toBe('cellar')

    unregisterPluginServices('cellar')
    expect(pluginHostCollection('bottles')).toBeNull()
    expect(fixtureRows()).toEqual([])
  })

  it('keeps one owner per collection: a second plugin is refused naming both, and the owner re-declares its own', () => {
    registerPluginHostCollections([{ name: 'bottles', routeSlug: 'cellar' }], {
      pluginId: 'cellar',
    })
    expect(() =>
      registerPluginHostCollections([{ name: 'bottles', routeSlug: 'almanac' }], {
        pluginId: 'almanac',
      }),
    ).toThrow(
      'host collection "bottles" is already declared by "cellar"; refused "almanac"',
    )
    expect(pluginHostCollectionRouteSlug('bottles')).toBe('cellar')

    // Its own collections are its own keys, and the two plugins coexist.
    registerPluginHostCollections([{ name: 'seasons', artifact: true }], {
      pluginId: 'almanac',
    })
    expect(fixtureRows().map((one) => [one.name, one.pluginId])).toEqual([
      ['bottles', 'cellar'],
      ['seasons', 'almanac'],
    ])
    expect(
      pluginHostArtifactCollections().filter((one) => fixtureNames().has(one)),
    ).toEqual(['seasons'])

    // The owner re-declaring replaces its own entry rather than adding one.
    registerPluginHostCollections([{ name: 'bottles', routeSlug: 'wine' }], {
      pluginId: 'cellar',
    })
    expect(fixtureRows()).toHaveLength(2)
    expect(pluginHostCollectionRouteSlug('bottles')).toBe('wine')
  })

  it('answers from the compiled declarations with nothing registered (AGL-3080)', () => {
    // The property the media scan depends on, and the reason the first-party
    // half is compiled rather than registered: this test resets the registry
    // in `beforeEach` and registers nothing, which is exactly the state a
    // console request that loaded no plugin is in. A registry-only seam would
    // answer "no collections" here, the scan would read none of them, and
    // every plugin-owned document would report as holding no assets.
    expect(pluginIdForHostCollection('products')).toBe('commerce')
    expect(pluginHostCollectionsScannedGenerically()).toEqual(
      expect.arrayContaining(['products', 'experiments', 'services']),
    )
    expect(
      pluginHostCollectionsExcludedFromMediaScan().map((one) => one.name),
    ).toEqual(expect.arrayContaining(['orders', 'leads']))
  })

  it('answers org collections from the compiled declarations too (AGL-3273)', () => {
    // Email sends are the org's, so the scan finds them through the org
    // declarations — compiled for the same reason the host rows are.
    expect(pluginOrgCollection('campaigns')).toMatchObject({
      pluginId: 'marketing',
      siteField: 'hostId',
    })
    expect(pluginOrgCollectionsScannedGenerically().map((one) => one.name)).toContain('campaigns')
    // A container carries no copy; it is declared and deliberately unread.
    expect(pluginOrgCollectionsScannedGenerically().map((one) => one.name)).not.toContain(
      'emailCampaigns',
    )
    expect(listPluginOrgCollections().map((one) => one.name)).toContain('emailCampaigns')
    // A reference row the org pass found links and reads like a host one.
    expect(pluginHostCollectionRouteSlug('campaigns')).toBe('marketing')
    expect(pluginHostCollectionLabel('campaigns')).toBeTruthy()
  })

  it('refuses a registration for a collection a plugin already declared', () => {
    // The compiled rows are a floor, not a default: a plugin loaded at runtime
    // cannot take a collection its owner declared in the config, any more than
    // a second plugin could take one registered before it.
    expect(() =>
      registerPluginHostCollections([{ name: 'products' }], {
        pluginId: 'cellar',
      }),
    ).toThrow(
      'host collection "products" is already declared by "commerce"; refused "cellar"',
    )
  })

  it('needs a name and an owner', () => {
    expect(() =>
      registerPluginHostCollections([{ name: '  ' }], { pluginId: 'cellar' }),
    ).toThrow('a host collection needs a name')
    expect(() => registerPluginHostCollections([{ name: 'bottles' }])).toThrow(
      /no owner/,
    )
  })
})
