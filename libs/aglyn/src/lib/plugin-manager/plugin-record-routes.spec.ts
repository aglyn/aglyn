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
  listPluginRecordRouteKinds,
  pluginRecordByEmailHref,
  pluginRecordFilteredHref,
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
  registerPluginRecordRoute,
  type PluginRecordRoute,
  type PluginRecordRouteContext,
} from './plugin-record-routes'
import {
  resetPluginServicesForTests,
  unregisterPluginServices,
} from './plugin-services'

/**
 * The seam with no CRM, forms or marketing in it: a `cellar` plugin publishes
 * where its bottles are read, and an unrelated `almanac` plugin links to one
 * from its own page knowing only the record kind. The almanac never learns
 * the cellar's hub slug, its section names or how an id is escaped.
 */

const CELLAR_BOTTLES: PluginRecordRoute = {
  list: ({ orgSlug, host }) =>
    host
      ? `/${orgSlug}/hosts/${host}/cellar/bottles`
      : // The org-level cellar lists every site's bottles.
        `/${orgSlug}/cellar/bottles`,
  record(context, id) {
    const list = this.list(context)
    return list ? `${list}/${encodeURIComponent(id)}` : null
  },
  byEmail(context, email) {
    const list = this.list(context)
    return list
      ? `${list}?${new URLSearchParams({ keeper: email }).toString()}`
      : null
  },
  filtered(context, filter, value) {
    if (filter !== 'shelf') return null
    const list = this.list(context)
    return list
      ? `${list}?${new URLSearchParams({ shelf: value }).toString()}`
      : null
  },
}

/** A tasting is read on the site that held it; there is no org-level page. */
const CELLAR_TASTINGS: PluginRecordRoute = {
  list: ({ orgSlug, host }) =>
    host ? `/${orgSlug}/hosts/${host}/cellar/tastings` : null,
  record(context, id) {
    const list = this.list(context)
    return list ? `${list}/${encodeURIComponent(id)}` : null
  },
}

function registerCellarRoutes(): void {
  registerPluginRecordRoute('bottle', CELLAR_BOTTLES)
  registerPluginRecordRoute('tasting', CELLAR_TASTINGS)
}

/** The almanac's card: it names a kind, never a plugin and never a path. */
function almanacLink(
  kind: string,
  id: string,
  context: PluginRecordRouteContext,
): string {
  return pluginRecordHref(kind, context, id) ?? `${kind} ${id}`
}

const SITE: PluginRecordRouteContext = { orgSlug: 'acme', host: 'shop' }
const ORG: PluginRecordRouteContext = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('plugin record routes', () => {
  it('lets a plugin publish its own addresses and another plugin link to one by kind', () => {
    setRegisteringPluginId('cellar')
    registerCellarRoutes()
    setRegisteringPluginId(undefined)

    expect(pluginRecordRoute('bottle')?.pluginId).toBe('cellar')
    expect(almanacLink('bottle', 'b-1', SITE)).toBe(
      '/acme/hosts/shop/cellar/bottles/b-1',
    )
    expect(almanacLink('bottle', 'b/1', SITE)).toBe(
      '/acme/hosts/shop/cellar/bottles/b%2F1',
    )
    expect(pluginRecordListHref('bottle', SITE)).toBe(
      '/acme/hosts/shop/cellar/bottles',
    )
    expect(pluginRecordByEmailHref('bottle', SITE, 'a@b.test')).toBe(
      '/acme/hosts/shop/cellar/bottles?keeper=a%40b.test',
    )
    expect(pluginRecordFilteredHref('bottle', SITE, 'shelf', 'top')).toBe(
      '/acme/hosts/shop/cellar/bottles?shelf=top',
    )
    expect(listPluginRecordRouteKinds()).toEqual([
      { kind: 'bottle', pluginId: 'cellar' },
      { kind: 'tasting', pluginId: 'cellar' },
    ])
  })

  it('serves the organization scope only where the owner has one', () => {
    registerPluginRecordRoute('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    registerPluginRecordRoute('tasting', CELLAR_TASTINGS, { pluginId: 'cellar' })

    expect(almanacLink('bottle', 'b-1', ORG)).toBe('/acme/cellar/bottles/b-1')
    // A tasting has no org-level page, so the caller renders text.
    expect(almanacLink('tasting', 't-1', ORG)).toBe('tasting t-1')
    expect(pluginRecordListHref('tasting', ORG)).toBeNull()
  })

  it('answers null for a kind nobody publishes, for an address the owner does not offer, and for an unknown filter', () => {
    expect(pluginRecordHref('bottle', SITE, 'b-1')).toBeNull()
    expect(almanacLink('bottle', 'b-1', SITE)).toBe('bottle b-1')

    registerPluginRecordRoute('tasting', CELLAR_TASTINGS, { pluginId: 'cellar' })
    // The owner publishes the kind but offers no address lookup on it.
    expect(pluginRecordByEmailHref('tasting', SITE, 'a@b.test')).toBeNull()

    registerPluginRecordRoute('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(pluginRecordFilteredHref('bottle', SITE, 'crate', 'oak')).toBeNull()
  })

  it('stops answering once the owner unloads', () => {
    registerPluginRecordRoute('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(pluginRecordHref('bottle', SITE, 'b-1')).not.toBeNull()

    unregisterPluginServices('cellar')
    expect(pluginRecordRoute('bottle')).toBeNull()
    expect(pluginRecordHref('bottle', SITE, 'b-1')).toBeNull()
    expect(listPluginRecordRouteKinds()).toEqual([])
  })

  it('keeps one owner per kind: a second plugin is refused naming both, and the owner re-publishes its own', () => {
    registerPluginRecordRoute('bottle', CELLAR_BOTTLES, { pluginId: 'cellar' })
    expect(() =>
      registerPluginRecordRoute('bottle', CELLAR_TASTINGS, {
        pluginId: 'almanac',
      }),
    ).toThrow(
      'record kind "bottle" already publishes routes from "cellar"; refused "almanac"',
    )
    expect(pluginRecordHref('bottle', SITE, 'b-1')).toBe(
      '/acme/hosts/shop/cellar/bottles/b-1',
    )

    const moved: PluginRecordRoute = {
      list: ({ orgSlug, host }) =>
        host ? `/${orgSlug}/hosts/${host}/cellar/vault` : null,
      record(context, id) {
        const list = this.list(context)
        return list ? `${list}/${id}` : null
      },
    }
    registerPluginRecordRoute('bottle', moved, { pluginId: 'cellar' })
    expect(pluginRecordHref('bottle', SITE, 'b-1')).toBe(
      '/acme/hosts/shop/cellar/vault/b-1',
    )

    // The almanac's own kind is its own key, and both plugins publish.
    registerPluginRecordRoute('season', CELLAR_TASTINGS, { pluginId: 'almanac' })
    expect(listPluginRecordRouteKinds()).toEqual([
      { kind: 'bottle', pluginId: 'cellar' },
      { kind: 'season', pluginId: 'almanac' },
    ])
  })

  it('needs a record kind and an owner', () => {
    expect(() =>
      registerPluginRecordRoute('  ', CELLAR_BOTTLES, { pluginId: 'cellar' }),
    ).toThrow('a record route needs a record kind')
    expect(() => registerPluginRecordRoute('bottle', CELLAR_BOTTLES)).toThrow(
      /no owner/,
    )
  })
})
