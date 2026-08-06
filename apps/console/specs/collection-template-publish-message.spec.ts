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

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  collectCollectionTemplateRoutes,
  collectionTemplatePublishMessage,
  collectionTemplateRoutesSummary,
  collectionTemplateScreenIds,
} from '../constants/collection-templates'

describe('collection template screen ids (AGL-1269)', () => {
  it('collects all three template fields, like countBillableScreens', () => {
    expect(
      collectionTemplateScreenIds([
        { slug: 'blog', listScreenId: 'blogList', entryScreenId: 'blogEntry' },
        { slug: 'news', templateScreenId: 'legacyTmpl' },
      ]),
    ).toEqual(new Set(['blogList', 'blogEntry', 'legacyTmpl']))
  })

  it('ignores blank and non-string pointers', () => {
    expect(
      collectionTemplateScreenIds([
        { slug: 'blog', listScreenId: '', entryScreenId: 42 as unknown },
        null,
        undefined,
      ]),
    ).toEqual(new Set())
  })

  // A collection with no slug still designates the screen as a template: it
  // is still not billable and still not a page, there is simply no route to
  // name for it yet.
  it('counts a template on a slugless collection', () => {
    expect(
      collectionTemplateScreenIds([{ entryScreenId: 'tmpl' }]),
    ).toEqual(new Set(['tmpl']))
  })
})

describe('collection template routes (AGL-1269)', () => {
  const blog = {
    slug: 'blog',
    displayName: 'Blog',
    listScreenId: 'blogList',
    entryScreenId: 'blogEntry',
  }

  it('renders an entry template at /{collection}/{entry}', () => {
    const routes = collectCollectionTemplateRoutes([blog])
    expect(collectionTemplateRoutesSummary(routes.get('blogEntry'))).toBe(
      '/blog/{entry}',
    )
  })

  it('renders a list template at the collection root', () => {
    const routes = collectCollectionTemplateRoutes([blog])
    expect(collectionTemplateRoutesSummary(routes.get('blogList'))).toBe(
      '/blog',
    )
  })

  // The whole point of the distinction: list and entry resolve to different
  // things, so one message must not be produced for the other.
  it('never confuses the list route with the entry route', () => {
    const routes = collectCollectionTemplateRoutes([blog])
    expect(collectionTemplateRoutesSummary(routes.get('blogList'))).not.toBe(
      collectionTemplateRoutesSummary(routes.get('blogEntry')),
    )
  })

  it('uses the collection’s real slug, never a hardcoded one', () => {
    const routes = collectCollectionTemplateRoutes([
      { slug: 'field-notes', entryScreenId: 'tmpl' },
    ])
    expect(collectionTemplateRoutesSummary(routes.get('tmpl'))).toBe(
      '/field-notes/{entry}',
    )
  })

  // resolveCollectionTemplateScreenId falls back to the legacy AGL-105 field
  // for ENTRY routes only, so the legacy pointer must read as an entry
  // template — never as a list one.
  it('treats the legacy templateScreenId as an entry template', () => {
    const routes = collectCollectionTemplateRoutes([
      { slug: 'blog', templateScreenId: 'legacyTmpl' },
    ])
    expect(collectionTemplateRoutesSummary(routes.get('legacyTmpl'))).toBe(
      '/blog/{entry}',
    )
  })

  // entryScreenId wins, so the superseded legacy pointer renders NOTHING.
  // Claiming it renders /blog/{entry} would be the same class of lie as the
  // slug this replaces.
  it('gives a superseded legacy pointer no route', () => {
    const routes = collectCollectionTemplateRoutes([
      { slug: 'blog', entryScreenId: 'blogEntry', templateScreenId: 'old' },
    ])
    expect(routes.get('old')).toBeUndefined()
    expect(collectionTemplateRoutesSummary(routes.get('blogEntry'))).toBe(
      '/blog/{entry}',
    )
  })

  it('joins both routes when one screen is list AND entry template', () => {
    const routes = collectCollectionTemplateRoutes([
      { slug: 'blog', listScreenId: 'both', entryScreenId: 'both' },
    ])
    expect(collectionTemplateRoutesSummary(routes.get('both'))).toBe(
      '/blog and /blog/{entry}',
    )
  })

  it('joins routes across collections that share a template', () => {
    const routes = collectCollectionTemplateRoutes([
      { slug: 'blog', entryScreenId: 'shared' },
      { slug: 'news', entryScreenId: 'shared' },
    ])
    expect(collectionTemplateRoutesSummary(routes.get('shared'))).toBe(
      '/blog/{entry} and /news/{entry}',
    )
  })

  it('names no route for a collection with no slug', () => {
    const routes = collectCollectionTemplateRoutes([{ entryScreenId: 'tmpl' }])
    expect(collectionTemplateRoutesSummary(routes.get('tmpl'))).toBeUndefined()
  })
})

