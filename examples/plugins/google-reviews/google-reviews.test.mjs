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

test('the bundle registers its elements, in its namespace, with the composable presets', async () => {
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
  // The one-piece element stays registered for pages that place it, but the
  // Elements panel no longer offers it (AGL-4212).
  assert.equal(surface.components.getPreset(`aglyn.google-reviews:${COMPONENT_ID}`), undefined)
  assert.deepEqual(
    ['section', 'summary', 'cards', 'list', 'carousel', 'review-link', 'stars', 'reviewer-image'].map(
      (key) => surface.components.getPreset(`aglyn.google-reviews:${key}`)?.displayName,
    ),
    [
      'Google reviews',
      'Google rating',
      'Google review cards',
      'Google review list',
      'Google review carousel',
      'Review us on Google',
      'Google stars',
      'Google reviewer image',
    ],
  )
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

/* ------------------------------------------------------------------ */
/* Composable presets and their two elements (AGL-4212)                  */
/* ------------------------------------------------------------------ */

const PRESET_KEYS = ['section', 'summary', 'cards', 'list', 'carousel', 'review-link', 'stars', 'reviewer-image']
const REVIEWS_SOURCE = 'aglyn.google-reviews/google'
const SUMMARY_SOURCE = 'aglyn.google-reviews/google/fields'

/** The presets as register() put them in the registry. */
async function registeredPresets() {
  const { surface } = await mount()
  return PRESET_KEYS.map((key) => surface.components.getPreset(`aglyn.google-reviews:${key}`))
}

const walk = (node, visit) => {
  visit(node)
  for (const child of node.nodes || []) walk(child, visit)
}

test('every preset is built from site elements and this bundle\'s own, styled in node.sx', async () => {
  const presets = await registeredPresets()
  const ours = new Set(MANIFEST.contributes.site.components)
  for (const preset of presets) {
    assert.equal(preset.pluginId, 'aglyn.google-reviews', preset.$id)
    walk(preset.data, (node) => {
      if (node.pluginId === 'mui') assert.match(node.componentId, /^mui[A-Z]/, preset.$id)
      else {
        assert.equal(node.pluginId, 'aglyn.google-reviews', preset.$id)
        assert.ok(ours.has(node.componentId), `${preset.$id}: ${node.componentId} is declared`)
      }
      // Only node.sx is what the Styles panel edits.
      assert.equal(node.props?.sx, undefined, `${preset.$id}: ${node.componentId} styles in node.sx`)
    })
  }
})

test('the presets repeat over the google connection and name only fields it declares', async () => {
  const presets = await registeredPresets()
  const { record } = MANIFEST.connections[0].sync
  const itemFields = new Set(Object.keys(record.items.fields).flatMap((name) => [name, `${name}Iso`]))
  const summaryFields = new Set(Object.keys(record.fields))
  for (const preset of presets) {
    const check = (node, source) => {
      const repeat = node.props?.repeatConnection
      const scope = repeat ?? source
      for (const value of Object.values(node.props || {})) {
        for (const [, field] of String(value).matchAll(/\{\{item\.([A-Za-z]+)\}\}/g)) {
          if (preset.$id.endsWith(':stars') || preset.$id.endsWith(':reviewer-image')) continue
          assert.ok(scope, `${preset.$id}: {{item.${field}}} sits inside a repeat`)
          const known = scope === SUMMARY_SOURCE ? summaryFields : itemFields
          assert.ok(known.has(field), `${preset.$id}: ${field} is declared for ${scope}`)
        }
      }
      for (const child of node.nodes || []) check(child, scope)
    }
    check(preset.data, undefined)
  }
  const section = presets.find((preset) => preset.$id === 'aglyn.google-reviews:section').data
  // A band with room above and below, then a Container with side gutters,
  // as the built-in blocks place a section; a bare stack touched the screen
  // edge on a phone.
  assert.equal(section.props.component, 'section')
  assert.ok(section.sx.paddingTop && section.sx.paddingBottom, 'room above and below')
  const [container] = section.nodes
  assert.equal(container.componentId, 'muiContainer')
  assert.equal(container.props.maxWidth, 'lg')
  const [content] = container.nodes
  assert.deepEqual(
    content.nodes.map((node) => node.props.repeatConnection),
    [SUMMARY_SOURCE, REVIEWS_SOURCE, SUMMARY_SOURCE],
  )
  // The owner's reply block leaves a review without one.
  const hides = []
  walk(content, (node) => {
    if (node.props?.hideUnless) hides.push(node.props.hideUnless)
  })
  assert.deepEqual(hides.sort(), ['{{item.rating}}', '{{item.reply}}', '{{item.reviewCount}}'])
})

async function renderPart(id, props) {
  const { React, styles, surface } = await mount()
  const { renderToString } = await import('react-dom/server')
  const { default: createCache } = await import('@emotion/cache')
  const { CacheProvider } = await import('@emotion/react')
  const cache = createCache({ key: 'site' })
  cache.compat = true
  const theme = styles.createTheme({ palette: { primary: { main: '#1d4ed8' }, warning: { main: '#b45309' } } })
  const h = React.createElement
  const html = renderToString(
    h(CacheProvider, { value: cache }, h(styles.ThemeProvider, { theme }, h(surface.components.getFactory(id), props))),
  )
  return { html, css: Object.values(cache.inserted).join('\n') }
}

test('Stars draws a rating and takes the author\'s color and size over its own', async () => {
  const plain = await renderPart('aglyn.google-reviews.stars', { value: '4.5' })
  assert.match(plain.html, /aria-label="Rated 4\.5 out of 5 stars"/)
  assert.match(plain.css, /#b45309/)
  const styled = await renderPart('aglyn.google-reviews.stars', {
    value: 4,
    'data-aglyn': 'n1',
    sx: { color: '#123456', fontSize: '3rem' },
  })
  assert.match(styled.html, /data-aglyn="n1"/)
  assert.match(styled.css, /color:#123456/)
  assert.match(styled.css, /font-size:3rem/)
  // Same rule, the author's declarations after the element's own: they win.
  const rule = styled.css.split('\n').find((line) => line.includes('#123456'))
  assert.ok(rule.indexOf('color:#123456') > rule.indexOf('color:#b45309'), 'the author\'s color comes last')
  assert.ok(rule.indexOf('font-size:3rem') > rule.indexOf('font-size:1.25rem'), 'the author\'s size comes last')
  // An unfilled token on the canvas draws five empty stars, not an error.
  const unfilled = await renderPart('aglyn.google-reviews.stars', { value: '{{item.stars}}' })
  assert.match(unfilled.html, /aria-label="Rated 0 out of 5 stars"/)
})

test('Reviewer image shows initials, or a photo only when chosen and allowed', async () => {
  const initials = await renderPart('aglyn.google-reviews.reviewer-image', {
    name: 'Jordan Lee',
    photo: 'https://lh3.googleusercontent.com/a/photo',
    show: 'initials',
  })
  assert.match(initials.html, />JL</)
  assert.doesNotMatch(initials.html, /<img/)
  const photo = await renderPart('aglyn.google-reviews.reviewer-image', {
    name: 'Jordan Lee',
    photo: 'https://lh3.googleusercontent.com/a/photo',
    show: 'photo',
    sx: { borderRadius: 2 },
  })
  assert.match(photo.html, /<img[^>]*src="https:\/\/lh3\.googleusercontent\.com\/a\/photo"/)
  const anonymous = await renderPart('aglyn.google-reviews.reviewer-image', {
    name: 'A Google User',
    photo: 'https://lh3.googleusercontent.com/a/photo',
    anonymous: 'true',
    show: 'photo',
  })
  assert.doesNotMatch(anonymous.html, /<img/, 'an anonymous reviewer always shows initials')
  const elsewhere = await renderPart('aglyn.google-reviews.reviewer-image', {
    name: 'Jordan Lee',
    photo: 'https://example.com/photo.png',
    show: 'photo',
  })
  assert.doesNotMatch(elsewhere.html, /<img/, 'a host the page may not load is never drawn')
})

/* ------------------------------------------------------------------ */
/* The presets as a published page composes them (AGL-4212)             */
/* ------------------------------------------------------------------ */

/** A preset's nested tree as the flat node map a page stores. */
function flatten(data) {
  const nodes = {}
  let next = 0
  const add = (node, parentId) => {
    const $id = `n${next++}`
    const { nodes: children, ...rest } = node
    nodes[$id] = { ...rest, $id, type: 'node', parentId, nodes: [] }
    nodes[$id].nodes = (children || []).map((child) => add(child, $id))
    return $id
  }
  nodes.root = { $id: 'root', type: 'node', nodes: [add(data, 'root')] }
  return nodes
}

/** The page's repeats expanded over RECORD, as the server composes them. */
async function composePreset(presetKey, record = RECORD) {
  const { surface } = await mount()
  const { expandRepeatables, repeatKey } = await workspace('libs/aglyn/src/lib/app-utils/expand-repeatables.ts')
  const { parsePluginConnectionRepeat, pluginConnectionFieldTypes, pluginConnectionRepeatRows } = await workspace(
    'libs/aglyn/src/lib/app-utils/plugin-connection-repeat.ts',
  )
  const nodes = flatten(surface.components.getPreset(`aglyn.google-reviews:${presetKey}`).data)
  const types = pluginConnectionFieldTypes(MANIFEST.connections[0])
  const rows = {}
  for (const node of Object.values(nodes)) {
    const key = repeatKey(node)
    if (!key) continue
    const target = parsePluginConnectionRepeat(key)
    rows[key] = pluginConnectionRepeatRows(record, types, target.part)
  }
  const out = expandRepeatables(nodes, rows)
  // Reading order, from the root down.
  const order = []
  const visit = (id) => {
    const node = out[id]
    if (!node) return
    if (id !== 'root') order.push(node)
    for (const child of node.nodes || []) visit(child)
  }
  visit('root')
  return order
}

const textsOf = (order) => order.map((node) => node.props?.children).filter((value) => typeof value === 'string')

test('the whole section composes into the summary, six newest rated cards and the link', async () => {
  const order = await composePreset('section')
  const texts = textsOf(order)
  assert.equal(texts[0], '4.6')
  assert.equal(texts[1], '44 reviews on Google')
  const names = order
    .filter((node) => node.componentId === 'muiTypography' && node.props.variant === 'subtitle2')
    .map((node) => node.props.children)
  // Newest first, a review Google gave no star rating left out, six at most.
  assert.deepEqual(names, ['Jordan Lee', 'Pat Lee', 'A Google User', 'Sam Rivera', 'Alex Kim', 'Casey Moore'])
  assert.ok(texts.includes('Mar 14, 2026'), 'the date prints as a date')
  const stars = order.filter((node) => node.componentId === 'aglyn.google-reviews.stars').map((node) => node.props.value)
  assert.deepEqual(stars.map(String), ['4.6', '5', '4', '5', '3', '2', '5'])
  // Replies: only Jordan's and Alex's cards keep the block.
  assert.equal(texts.filter((text) => text === 'Response from the owner').length, 2)
  assert.ok(texts.includes('Thank you, Jordan!') && texts.includes('We are sorry, Alex.'))
  // A review with no comment has no empty text.
  assert.ok(!texts.some((text) => text.includes('{{')), 'every token is filled')
  const link = order.find((node) => node.componentId === 'muiScreenLink')
  assert.equal(link.props.href, RECORD.fields.reviewUrl)
  // No directive reaches a published element.
  for (const node of order) {
    for (const prop of ['repeatConnection', 'repeatLimit', 'repeatFilter', 'repeatSelf', 'hideUnless']) {
      assert.equal(node.props?.[prop], undefined, `${node.componentId} carries no ${prop}`)
    }
  }
})

test('a filter on the cards keeps only the reviews it names', async () => {
  const { surface } = await mount()
  const preset = surface.components.getPreset('aglyn.google-reviews:cards')
  const before = preset.data.props.repeatFilter
  preset.data.props.repeatFilter = 'stars >= 5'
  try {
    const names = (await composePreset('cards'))
      .filter((node) => node.props?.variant === 'subtitle2')
      .map((node) => node.props.children)
    assert.deepEqual(names, ['Jordan Lee', 'A Google User', 'Casey Moore', 'Morgan Diaz'])
  } finally {
    preset.data.props.repeatFilter = before
  }
})

test('before the first sync the section draws nothing to visitors', async () => {
  const order = await composePreset('section', null)
  assert.deepEqual(textsOf(order), [], 'no summary, no cards, no link')
})

test('a profile with no reviews yet shows only the review link (AGL-4212)', async () => {
  // What Google answers for a profile nobody has reviewed: no rating, no
  // count, no reviews, only the "leave a review" link.
  const empty = { fields: { reviewUrl: RECORD.fields.reviewUrl }, items: [], syncedAtMs: MARCH_2026 }
  const order = await composePreset('section', empty)
  assert.deepEqual(textsOf(order), ['Review us on Google'])
  assert.equal(order.filter((node) => node.componentId === 'aglyn.google-reviews.stars').length, 0, 'no empty stars')
  const summary = await composePreset('summary', empty)
  assert.deepEqual(textsOf(summary), [], 'the rating on its own draws nothing')
})
