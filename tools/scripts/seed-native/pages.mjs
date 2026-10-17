/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A site with a big page tree for the apps' Pages list (AGL-3896): Juniper
 * Street Cafe gets 60 top-level pages and groups beside its home page, three
 * groups that hold pages, and pages under those pages (three levels), so the
 * collapsed tree, its chevrons and counts, the 25-row paging and the search
 * all have something to show. Shapes are what the hub's resources route
 * writes: `displayName`, `nameLower`, `slug`, `parentId`, `order`, `kind`.
 */

const SITE = 'mobile-studio-north'

export async function seedPages({ put, now }) {
  const page = (id, data) => put(`hosts/${SITE}/screens/${id}`, { hostId: SITE, createdAt: now, ...data })
  const named = (name, extra = {}) => ({ displayName: name, nameLower: name.toLowerCase(), ...extra })
  let written = 0
  const groups = [
    { id: 'cafe-menus', name: 'Menus', pages: ['Breakfast', 'Lunch', 'Dinner', 'Drinks', 'Desserts'] },
    { id: 'cafe-events', name: 'Events', pages: ['Live music', 'Trivia night', 'Private parties'] },
    { id: 'cafe-services', name: 'Services', pages: ['Catering', 'Gift cards', 'Coffee subscriptions'] },
  ]
  for (const [index, group] of groups.entries()) {
    await page(group.id, named(group.name, { kind: 'group', order: index + 1 }))
    written++
    for (const [at, name] of group.pages.entries()) {
      const id = `${group.id}-${at}`
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      await page(id, named(name, { slug, parentId: group.id, order: at }))
      written++
      // The third level: two pages under each group's first page.
      if (at === 0) {
        for (const child of ['Seasonal', 'Archive']) {
          await page(`${id}-${child.toLowerCase()}`, named(`${name} ${child.toLowerCase()}`, { slug: `${slug}-${child.toLowerCase()}`, parentId: id, order: 0 }))
          written++
        }
      }
    }
  }
  // With the home page and the three groups, 60 rows at the top level: more than two pages of 25.
  for (let i = 1; i <= 56; i++) {
    const n = String(i).padStart(2, '0')
    await page(`cafe-story-${n}`, named(`Story ${n}`, { slug: `story-${n}`, order: 10 + i }))
    written++
  }
  return { site: SITE, pages: written }
}