describe('collectionTemplatePublishMessage (AGL-1269)', () => {
  const routes = collectCollectionTemplateRoutes([
    { slug: 'blog', listScreenId: 'blogList', entryScreenId: 'blogEntry' },
  ])

  it('says what publishing an entry template achieved', () => {
    expect(
      collectionTemplatePublishMessage(routes.get('blogEntry'), {
        isTemplateScreen: true,
      }),
    ).toBe('Published — this template now renders /blog/{entry}')
  })

  it('says what publishing a list template achieved', () => {
    expect(
      collectionTemplatePublishMessage(routes.get('blogList'), {
        isTemplateScreen: true,
      }),
    ).toBe('Published — this template now renders /blog')
  })

  // The message must never name the slug the screen was published under —
  // the tenant refuses to serve it (AGL-1267), so it is a 404.
  it('never names a path of the screen’s own', () => {
    for (const screenId of ['blogList', 'blogEntry']) {
      const message = collectionTemplatePublishMessage(routes.get(screenId), {
        isTemplateScreen: true,
      })
      expect(message).not.toContain('Published at')
      expect(message).not.toContain('blog-entry-template')
    }
  })

  // A template with no nameable route is still not a page.
  it('still refuses to describe a routeless template as a page', () => {
    expect(
      collectionTemplatePublishMessage(undefined, { isTemplateScreen: true }),
    ).toBe(
      'Published — this screen is a collection template, so it is not ' +
        'served at a path of its own',
    )
  })

  // An ordinary screen keeps its ordinary message: the caller falls back to
  // `Published at …` on undefined.
  it('returns undefined for a screen that is not a template', () => {
    expect(collectionTemplatePublishMessage(undefined)).toBeUndefined()
    expect(
      collectionTemplatePublishMessage(undefined, { isTemplateScreen: false }),
    ).toBeUndefined()
  })
})

/**
 * A perfect message helper with no callers is worth nothing. These assert the
 * three publish surfaces named in AGL-1269 actually route their snackbar
 * through it, rather than that the helper merely exists.
 */
describe('the publish surfaces are wired to the helper (AGL-1269)', () => {
  const editorRoot = join(
    __dirname,
    '..',
    'app',
    '(editor)',
    '[orgSlug]',
    'hosts',
    '[host]',
    'screens',
    '[screenId]',
    'versions',
    '[versionId]',
  )
  const pages = {
    view: join(editorRoot, 'view', 'page.tsx'),
    besigner: join(editorRoot, 'besigner', 'page.tsx'),
  }

  it.each(Object.entries(pages))(
    'the %s page imports the message helper',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).toContain(
        'collectionTemplatePublishMessage',
      )
    },
  )

  it('every `Published at` snackbar falls back from the helper', () => {
    for (const file of Object.values(pages)) {
      const source = readFileSync(file, 'utf8')
      const sites = source.split('`Published at ')
      // First chunk is the text before the first occurrence.
      expect(sites.length).toBeGreaterThan(1)
      for (const before of sites.slice(0, -1)) {
        // The helper call must be the immediately preceding expression, i.e.
        // the `Published at` template literal is only ever the `??` fallback.
        const tail = before.slice(-400)
        expect(tail).toContain('collectionTemplatePublishMessage')
        expect(tail.trimEnd().endsWith('??')).toBe(true)
      }
    }
  })
})
