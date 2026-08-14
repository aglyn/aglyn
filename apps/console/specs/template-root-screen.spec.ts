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

import { SCREEN_ROOT_PATH } from '@aglyn/aglyn'

// `mock`-prefixed so jest's hoisted factory may close over it.
const mockPublishScreenRoute = jest.fn(async () => undefined)
jest.mock('../constants/screen-publishing', () => ({
  publishScreenRoute: (...args: unknown[]) =>
    (mockPublishScreenRoute as any)(...args),
}))

import createPageFromTemplate, {
  resolveTemplateSlug,
  withBundleRootScreen,
} from '../components/templates/create-page-from-template'
import {
  buildStarterTemplateDocs,
  STARTER_TEMPLATES,
} from '../constants/starter-templates'

/**
 * A site started from a template must have a HOME PAGE (AGL-1575).
 *
 * The template path carried a private slugifier that stripped every character
 * outside `[a-z0-9]`, so both `''` and `'/'` reduced to the empty string and
 * fell through to the display name. No screen it created could ever hold
 * `SCREEN_ROOT_PATH`, which is the only path the tenant serves at a site's own
 * URL — so every template-started site 404'd at its root while the console
 * showed a success toast. Nothing failed at the console layer, which is why it
 * survived; these assertions are the layer that would have.
 */
describe('resolveTemplateSlug', () => {
  it('gives a screen that asks for the root the root', () => {
    expect(
      resolveTemplateSlug({
        slug: SCREEN_ROOT_PATH,
        displayName: 'Home',
        usedSlugs: new Set(),
      }),
    ).toEqual({ slug: SCREEN_ROOT_PATH, requestedSlug: SCREEN_ROOT_PATH })
  })

  it('derives from the display name when no address is authored', () => {
    for (const slug of ['', '   ', undefined, '###']) {
      expect(
        resolveTemplateSlug({
          slug,
          displayName: 'About Us',
          usedSlugs: new Set(),
        }).slug,
      ).toBe('about-us')
    }
  })

  it('normalizes an authored address the way the Screens page does', () => {
    expect(
      resolveTemplateSlug({
        slug: '/Contact Us/',
        displayName: 'Contact',
        usedSlugs: new Set(),
      }).slug,
    ).toBe('contact-us')
  })

  // The invariant the file's docstring names: getting de-confliction wrong
  // "overwrites a live page". A collision must always FALL BACK.
  it('never hands out an address already in use', () => {
    const used = new Set(['about-us'])
    expect(
      resolveTemplateSlug({
        slug: 'about-us',
        displayName: 'About Us',
        usedSlugs: used,
      }).slug,
    ).toBe('about-us-2')
    expect(
      resolveTemplateSlug({
        slug: 'about-us',
        displayName: 'About Us',
        usedSlugs: used,
      }).slug,
    ).toBe('about-us-3')
    expect([...used].sort()).toEqual(['about-us', 'about-us-2', 'about-us-3'])
  })

  it('lets the root be claimed once, and only once', () => {
    const used = new Set<string>()
    expect(
      resolveTemplateSlug({
        slug: SCREEN_ROOT_PATH,
        displayName: 'Home',
        usedSlugs: used,
      }).slug,
    ).toBe(SCREEN_ROOT_PATH)
    // The second claimant falls back to its NAME — `/-2` is not an address —
    // and the live home page keeps the root.
    expect(
      resolveTemplateSlug({
        slug: SCREEN_ROOT_PATH,
        displayName: 'Home',
        usedSlugs: used,
      }),
    ).toEqual({ slug: 'home', requestedSlug: SCREEN_ROOT_PATH })
    expect(
      resolveTemplateSlug({
        slug: SCREEN_ROOT_PATH,
        displayName: 'Home',
        usedSlugs: used,
      }).slug,
    ).toBe('home-2')
    expect(used.has(SCREEN_ROOT_PATH)).toBe(true)
  })
})

