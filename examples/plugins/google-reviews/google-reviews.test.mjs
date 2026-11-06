#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Google reviews bundle, as it ships (AGL-4197).
 *
 *   node --test examples/plugins/google-reviews/google-reviews.test.mjs
 *
 * Builds `src/` with this folder's Rollup config and holds the checked-in
 * `dist/plugin.bundle.mjs` to it byte for byte, checks the manifest and the
 * bundle the way the publish API does, then registers the SHIPPED bundle
 * against a host composed the way a site composes it (the app's React, MUI
 * and core's real host surface) and renders its element on the server with a
 * site theme and a fixture record, the way a published page does.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'
import {
  formatReviewDate,
  initialsOf,
  normalizeSettings,
  photoAllowed,
  selectReviews,
  starFill,
  starsLabel,
} from './src/reviews.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const BUNDLE_PATH = join(HERE, 'dist', 'plugin.bundle.mjs')
const MANIFEST = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'))
const COMPONENT_ID = 'aglyn.google-reviews.reviews'
const NODE_ID = 'node-reviews-1'

/** Workspace TypeScript, loaded the way `generate-plugin-manifests.mjs` loads it. */
let jitiInstance
function workspace(path) {
  if (!jitiInstance) {
    const require = createRequire(join(ROOT, 'package.json'))
    const { createJiti } = require('jiti')
    const { paths } = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions
    const alias = {}
    for (const [key, [target]] of Object.entries(paths)) {
      const path = target.replace(/^\.\//, '')
      alias[key.endsWith('/*') ? key.slice(0, -1) : key] = key.endsWith('/*')
        ? join(ROOT, path.replace(/\/?\*$/, '')) + '/'
        : join(ROOT, path)
    }
    jitiInstance = createJiti(join(ROOT, 'package.json'), { alias })
  }
  return jitiInstance.import(join(ROOT, path))
}

const DAY = 86_400_000
const MARCH_2026 = Date.UTC(2026, 2, 14)
const LONG = 'The crew showed up on time and explained every step. '.repeat(8).trim()

/** A record as the platform writes it from the manifest's declaration. */
const RECORD = {
  fields: {
    rating: 4.6,
    reviewCount: 44,
    reviewUrl: 'https://search.google.com/local/writereview?placeid=example',
  },
  items: [
    { reviewer: 'Jordan Lee', photo: 'https://lh3.googleusercontent.com/a/jordan=s120', anonymous: false, stars: 5, comment: 'Fast and friendly.', createdAt: MARCH_2026, reply: 'Thank you, Jordan!' },
    { reviewer: 'Pat Lee', photo: 'https://lh3.googleusercontent.com/a/pat=s120', anonymous: false, stars: 4, comment: LONG, createdAt: MARCH_2026 - DAY, reply: null },
    { reviewer: 'A Google User', photo: 'https://lh3.googleusercontent.com/a/anon=s120', anonymous: true, stars: 5, comment: null, createdAt: MARCH_2026 - 2 * DAY, reply: null },
    { reviewer: 'Sam Rivera', photo: 'https://images.example.com/sam.png', anonymous: false, stars: 3, comment: 'Good work, slow quote.', createdAt: MARCH_2026 - 3 * DAY, reply: null },
    { reviewer: 'Alex Kim', photo: null, anonymous: false, stars: 2, comment: 'Missed the first appointment.', createdAt: MARCH_2026 - 4 * DAY, reply: 'We are sorry, Alex.' },
    { reviewer: 'Robin Park', photo: null, anonymous: false, stars: null, comment: 'Rating Google did not give as stars.', createdAt: MARCH_2026 - 5 * DAY, reply: null },
    { reviewer: 'Casey Moore', photo: null, anonymous: false, stars: 5, comment: 'Would hire again.', createdAt: MARCH_2026 - 6 * DAY, reply: null },
    { reviewer: 'Drew Hall', photo: null, anonymous: false, stars: 1, comment: 'Not for me.', createdAt: MARCH_2026 - 7 * DAY, reply: null },
    { reviewer: 'Morgan Diaz', photo: null, anonymous: false, stars: 5, comment: 'Great.', createdAt: MARCH_2026 - 8 * DAY, reply: null },
  ],
  syncedAtMs: MARCH_2026,
}

/* ------------------------------------------------------------------ */
/* What ships                                                           */
/* ------------------------------------------------------------------ */

test('the checked-in bundle is the build of src/', async () => {
  const { default: config } = await import(join(HERE, 'rollup.config.mjs'))
  const bundle = await rollup({ ...config, onwarn: () => undefined })
  const { output } = await bundle.generate(config.output)
  await bundle.close()
  assert.equal(
    readFileSync(BUNDLE_PATH, 'utf8'),
    output[0].code,
    'dist/plugin.bundle.mjs is stale: run `npx rollup -c examples/plugins/google-reviews/rollup.config.mjs`',
  )
})

test('the manifest validates as a new version would', async () => {
  const { validatePluginManifest } = await workspace('libs/aglyn/src/lib/app-utils/plugin-manifest.ts')
  const verdict = validatePluginManifest(MANIFEST)
  assert.equal(verdict.ok, true, verdict.error)
  assert.deepEqual(verdict.manifest.capabilities.imageHosts, ['lh3.googleusercontent.com'])
  const [connection] = verdict.manifest.connections
  assert.equal(connection.id, 'google')
  assert.deepEqual(Object.keys(connection.sync.record.fields), ['rating', 'reviewCount', 'reviewUrl'])
})

test('the bundle verifies for publishing, connections included, and calls no Google host', async () => {
  const { checkPluginBundle } = await workspace('libs/aglyn/src/lib/app-utils/plugin-bundle-checks.ts')
  const verdict = checkPluginBundle(readFileSync(BUNDLE_PATH, 'utf8'), {
    declaredNetwork: MANIFEST.capabilities.network,
    declaredContributions: MANIFEST.contributes,
    declaredConnections: MANIFEST.connections,
    requireContributions: true,
  })
  assert.deepEqual(
    verdict.problems.filter((problem) => problem.level === 'error'),
    [],
  )
  assert.equal(verdict.ok, true)
  assert.doesNotMatch(readFileSync(BUNDLE_PATH, 'utf8'), /googleapis\.com|accounts\.google\.com|^\s*import\s/m)
})

test('each summary field is a site variable a token can name', async () => {
  const { pluginConnectionVariableId } = await workspace('libs/aglyn/src/lib/app-utils/plugin-connections.ts')
  // A listing id is a 20-character Firestore auto id.
  for (const field of ['rating', 'reviewCount', 'reviewUrl']) {
    assert.equal(
      pluginConnectionVariableId('Kq3vR7mXa2Lp9sT4bNw1', 'google', field),
      `Kq3vR7mXa2Lp9sT4bNw1__google-${field}`,
    )
  }
})

/* ------------------------------------------------------------------ */
/* The element, rendered from the shipped bundle                         */
/* ------------------------------------------------------------------ */

/** The host as a site composes it, the bundle registered, and its element. Once. */
let mounting
function mount() {
  mounting ??= compose()
  return mounting
}

async function compose() {
  const React = await import('react')
  const styles = await import('@mui/material/styles')
  const mui = {}
  for (const name of ['Box', 'Button', 'Card', 'CardContent', 'Link', 'Stack', 'SvgIcon', 'Typography']) {
    mui[name] = (await import(`@mui/material/${name}`)).default
  }
  const { AGLYN_HOST_SURFACE: surface } = await workspace(
    'libs/aglyn/src/lib/plugin-manager/realm-host-aglyn.generated.ts',
  )
  const aglyn = surface
  globalThis.__AGLYN_PLUGIN_HOST__ = {
    version: 1,
    React,
    jsxRuntime: await import('react/jsx-runtime'),
    aglyn,
    mui,
    muiStyles: { alpha: styles.alpha, styled: styles.styled, useTheme: styles.useTheme },
  }
  const bundle = await import(`data:text/javascript;base64,${readFileSync(BUNDLE_PATH).toString('base64')}`)
  bundle.register()
  bundle.register() // a second run registers nothing twice

  const { RealmElementNodeContext } = await workspace('libs/aglyn/src/lib/app-utils/realm-elements-context.ts')
  const { PluginConnectionRecordsContext } = await workspace(
    'libs/aglyn/src/lib/app-utils/plugin-connection-records-context.ts',
  )
  return {
    React,
    styles,
    surface,
    Element: surface.components.getFactory(COMPONENT_ID),
    schema: surface.components.getSchema(COMPONENT_ID),
    RealmElementNodeContext,
    PluginConnectionRecordsContext,
  }
}

/**
 * Renders the element as a published page does: the page's records prop, the
 * renderer's node context, the site's theme and style cache.
 */
async function render(props, { record = RECORD, editorInert = false, listing = 'listing-gr' } = {}) {
  const { React, styles, surface, Element, RealmElementNodeContext, PluginConnectionRecordsContext } = await mount()
  const { renderToString } = await import('react-dom/server')
  const { default: createCache } = await import('@emotion/cache')
  const { CacheProvider } = await import('@emotion/react')
  const cache = createCache({ key: 'site' })
  cache.compat = true
  const theme = styles.createTheme({
    palette: { primary: { main: '#1d4ed8' }, warning: { main: '#b45309' } },
  })
  const records = {
    nodes: { [NODE_ID]: listing },
    records: record ? { [listing]: { google: record } } : {},
  }
  const h = React.createElement
  const html = renderToString(
    h(
      CacheProvider,
      { value: cache },
      h(
        styles.ThemeProvider,
        { theme },
        h(
          surface.ScreenLinkContext.Provider,
          { value: editorInert ? { suppressNavigation: true, editorInert: true } : {} },
          h(
            PluginConnectionRecordsContext.Provider,
            { value: records },
            h(RealmElementNodeContext.Provider, { value: NODE_ID }, h(Element, props)),
          ),
        ),
      ),
    ),
  )
  return { html, css: Object.values(cache.inserted).join('\n') }
}

const cards = (html) => (html.match(/<li\b/g) || []).length
const DEFAULT_PROPS = { count: 6, minStars: '1', layout: 'grid', reviewerImage: 'initials', showSummary: true, showReplies: true }

test('the bundle registers one element, in its namespace, with its preset', async () => {
  const { Element, schema, surface } = await mount()
  assert.equal(typeof Element, 'function')
  assert.equal(schema.pluginId, 'aglyn.google-reviews')
  assert.equal(schema.displayName, 'Google reviews')
  assert.deepEqual(
    schema.attributes.map((attribute) => attribute.name),
    ['count', 'minStars', 'layout', 'reviewerImage', 'showSummary', 'showReplies'],
  )
  // What register() put in the registry is exactly what the manifest declares.
  assert.deepEqual(
    Object.keys(surface.components.schemas).filter((id) => id.startsWith('aglyn.google-reviews')),
    MANIFEST.contributes.site.components,
  )
  const preset = surface.components.getPreset(`aglyn.google-reviews:${COMPONENT_ID}`)
  assert.deepEqual(preset.data.props, DEFAULT_PROPS)
})

test('renders the whole of it: summary, review cards, attribution and the review link', async () => {
  const { html, css } = await render(DEFAULT_PROPS)
  assert.match(html, /<section[^>]*aria-label="Google reviews"/)
  assert.match(html, />4\.6</)
  assert.match(html, /aria-label="Rated 4\.6 out of 5 stars"/)
  assert.match(html, /44 reviews on Google/)
  assert.equal(cards(html), 6, 'six cards by default, newest first')
  assert.match(html, /Jordan Lee[\s\S]*Pat Lee[\s\S]*A Google User[\s\S]*Sam Rivera[\s\S]*Alex Kim[\s\S]*Casey Moore/)
  assert.doesNotMatch(html, /Robin Park/, 'a review with no star rating is left out')
  assert.match(html, /aria-label="Rated 5 out of 5 stars"/)
  assert.match(html, /<time[^>]*datetime="2026-03-14T00:00:00\.000Z"[^>]*>March 2026<\/time>/i)
  assert.match(html, /Response from the owner[\s\S]*Thank you, Jordan!/)
  assert.match(html, /Reviews from Google/)
  assert.match(
    html,
    /<a[^>]*href="https:\/\/search\.google\.com\/local\/writereview\?placeid=example"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Review us on Google<\/a>/,
  )
  // The site theme draws it: its warning color fills the stars and its
  // primary color the initials; nothing is a color of the bundle's own.
  assert.match(css, /#b45309/)
  assert.match(css, /#1d4ed8/)
  assert.match(html, /\bsite-[a-z0-9]+\b/)
})

test('a long comment is clamped behind a More button; a short one is not', async () => {
  const { html } = await render(DEFAULT_PROPS)
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 1)
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>More<\/button>/)
  // The whole text is in the HTML for visitors and search engines.
  assert.ok(html.includes(LONG))
})

test('minimum stars keeps only the reviews at or above it', async () => {
  const { html } = await render({ ...DEFAULT_PROPS, minStars: '5', count: 50 })
  assert.equal(cards(html), 4)
  assert.doesNotMatch(html, /Rated [1-4] out of 5 stars/)
  // The summary is still Google's own figures, not the filtered ones.
  assert.match(html, /44 reviews on Google/)
})

test('how many caps the cards', async () => {
  assert.equal(cards((await render({ ...DEFAULT_PROPS, count: 2 })).html), 2)
  assert.equal(cards((await render({ ...DEFAULT_PROPS, count: '3' })).html), 3, 'a number field stored as text')
  assert.equal(cards((await render({ ...DEFAULT_PROPS, count: 999 })).html), 8, 'never more than the record holds')
})

test('initials by default, never an image', async () => {
  const { html } = await render(DEFAULT_PROPS)
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /data-reviewer-image="initials"[^>]*>JL</)
  assert.match(html, /data-reviewer-image="initials"[^>]*>PL</)
})

test('Google photo draws a photo only where the page may load it', async () => {
  const { html } = await render({ ...DEFAULT_PROPS, reviewerImage: 'photo' })
  const images = html.match(/<img[^>]*>/g) || []
  assert.equal(images.length, 2, 'Jordan and Pat')
  assert.match(images[0], /src="https:\/\/lh3\.googleusercontent\.com\/a\/jordan=s120"/)
  assert.match(images[0], /alt=""/)
  assert.match(images[0], /referrerpolicy="no-referrer"/i)
  // The anonymous reviewer, and a photo on a host the manifest does not
  // admit, keep their initials.
  assert.doesNotMatch(html, /anon=s120|images\.example\.com/)
  assert.match(html, /data-reviewer-image="initials"[^>]*>AU</)
  assert.match(html, /data-reviewer-image="initials"[^>]*>SR</)
})

test('the carousel is a row the keyboard can scroll', async () => {
  const { html } = await render({ ...DEFAULT_PROPS, layout: 'carousel' })
  assert.match(html, /<ul[^>]*tabindex="0"[^>]*aria-label="Reviews, scroll sideways for more"/)
  assert.match(html, /data-layout="carousel"/)
  const list = await render({ ...DEFAULT_PROPS, layout: 'list' })
  assert.match(list.html, /data-layout="list"/)
  assert.doesNotMatch(list.html, /<ul[^>]*tabindex/)
})

test('the summary and the replies can be turned off', async () => {
  const { html } = await render({ ...DEFAULT_PROPS, showSummary: false, showReplies: false })
  assert.doesNotMatch(html, /44 reviews on Google|data-summary-rating|Response from the owner/)
  assert.match(html, /Review us on Google/, 'the link stays')
})

test('renders nothing on a published page without real reviews to show', async () => {
  assert.equal((await render(DEFAULT_PROPS, { record: null })).html, '', 'not connected or not synced')
  assert.equal((await render(DEFAULT_PROPS, { record: { ...RECORD, items: [] } })).html, '', 'no reviews yet')
  assert.equal(
    (await render({ ...DEFAULT_PROPS, minStars: '5' }, { record: { ...RECORD, items: RECORD.items.slice(3, 6) } })).html,
    '',
    'none at the minimum stars',
  )
  assert.equal(
    (await render(DEFAULT_PROPS, { listing: 'another-listing', record: null })).html,
    '',
    "another listing's record is never this element's",
  )
})

test('the Besigner canvas shows the author a line in its place', async () => {
  const { html } = await render({ ...DEFAULT_PROPS, 'data-aglyn': NODE_ID }, { record: null, editorInert: true })
  assert.match(html, /data-aglyn="node-reviews-1"/, 'selectable on the canvas')
  assert.match(html, /once this site is connected to your Google Business Profile/)
  const filtered = await render({ ...DEFAULT_PROPS, minStars: '5' }, {
    record: { ...RECORD, items: RECORD.items.slice(3, 6) },
    editorInert: true,
  })
  assert.match(filtered.html, /no review matches these settings yet/)
})

/* ------------------------------------------------------------------ */
/* The pure parts                                                       */
/* ------------------------------------------------------------------ */

test('settings take what the Besigner stores and fall back to the defaults', () => {
  assert.deepEqual(normalizeSettings({}), {
    count: 6,
    minStars: 1,
    layout: 'grid',
    reviewerImage: 'initials',
    showSummary: true,
    showReplies: true,
  })
  assert.deepEqual(
    normalizeSettings({ count: '0', minStars: '9', layout: 'masonry', reviewerImage: 'logo', showSummary: false, showReplies: 'false' }),
    { count: 1, minStars: 5, layout: 'grid', reviewerImage: 'initials', showSummary: false, showReplies: false },
  )
})

test('stars, initials, dates and photos', () => {
  assert.deepEqual(starFill(4.6), [100, 100, 100, 100, 60])
  assert.deepEqual(starFill(5), [100, 100, 100, 100, 100])
  assert.equal(starsLabel(4), 'Rated 4 out of 5 stars')
  assert.equal(starsLabel(4.25), 'Rated 4.3 out of 5 stars')
  assert.equal(initialsOf('Jordan Lee'), 'JL')
  assert.equal(initialsOf('Pat'), 'P')
  assert.equal(initialsOf('  '), '?')
  assert.equal(initialsOf('Émile van der Berg'), 'ÉB')
  assert.deepEqual(formatReviewDate(MARCH_2026), { iso: '2026-03-14T00:00:00.000Z', label: 'March 2026' })
  assert.equal(formatReviewDate(null), null)
  const photo = { reviewerImage: 'photo' }
  assert.equal(photoAllowed({ photo: 'https://lh3.googleusercontent.com/a/x', anonymous: false }, photo), true)
  assert.equal(photoAllowed({ photo: 'http://lh3.googleusercontent.com/a/x', anonymous: false }, photo), false)
  assert.equal(photoAllowed({ photo: 'https://lh3.googleusercontent.com/a/x', anonymous: false }, { reviewerImage: 'initials' }), false)
  assert.equal(selectReviews(null, normalizeSettings({})).length, 0)
})
