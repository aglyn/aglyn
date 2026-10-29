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
 * A site starter's category is a kind of site (AGL-4049).
 *
 * The seed files each of the platform's starters under its style's name
 * ("Home services & trades"), and the starter shelf groups by it. The listing
 * editor offered only the plugin taxonomy ("analytics", "seo", …), so a
 * starter opened with a value its own Category menu did not have, and saving
 * it was refused as outside the taxonomy.
 */

import { SITE_STYLES } from '@aglyn/aglyn/app-utils/site-styles'
import {
  SITE_STARTER_CATEGORIES,
  siteStarterCategoryOptions,
  siteStarterCategoryUpdate,
} from './starter-category'

describe('the categories a site starter is filed under (AGL-4049)', () => {
  it('are the style names, in the order a person is shown them', () => {
    expect(SITE_STARTER_CATEGORIES).toEqual(SITE_STYLES.map((style) => style.name))
    expect(SITE_STARTER_CATEGORIES).toContain('Home services & trades')
  })

  it('keep a stored category the list does not have, so the menu never opens on a value it lacks', () => {
    expect(siteStarterCategoryOptions('Home services & trades')).toEqual(SITE_STARTER_CATEGORIES)
    expect(siteStarterCategoryOptions('design')).toEqual([...SITE_STARTER_CATEGORIES, 'design'])
    expect(siteStarterCategoryOptions('  ')).toEqual(SITE_STARTER_CATEGORIES)
    expect(siteStarterCategoryOptions(undefined)).toEqual(SITE_STARTER_CATEGORIES)
  })
})

describe('a starter category save', () => {
  it('takes a style name, or none', () => {
    expect(siteStarterCategoryUpdate({ category: 'Restaurant & café' }, 'design')).toEqual({ ok: true, category: 'Restaurant & café' })
    expect(siteStarterCategoryUpdate({ category: '' }, 'design')).toEqual({ ok: true, category: null })
  })

  it('keeps the category it already has, whatever it is', () => {
    expect(siteStarterCategoryUpdate({ category: 'design' }, 'design')).toEqual({ ok: true, category: 'design' })
  })

  it('reads the older list shape a native editor sends', () => {
    expect(siteStarterCategoryUpdate({ categories: ['Portfolio'] }, null)).toEqual({ ok: true, category: 'Portfolio' })
    expect(siteStarterCategoryUpdate({ categories: [] }, 'Portfolio')).toEqual({ ok: true, category: null })
  })

  it('leaves the category alone when the save names none', () => {
    expect(siteStarterCategoryUpdate({}, 'Portfolio')).toEqual({ ok: true, category: undefined })
  })

  it('refuses a category that is neither a style nor the one it has', () => {
    const refused = siteStarterCategoryUpdate({ category: 'analytics' }, 'Portfolio')
    expect(refused.ok).toBe(false)
    expect(refused).toMatchObject({ error: 'Pick the kind of site this starter is from the Category menu' })
    expect(siteStarterCategoryUpdate({ category: 42 }, null).ok).toBe(false)
  })
})
