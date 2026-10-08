/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo site's content for the Aglyn app's content screens (AGL-3668):
 * its pages (a home page, a group, nested pages, a draft) with their
 * versions and the routing map that makes some of them live; components,
 * layouts and templates (with a starter bundle); a blog collection with
 * categories, authors and entries; the site's setup (logo, business details,
 * SEO, tracking, consent, a saved theme with edits, a customized email);
 * and the workspace's datasets with typed records.
 *
 * Shapes are what the console's writers leave: `/api/hosts/resources` and
 * `/api/hosts/versions` for pages and their first versions (with the
 * `nameLower`/`nameTokens`/`nameReversed` list keys), the routing map as
 * `publishScreenRoute` writes it (`/` for the home page, `parent/child`
 * below), `/api/hosts/collections` for a content collection and its
 * entries, and `/api/orgs/datasets` for a dataset (its `model`) and records
 * (`values` plus `filterKeys`/`filterValues`). A site member reads all of it
 * under the real rules.
 */

const key = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** `nameSearchTokens` from `libs/aglyn/src/lib/app-utils/name-search.ts`: word prefixes, 12 deep. */
function nameSearchTokens(text) {
  const tokens = new Set()
  for (const word of key(text).split(' ')) {
    if (!word) continue
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= 120) return [...tokens]
    }
  }
  return [...tokens]
}

const listKeys = (name) => ({
  nameLower: key(name),
  nameTokens: nameSearchTokens(name),
  nameReversed: [...key(name)].reverse().join(''),
})