describe('withBundleRootScreen', () => {
  it('gives the first screen the root when nothing claims it', () => {
    const screens = [{ slug: 'landing' }, { slug: 'about' }]
    expect(withBundleRootScreen(screens, [])).toEqual([
      { slug: SCREEN_ROOT_PATH },
      { slug: 'about' },
    ])
    // Input is not mutated — the gallery renders the same array it applies.
    expect(screens[0].slug).toBe('landing')
  })

  it('leaves the bundle alone when one of its screens asks for the root', () => {
    const screens = [{ slug: 'shop' }, { slug: SCREEN_ROOT_PATH }]
    expect(withBundleRootScreen(screens, [])).toEqual(screens)
  })

  it('never moves a home page the host already has', () => {
    const screens = [{ slug: 'landing' }]
    expect(withBundleRootScreen(screens, [SCREEN_ROOT_PATH, 'about'])).toEqual([
      { slug: 'landing' },
    ])
  })

  it('handles an empty bundle', () => {
    expect(withBundleRootScreen([], [])).toEqual([])
  })
})

/**
 * The five starters are the product's front door. Applying any of them to a
 * fresh site must produce exactly one page at the root — the bug's actual
 * user-visible symptom, asserted on the real definitions rather than on a
 * fixture that could drift away from them.
 */
describe('every starter gives a fresh site a home page', () => {
  it.each(STARTER_TEMPLATES.map((starter) => [starter.displayName, starter]))(
    '%s',
    (_name, starter: any) => {
      const used = new Set<string>()
      const paths = withBundleRootScreen(starter.screens, used).map(
        (screen: any) =>
          resolveTemplateSlug({
            slug: screen.slug,
            displayName: screen.displayName,
            usedSlugs: used,
          }).slug,
      )
      expect(paths[0]).toBe(SCREEN_ROOT_PATH)
      expect(paths.filter((path) => path === SCREEN_ROOT_PATH)).toHaveLength(1)
      expect(new Set(paths).size).toBe(paths.length)
    },
  )

  it('keeps the authored addresses when the site already has a home', () => {
    const business = STARTER_TEMPLATES.find(
      (starter) => starter.displayName === 'Business',
    ) as any
    const used = new Set<string>([SCREEN_ROOT_PATH])
    const paths = withBundleRootScreen(business.screens, used).map(
      (screen: any) =>
        resolveTemplateSlug({
          slug: screen.slug,
          displayName: screen.displayName,
          usedSlugs: used,
        }).slug,
    )
    expect(paths).not.toContain(SCREEN_ROOT_PATH)
    expect(paths).toEqual(['home', 'about-us', 'contact-us'])
  })
})

describe('seeded starter documents', () => {
  it('persists the root address of a starter that declares one', () => {
    const shop = STARTER_TEMPLATES.find((starter) =>
      starter.displayName.startsWith('Shop (physical'),
    ) as any
    const [home] = buildStarterTemplateDocs(shop)
    // Before AGL-1575 this field was dropped entirely — `''` is falsy — so a
    // materialized shop starter had no way left to say "home".
    expect(home.data['slug']).toBe(SCREEN_ROOT_PATH)
  })
})

describe('createPageFromTemplate', () => {
  beforeEach(() => mockPublishScreenRoute.mockClear())

  it('publishes the routing-map entry at the root', async () => {
    const createHostResource = jest.fn(async () => ({ id: 'screen' }))
    const createHostVersion = jest.fn(async () => ({ id: 'version' }))
    const result = await createPageFromTemplate(
      null as any,
      createHostResource as any,
      createHostVersion as any,
      {
        hostId: 'host',
        displayName: 'Home',
        nodes: {},
        slug: SCREEN_ROOT_PATH,
        usedSlugs: new Set(),
      },
    )
    expect(result.slug).toBe(SCREEN_ROOT_PATH)
    expect(mockPublishScreenRoute).toHaveBeenCalledWith(
      null,
      { hostId: 'host', screenId: result.screenId },
      SCREEN_ROOT_PATH,
    )
  })
})
