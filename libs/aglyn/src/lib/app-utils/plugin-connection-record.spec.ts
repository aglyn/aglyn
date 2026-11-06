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

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NodeIdentityContext } from './node-identity'
import { usePluginConnectionRecord } from './plugin-connection-record'
import {
  PLUGIN_CONNECTION_RECORDS_PROP,
  pluginConnectionRecordFor,
  type PluginConnectionRecordsPageData,
  type PluginConnectionSiteRecord,
} from './plugin-connection-records'
import { PluginConnectionRecordsContext } from './plugin-connection-records-context'
import { REALM_HOST_SURFACE_NAMES } from './realm-host-surface.generated'
import { RealmElementNodeContext } from './realm-elements-context'

/**
 * A signed element reads ITS OWN listing's connection record, and only that
 * (AGL-4195). The page hands every record on it as one prop, keyed by the
 * element's node; the hook asks with the node the renderer says is asking,
 * never with a listing the bundle names, so one plugin's element has no way
 * to ask for another's record.
 */

const REVIEWS = { fields: { rating: 4.8, reviewCount: 212 }, items: [{ author: 'Sam', stars: 5 }], syncedAtMs: 1 }
const CALENDAR: PluginConnectionSiteRecord = { fields: { nextEvent: 'Open house' }, items: [], syncedAtMs: 2 }

const PAGE: PluginConnectionRecordsPageData = {
  nodes: { 'node-reviews': 'listing-a', 'node-calendar': 'listing-b' },
  records: {
    'listing-a': { reviews: REVIEWS },
    'listing-b': { calendar: CALENDAR, reviews: { fields: { rating: 1 }, items: [], syncedAtMs: 3 } },
  },
}

/** What the hook answers for `connectionId`, rendered as an element at `nodeId` would be. */
function read(connectionId: string, options: { nodeId?: string; page?: PluginConnectionRecordsPageData; wrap?: (child: ReactNode) => ReactNode }): unknown {
  let answer: unknown = 'unset'
  function Element(): null {
    answer = usePluginConnectionRecord(connectionId)
    return null
  }
  let tree: ReactNode = createElement(Element)
  if (options.wrap) tree = options.wrap(tree)
  tree = createElement(RealmElementNodeContext.Provider, { value: options.nodeId }, tree)
  tree = createElement(PluginConnectionRecordsContext.Provider, { value: options.page }, tree)
  renderToStaticMarkup(createElement('div', null, tree))
  return answer
}

describe('usePluginConnectionRecord (AGL-4195)', () => {
  it('hands an element its own listing’s record', () => {
    expect(read('reviews', { nodeId: 'node-reviews', page: PAGE })).toEqual(REVIEWS)
    expect(read('calendar', { nodeId: 'node-calendar', page: PAGE })).toEqual(CALENDAR)
  })

  it('refuses another listing’s record: the connection id alone never crosses listings', () => {
    // listing-a declares no `calendar`; listing-b's is not reachable from listing-a's element.
    expect(read('calendar', { nodeId: 'node-reviews', page: PAGE })).toBeNull()
    // Both declare `reviews`: each element still reads its OWN.
    expect(read('reviews', { nodeId: 'node-calendar', page: PAGE })).toEqual({ fields: { rating: 1 }, items: [], syncedAtMs: 3 })
  })

  it('cannot be pointed at another element by the bundle: NodeIdentityContext proves nothing', () => {
    // A bundle can provide NodeIdentityContext (it is on the surface); the hook does not read it.
    const forged = read('calendar', {
      nodeId: 'node-reviews',
      page: PAGE,
      wrap: (child) => createElement(NodeIdentityContext.Provider, { value: 'node-calendar' }, child),
    })
    expect(forged).toBeNull()
  })

  it('answers null outside a signed element, on a page with no records, and for an unknown node', () => {
    expect(read('reviews', { page: PAGE })).toBeNull()
    expect(read('reviews', { nodeId: 'node-reviews' })).toBeNull()
    expect(read('reviews', { nodeId: 'node-other', page: PAGE })).toBeNull()
  })

  it('reads nothing inherited from Object.prototype', () => {
    expect(pluginConnectionRecordFor(PAGE, 'constructor', 'reviews')).toBeNull()
    expect(pluginConnectionRecordFor(PAGE, 'node-reviews', 'toString')).toBeNull()
    expect(pluginConnectionRecordFor({ nodes: { n: '__proto__' }, records: {} }, 'n', 'reviews')).toBeNull()
  })

  it('is on the realm host surface, and the contexts it reads are not', () => {
    expect(REALM_HOST_SURFACE_NAMES.aglyn.has('usePluginConnectionRecord')).toBe(true)
    for (const name of ['PluginConnectionRecordsContext', 'RealmElementNodeContext', 'pluginConnectionRecordFor', 'PLUGIN_CONNECTION_RECORDS_PROP']) {
      expect(REALM_HOST_SURFACE_NAMES.aglyn.has(name)).toBe(false)
    }
    expect(PLUGIN_CONNECTION_RECORDS_PROP).toBe('pluginConnectionRecords')
  })
})
