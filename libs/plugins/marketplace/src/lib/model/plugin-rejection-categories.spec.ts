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

import {
  PLUGIN_REJECTION_CATEGORIES,
  pluginRejectionCategory,
  rejectionCategoriesFor,
  rejectionHeadline,
  rejectionInputError,
  SITE_STARTER_REJECTION_CATEGORIES,
} from './plugin-rejection-categories'

describe('PLUGIN_REJECTION_CATEGORIES', () => {
  it('has unique, storage-safe ids', () => {
    // These are persisted on the version doc and in adminAudit, so an id is a
    // data contract — a duplicate would merge two reasons in any count.
    const ids = PLUGIN_REJECTION_CATEGORIES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('gives every category a label and guidance', () => {
    // Guidance is what turns a rejection into something a publisher can act
    // on; a category without it is a label that says "no" and nothing else.
    for (const entry of PLUGIN_REJECTION_CATEGORIES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.guidance.length).toBeGreaterThan(0)
    }
  })

  it('requires a comment on exactly one category — "other"', () => {
    // If more categories demanded prose, the required field would collect
    // "." and stop meaning anything. If none did, "Other" alone would say
    // nothing at all.
    const requiring = PLUGIN_REJECTION_CATEGORIES.filter(
      (entry) => entry.requiresComment,
    )
    expect(requiring.map((entry) => entry.id)).toEqual(['other'])
  })
})

describe('rejectionInputError', () => {
  it('refuses a rejection with no category', () => {
    // The whole point of AGL-977: free text alone is no longer a rejection.
    expect(rejectionInputError('', 'it is bad')).toBe('Pick a rejection reason')
    expect(rejectionInputError(null, '')).toBe('Pick a rejection reason')
  })

  it('refuses a category nobody defined', () => {
    // A typo'd or stale id must not be persisted as though it were real —
    // it would be uncountable and unrenderable later.
    expect(rejectionInputError('made-up', 'x')).toBe('Pick a rejection reason')
  })

  it('accepts a real category with no comment', () => {
    expect(rejectionInputError('readme', '')).toBeNull()
    expect(rejectionInputError('verifier', undefined)).toBeNull()
  })

  it('requires a comment for "other", and whitespace is not one', () => {
    expect(rejectionInputError('other', '')).toContain('needs a comment')
    expect(rejectionInputError('other', '   ')).toContain('needs a comment')
    expect(rejectionInputError('other', 'talks to a crypto miner')).toBeNull()
  })
})

describe('rejectionHeadline', () => {
  it('leads with the category', () => {
    expect(rejectionHeadline('readme', 'no docs at all')).toBe(
      'Missing or inadequate README',
    )
  })

  it('falls back to the free text for rows written before categories', () => {
    // Existing rejections have a reason and no category. Rendering those as
    // "Other" would put words in a reviewer's mouth they never used.
    expect(rejectionHeadline('', 'bundle is minified beyond reading')).toBe(
      'bundle is minified beyond reading',
    )
    expect(rejectionHeadline(undefined, undefined)).toBe('Rejected')
  })

  it('truncates a long legacy reason so it can be a subject line', () => {
    expect(rejectionHeadline('', 'x'.repeat(400)).length).toBe(120)
  })
})

/*
 * A site starter is turned down for what it is (AGL-4049): its pages, the
 * words and pictures on them, its theme. A plugin's reasons are about code,
 * and a publisher told "obfuscated bundle" about a site has nothing to fix.
 */
describe('the reasons a site starter is rejected for (AGL-4049)', () => {
  it('are its own, with the two that fit anything shared', () => {
    const ids = SITE_STARTER_REJECTION_CATEGORIES.map((entry) => entry.id)
    expect(ids).toEqual(['starter-pages', 'starter-content', 'starter-theme', 'starter-not-as-described', 'duplicate', 'other'])
    for (const id of ['duplicate', 'other']) {
      expect(SITE_STARTER_REJECTION_CATEGORIES.find((entry) => entry.id === id)).toBe(
        PLUGIN_REJECTION_CATEGORIES.find((entry) => entry.id === id),
      )
    }
  })

  it('never use an id a plugin reason means something else by', () => {
    const plugin = new Set(PLUGIN_REJECTION_CATEGORIES.map((entry) => entry.id))
    for (const entry of SITE_STARTER_REJECTION_CATEGORIES) {
      if (plugin.has(entry.id)) expect(pluginRejectionCategory(entry.id)).toBe(entry)
    }
  })

  it('tell a publisher what to do, never about code', () => {
    for (const entry of SITE_STARTER_REJECTION_CATEGORIES.slice(0, 4)) {
      expect(entry.guidance).toMatch(/publish/i)
      expect(`${entry.label} ${entry.guidance}`).not.toMatch(/bundle|repository|plugin/i)
    }
  })

  it('are picked by type, and a reason from the other list is refused', () => {
    expect(rejectionCategoriesFor('siteStarter')).toBe(SITE_STARTER_REJECTION_CATEGORIES)
    expect(rejectionCategoriesFor('plugin')).toBe(PLUGIN_REJECTION_CATEGORIES)
    expect(rejectionInputError('starter-theme', '', 'siteStarter')).toBeNull()
    expect(rejectionInputError('readme', '', 'siteStarter')).toBe('Pick a rejection reason')
    expect(rejectionInputError('starter-theme', '', 'plugin')).toBe('Pick a rejection reason')
    expect(rejectionInputError('other', '', 'siteStarter')).toContain('needs a comment')
  })

  it('lead the headline like any other reason', () => {
    expect(rejectionHeadline('starter-content', '')).toBe(
      SITE_STARTER_REJECTION_CATEGORIES.find((entry) => entry.id === 'starter-content')?.label,
    )
  })
})
