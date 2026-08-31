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
 * TWO DIFFERENT PAGES MUST NOT PUT THE SAME STRING IN THE TAB STRIP.
 *
 * A plugin surface with a section rail is several pages behind one nav item,
 * and every one of them titled itself from the first URL segment — so a
 * reader with `/marketing/campaigns` and `/marketing/experiments` open had two
 * tabs reading `Marketing · aglyn-marketing` and no way to tell them apart
 * except by clicking.
 *
 * Asserted as a RELATION between routes rather than as a string. A test that
 * pinned one title would go on passing the day every other route collapsed
 * onto it, which is the failure that shipped; what has to hold is that
 * different destinations produce different titles. The pairs that legitimately
 * share most of their text are asserted too, so "different" cannot be
 * satisfied by making every title disjoint noise.
 */

import { generateMetadata } from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/layout'

const HOST = 'aglyn-marketing'

/** The title `generateMetadata` produces for one URL beneath a site. */
async function titleFor(
  pluginSlug: string[],
  host: string = HOST,
): Promise<string> {
  const metadata = await generateMetadata({
    params: Promise.resolve({ host, pluginSlug }),
  })
  return String(metadata.title)
}

describe('a plugin surface titles its sections apart', () => {
  it('CONTROL: a surface with no section open titles as the surface', async () => {
    // The reading every non-hub plugin page has: the surface, then the site.
    expect(await titleFor(['marketing'])).toBe('Marketing · aglyn-marketing')
    expect(await titleFor(['products'])).toBe('Products · aglyn-marketing')
  })

  it('gives two sections of one surface two different titles', async () => {
    const campaigns = await titleFor(['marketing', 'campaigns'])
    const experiments = await titleFor(['marketing', 'experiments'])
    expect(campaigns).not.toBe(experiments)
    // And both still say which surface and which site, so the difference is
    // an addition rather than a substitution.
    expect(campaigns).toBe('Campaigns · Marketing · aglyn-marketing')
    expect(experiments).toBe('A/B testing · Marketing · aglyn-marketing')
  })

  it('CONTROL: sections of one surface share everything but their own name', async () => {
    // The pair that is SUPPOSED to look alike. Without this, "make them
    // different" is satisfied by titles that no longer say what surface or
    // what site they belong to.
    const campaigns = await titleFor(['marketing', 'campaigns'])
    const overlays = await titleFor(['marketing', 'overlays'])
    const shared = ` · Marketing · ${HOST}`
    expect(campaigns.endsWith(shared)).toBe(true)
    expect(overlays.endsWith(shared)).toBe(true)
  })

  it('separates every declared section of every hub', async () => {
    // The whole set at once: a collision anywhere in it is the bug, and one
    // pair asserted by hand would not have caught the one that shipped.
    const routes = [
      ['marketing'],
      ['marketing', 'overview'],
      ['marketing', 'campaigns'],
      ['marketing', 'overlays'],
      ['marketing', 'experiments'],
      ['products'],
      ['products', 'catalog'],
      ['products', 'orders'],
      ['emails'],
      ['emails', 'templates'],
      ['automation'],
      ['automation', 'webhooks'],
    ]
    const titles = await Promise.all(routes.map((route) => titleFor(route)))
    expect(new Set(titles).size).toBe(routes.length)
  })

  it('separates one surface across two sites', async () => {
    // Two tabs on the same page of two different sites is the other half of
    // the same job.
    expect(await titleFor(['marketing'], 'site-a')).not.toBe(
      await titleFor(['marketing'], 'site-b'),
    )
  })

  it('leaves a document id out of the tab', async () => {
    // A surface that owns its subtree puts an id in the segment a hub puts a
    // section in. An id has no display name, and Title Casing one produces a
    // string that is no longer the id — so the title stays the surface's.
    expect(await titleFor(['forms', 'aL_o499p_p'])).toBe(
      'Forms · aglyn-marketing',
    )
  })
})
