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
 */

/** The media scan, written against the registry and nothing else. */
function mediaScanPlan(): { reads: string[]; skips: string[] } {
  return {
    reads: pluginHostCollectionsScannedGenerically(),
    skips: pluginHostCollectionsExcludedFromMediaScan().map((one) => one.name),
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
    expect(pluginHostArtifactCollections()).toEqual(['bottles'])
    // The label is derived when the plugin declares none.
    expect(referenceRow('bottles')).toBe('Bottle → /cellar')
    expect(referenceRow('tastings')).toBe('Tasting note → /cellar')
    expect(referenceRow('cellarTemperatures')).toBe('Cellar temperature')
  })

  it('scans a new collection by default, so a plugin is covered the day it ships', () => {
    registerPluginHostCollections([{ name: 'corks' }], { pluginId: 'cellar' })
    expect(pluginHostCollectionsScannedGenerically()).toEqual(['corks'])
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
    expect(listPluginHostCollections()).toEqual([])
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
    expect(listPluginHostCollections()).toEqual([])
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
    expect(
      listPluginHostCollections().map((one) => [one.name, one.pluginId]),
    ).toEqual([
      ['bottles', 'cellar'],
      ['seasons', 'almanac'],
    ])
    expect(pluginHostArtifactCollections()).toEqual(['seasons'])

    // The owner re-declaring replaces its own entry rather than adding one.
    registerPluginHostCollections([{ name: 'bottles', routeSlug: 'wine' }], {
      pluginId: 'cellar',
    })
    expect(listPluginHostCollections()).toHaveLength(2)
    expect(pluginHostCollectionRouteSlug('bottles')).toBe('wine')
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