export async function seedContent({ put, uid, orgId, hostId, now }) {
  const day = 24 * 60 * 60 * 1000
  const ago = (days) => new Date(now.getTime() - days * day)

  // --- Pages: the hub's tree, some live. -----------------------------------
  const pages = [
    { id: 'page-home', name: 'Home', slug: '/', order: 0, live: '/', created: 40 },
    { id: 'page-about', name: 'About us', slug: 'about', order: 1, live: 'about', created: 38, description: 'Who we are and how we work' },
    { id: 'group-services', name: 'Services', kind: 'group', order: 2, created: 30 },
    { id: 'page-design', name: 'Web design', slug: 'web-design', parentId: 'group-services', order: 0, live: 'web-design', created: 29 },
    { id: 'page-seo', name: 'SEO audits', slug: 'seo-audits', parentId: 'group-services', order: 1, live: 'seo-audits', created: 28 },
    { id: 'page-pricing', name: 'Pricing', slug: 'pricing', order: 3, live: 'pricing', created: 25 },
    { id: 'page-team', name: 'Our team', slug: 'team', parentId: 'page-about', order: 0, live: 'about/team', created: 20 },
    { id: 'page-careers', name: 'Careers', slug: 'careers', parentId: 'page-about', order: 1, created: 6, description: 'Not published yet' },
    { id: 'page-launch', name: 'Spring launch', order: 4, created: 2, description: 'A draft with no address yet' },
  ]
  const routes = {}
  for (const page of pages) {
    const versionId = page.kind === 'group' ? null : `${page.id}-v1`
    await put(`hosts/${hostId}/screens/${page.id}`, {
      displayName: page.name,
      ...listKeys(page.name),
      ...(page.description ? { description: page.description } : {}),
      ...(page.slug ? { slug: page.slug } : {}),
      ...(page.parentId ? { parentId: page.parentId } : {}),
      ...(page.kind ? { kind: page.kind } : {}),
      order: page.order,
      ...(versionId ? { versionId } : {}),
      deletedAt: null,
      createdBy: uid,
      createdAt: ago(page.created),
      updatedAt: ago(Math.min(page.created, 3)),
      ...(page.live ? { publishedAt: ago(Math.min(page.created, 5)) } : {}),
    })
    if (versionId) {
      for (const [index, label] of ['Initial version', 'Refreshed copy'].entries()) {
        await put(`hosts/${hostId}/screens/${page.id}/versions/${page.id}-v${index + 1}`, {
          screenId: page.id,
          displayName: label,
          createdAt: ago(page.created - index),
          updatedAt: ago(page.created - index),
        })
      }
    }
    if (page.live) routes[page.id] = page.live
  }
  await put(`hosts/${hostId}`, { screens: routes }, { merge: true })

  // --- Components, layouts and templates: the Besigner's lists. -----------
  const artifacts = [
    ['components', 'cmp-hero', 'Hero banner', { kind: 'site', description: 'Headline, photo and a button' }],
    ['components', 'cmp-testimonials', 'Testimonials', { kind: 'site', description: 'Three quotes in a row' }],
    ['components', 'cmp-email-footer', 'Email footer', { kind: 'email', description: 'Address and unsubscribe' }],
    ['layouts', 'lay-main', 'Main layout', { description: 'Header, page, footer' }],
    ['layouts', 'lay-landing', 'Landing layout', { description: 'No navigation' }],
    ['templates', 'tpl-service', 'Service page', { kind: 'page', libraryRow: true, source: { type: 'authored' }, description: 'A service with pricing' }],
    ['templates', 'tpl-cta', 'Call to action', { kind: 'component', libraryRow: true, source: { type: 'authored' } }],
    ['layouts', 'lay-docs', 'Docs layout', { description: 'Inside the main layout', layoutId: 'lay-main' }],
  ]
  // A component saved before its first version: the Besigner mints one on open.
  const unversioned = new Set(['cmp-email-footer'])
  for (const [collection, id, name, extra] of artifacts) {
    const versioned = collection !== 'templates' && !unversioned.has(id)
    await put(`hosts/${hostId}/${collection}/${id}`, {
      hostId,
      displayName: name,
      ...listKeys(name),
      ...extra,
      ...(versioned ? { versionId: `${id}-v1` } : {}),
      createdAt: ago(15),
      updatedAt: ago(3),
    })
    if (versioned) {
      await put(`hosts/${hostId}/${collection}/${id}/versions/${id}-v1`, {
        [collection === 'layouts' ? 'layoutId' : 'componentId']: id,
        hostId,
        displayName: 'Initial version',
        createdAt: ago(15),
        updatedAt: ago(15),
      })
    }
  }

  // A starter bundle: three pages that share `source.starterId`; only the
  // lead row is listed (`libraryRow`).
  const starter = [
    ['tpl-start-home', 'Home', 0],
    ['tpl-start-about', 'About', 1],
    ['tpl-start-contact', 'Contact', 2],
  ]
  for (const [id, name, order] of starter) {
    await put(`hosts/${hostId}/templates/${id}`, {
      hostId,
      displayName: name,
      ...listKeys(name),
      kind: 'page',
      libraryRow: order === 0,
      source: { type: 'starter', starterId: 'bakery-starter', starterName: 'Bakery starter', starterOrder: order },
      createdAt: ago(30),
      updatedAt: ago(30),
    })
  }

  // --- The site's setup: what the Setup sections show. --------------------
  await put(
    `hosts/${hostId}`,
    {
      logoUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=256',
      business: {
        supportEmail: 'hello@mobile-demo.test',
        address: '12 Main St\nPortland, OR 97201',
        socialLinks: [
          { label: 'Instagram', url: 'https://instagram.com/mobiledemo' },
          { label: 'Facebook', url: 'https://facebook.com/mobiledemo' },
        ],
      },
      locales: ['en'],
      defaultLocale: 'en',
      seo: {
        title: 'Mobile Demo Bakery',
        description: 'Fresh bread and pastries, baked every morning in Portland.',
        separator: '|',
        favicon: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=64',
        entity: {
          type: '1',
          name: 'Mobile Demo Bakery',
          email: 'hello@mobile-demo.test',
          telephone: '+1 503 555 0100',
          businessType: 'FoodEstablishment',
          areaServed: ['Portland', 'Beaverton'],
          openingHours: 'Mo-Fr 07:00-15:00\nSa 08:00-13:00',
          priceRange: '$$',
          address: { streetAddress: '12 Main St', addressLocality: 'Portland', addressRegion: 'OR', postalCode: '97201', addressCountry: 'US' },
        },
        verification: { google: 'mobileDemoGoogleToken_123' },
      },
      analytics: { gaMeasurementId: 'G-DEMO12345' },
      consent: { mode: 'geo' },
      themeSelection: { kind: 'custom', id: 'theme-warm', name: 'Warm' },
      theme: { colorSchemes: { light: { primary: { main: '#8a4b2a' } } }, shape: { borderRadius: 8 } },
      themeOverride: { patch: { colorSchemes: { light: { secondary: { main: '#d9a441' } } } }, baseSha256: null },
    },
    { merge: true },
  )
  await put(`hosts/${hostId}/themes/theme-warm`, {
    name: 'Warm',
    theme: { colorSchemes: { light: { primary: { main: '#8a4b2a' } } }, shape: { borderRadius: 8 } },
    createdAt: ago(12),
    updatedAt: ago(12),
  })
  await put(`hosts/${hostId}/themes/theme-cool`, {
    name: 'Cool',
    theme: { colorSchemes: { light: { primary: { main: '#1a5f8a' } } } },
    createdAt: ago(9),
    updatedAt: ago(9),
  })
  // One customized email: its design is a version the Besigner opens.
  await put(`hosts/${hostId}/emailTemplates/order-receipt`, {
    subject: 'Your order from Mobile Demo Bakery',
    versionId: 'order-receipt-v1',
    updatedAt: ago(4),
  })
  await put(`hosts/${hostId}/emailTemplates/order-receipt/versions/order-receipt-v1`, {
    templateKey: 'order-receipt',
    createdAt: ago(4),
    updatedAt: ago(4),
  })

  // --- Authors: the bylines entries are published under. ------------------
  const authors = [
    ['author-sam', 'Sam Rivera', 'sam-rivera'],
    ['author-ana', 'Ana Lopez', 'ana-lopez'],
  ]
  for (const [id, name, slug] of authors) {
    await put(`hosts/${hostId}/authors/${id}`, { type: 'Person', name, slug, createdAt: ago(20), updatedAt: ago(20) })
  }

  // --- A content collection with entries. ---------------------------------
  await put(`hosts/${hostId}/collections/blog`, {
    kind: 'content',
    displayName: 'Blog',
    slug: 'blog',
    schemaType: 'BlogPosting',
    categories: [
      { id: 'news', name: 'News' },
      { id: 'guides', name: 'Guides' },
      { id: 'recipes', name: 'Recipes' },
    ],
    listScreenId: 'page-design',
    createdAt: ago(20),
    updatedAt: ago(1),
  })
  const entries = [
    ['post-spring', 'Spring menu is here', 'spring-menu', 'published', 'news', 4],
    ['post-guide', 'How to order for an event', 'event-orders', 'published', 'guides', 9],
    ['post-draft', 'Behind the counter', 'behind-the-counter', 'draft', null, 1],
    ['post-scheduled', 'Summer hours', 'summer-hours', 'scheduled', 'news', 0],
    ['post-sourdough', 'Our sourdough starter', 'sourdough-starter', 'published', 'recipes', 14],
    ['post-croissant', 'Laminating croissant dough', 'croissant-dough', 'published', 'recipes', 21],
    ['post-holiday', 'Holiday pre-orders', 'holiday-pre-orders', 'draft', 'news', 2],
  ]
  for (const [index, [id, title, slug, status, categoryId, days]] of entries.entries()) {
    const author = authors[index % authors.length]
    const published = status === 'published' ? ago(days) : null
    const scheduled = status === 'scheduled' ? new Date(now.getTime() + 3 * day) : null
    await put(`hosts/${hostId}/collections/blog/entries/${id}`, {
      title,
      titleTokens: nameSearchTokens(title),
      slug,
      excerpt: `${title} — a short summary for the list.`,
      body: `# ${title}\n\nThe first paragraph of the post.`,
      status,
      ...(categoryId ? { categoryId } : {}),
      ...(status === 'draft' ? { authorName: 'Mobile Owner' } : { authorId: author[0], authorName: author[1] }),
      tags: ['seed'],
      ...(published ? { publishedAt: published, publishSortAt: published } : {}),
      ...(scheduled ? { publishAt: scheduled, publishSortAt: scheduled } : {}),
      createdBy: uid,
      createdAt: ago(days + 1),
      updatedAt: ago(days),
    })
  }

  // --- Datasets: the workspace's typed data. ------------------------------
  const model = {
    order: ['name', 'price', 'inStock', 'category', 'launched'],
    fields: {
      name: { name: 'Name', type: 'text', required: true },
      price: { name: 'Price', type: 'float', validation: { min: 0 } },
      inStock: { name: 'In stock', type: 'bool' },
      category: { name: 'Category', type: 'text', validation: { options: ['Bread', 'Pastry', 'Cake'] } },
      launched: { name: 'Launched', type: 'timestamp' },
    },
  }
  await put(`orgs/${orgId}/datasets/ds-menu`, {
    displayName: 'Menu items',
    fields: model.order,
    model,
    names: { singular: 'Menu item', plural: 'Menu items' },
    visibleTo: ['org'],
    createdAt: ago(25),
    updatedAt: ago(2),
  })
  const records = [
    ['rec-sourdough', 'Sourdough loaf', 8.5, true, 'Bread', 60],
    ['rec-croissant', 'Butter croissant', 3.75, true, 'Pastry', 45],
    ['rec-carrot', 'Carrot cake', 32, false, 'Cake', 30],
    ['rec-rye', 'Seeded rye', 7, true, 'Bread', 12],
  ]
  for (const [index, [id, name, price, inStock, category, launched]] of records.entries()) {
    const words = key(name).split(' ')
    await put(`orgs/${orgId}/datasets/ds-menu/records/${id}`, {
      values: { name, price, inStock, category, launched: now.getTime() - launched * day },
      filterKeys: [...new Set(words.flatMap((word) => [...word.slice(0, 12)].map((_, end) => [`s:${word.slice(0, end + 1)}`, `f:name^${word.slice(0, end + 1)}`]).flat()))],
      filterValues: { name: key(name).slice(0, 64), price, inStock, category },
      order: index,
      createdAt: ago(launched),
      updatedAt: ago(1),
    })
  }
  await put(`orgs/${orgId}/datasets/ds-locations`, {
    displayName: 'Locations',
    fields: ['city', 'address', 'open'],
    model: {
      order: ['city', 'address', 'open'],
      fields: { city: { name: 'City', type: 'text' }, address: { name: 'Address', type: 'text' }, open: { name: 'Open', type: 'bool' } },
    },
    names: { singular: 'Location', plural: 'Locations' },
    visibleTo: ['org'],
    createdAt: ago(10),
  })
  await put(`orgs/${orgId}/datasets/ds-locations/records/loc-main`, {
    values: { city: 'Portland', address: '12 Main St', open: true },
    filterKeys: ['s:p', 's:po', 's:por', 's:port', 's:portl', 's:portla', 's:portlan', 's:portland'],
    filterValues: { city: 'portland', address: '12 main st', open: true },
    order: 0,
    createdAt: ago(10),
    updatedAt: ago(10),
  })
}
