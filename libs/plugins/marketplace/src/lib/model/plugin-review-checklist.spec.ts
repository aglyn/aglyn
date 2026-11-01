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
 * Each reviewed artifact type has its own checklist (AGL-4049).
 *
 * A plugin's checklist is about code: its repository, its capabilities, its
 * bundle. None of that exists on a site starter, which is pages, a layout and
 * a theme that a person's new site is made of. Holding a starter to the plugin
 * list would leave every item either impossible or ticked without meaning, so
 * a starter carries its own list, and the gate picks the list by type.
 */

import {
  outstandingChecklistItems,
  PLUGIN_REVIEW_CHECKLIST,
  REQUIRED_CHECKLIST_IDS,
  requiredChecklistIds,
  reviewChecklistFor,
  SITE_STARTER_REVIEW_CHECKLIST,
} from './plugin-review-checklist'

const byId = (id: string) => PLUGIN_REVIEW_CHECKLIST.find((item) => item.id === id)

describe('the site starter checklist (AGL-4049)', () => {
  it('asks what a starter needs: its pages, whose words and pictures, the theme, the publisher, the copy', () => {
    expect(SITE_STARTER_REVIEW_CHECKLIST.map((item) => item.id)).toEqual([
      'starter-pages',
      'starter-content',
      'starter-theme',
      'publisher',
      'positioning',
    ])
  })

  it('requires every item before a starter is listed', () => {
    expect(SITE_STARTER_REVIEW_CHECKLIST.every((item) => item.required)).toBe(true)
    expect(requiredChecklistIds('siteStarter')).toEqual(SITE_STARTER_REVIEW_CHECKLIST.map((item) => item.id))
  })

  it('reuses the publisher and positioning items word for word', () => {
    for (const id of ['publisher', 'positioning']) {
      expect(SITE_STARTER_REVIEW_CHECKLIST.find((item) => item.id === id)).toBe(byId(id))
    }
  })

  it('says why each starter item matters, and never asks about code', () => {
    for (const item of SITE_STARTER_REVIEW_CHECKLIST.slice(0, 3)) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.detail.length).toBeGreaterThan(0)
      expect(`${item.label} ${item.detail}`).not.toMatch(/bundle|repository|capabilit/i)
    }
  })
})

describe('the list is picked by artifact type', () => {
  it('gives a plugin the plugin list and a starter the starter list', () => {
    expect(reviewChecklistFor('plugin')).toBe(PLUGIN_REVIEW_CHECKLIST)
    expect(reviewChecklistFor('siteStarter')).toBe(SITE_STARTER_REVIEW_CHECKLIST)
  })

  it('falls back to the plugin list for an older caller that names no type', () => {
    expect(reviewChecklistFor(undefined)).toBe(PLUGIN_REVIEW_CHECKLIST)
    expect(requiredChecklistIds()).toEqual(REQUIRED_CHECKLIST_IDS)
  })
})

describe('what is outstanding, per type', () => {
  it('keeps a plugin tick pinned to the bytes it was made against', () => {
    const ticked = Object.fromEntries(REQUIRED_CHECKLIST_IDS.map((id) => [id, { by: 's', sha256: 'abc' }]))
    expect(outstandingChecklistItems(ticked, 'abc')).toEqual([])
    expect(outstandingChecklistItems(ticked, 'def')).toEqual(REQUIRED_CHECKLIST_IDS)
  })

  it('keeps a starter tick pinned to the version it was made against', () => {
    const ids = requiredChecklistIds('siteStarter')
    const ticked = Object.fromEntries(ids.map((id) => [id, { by: 's', version: '2' }]))
    expect(outstandingChecklistItems(ticked, '2', 'siteStarter')).toEqual([])
    // A re-publish is a new version, and starts the list again.
    expect(outstandingChecklistItems(ticked, '3', 'siteStarter')).toEqual(ids)
  })

  it('never counts a plugin tick toward a starter, or a starter tick toward a plugin', () => {
    const plugin = Object.fromEntries(REQUIRED_CHECKLIST_IDS.map((id) => [id, { by: 's', sha256: '2' }]))
    expect(outstandingChecklistItems(plugin, '2', 'siteStarter')).toEqual(requiredChecklistIds('siteStarter'))
    const starter = Object.fromEntries(requiredChecklistIds('siteStarter').map((id) => [id, { by: 's', version: 'x' }]))
    expect(outstandingChecklistItems(starter, 'x')).toEqual(REQUIRED_CHECKLIST_IDS)
  })

  it('holds nothing as done with no pin to compare', () => {
    expect(outstandingChecklistItems({}, '', 'siteStarter')).toEqual(requiredChecklistIds('siteStarter'))
    expect(outstandingChecklistItems(null, '')).toEqual(REQUIRED_CHECKLIST_IDS)
  })
})
