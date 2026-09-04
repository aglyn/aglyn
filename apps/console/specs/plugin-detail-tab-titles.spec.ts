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
 * ONE PLUGIN HAS TWO PAGES, AND THEY ARE NOT THE SAME PAGE.
 *
 * `/{orgSlug}/plugins/{pluginRef}` is the workspace's installation of a
 * plugin; `/{orgSlug}/hosts/{host}/admin/plugins/{pluginRef}` is what that
 * plugin does on ONE site. Both are about the same plugin, so a title built
 * from the plugin alone reads identically on both — and a reader with the two
 * open is picking between two tabs that say the same thing.
 *
 * The site page is the one carrying the extra fact, so the site is what
 * separates them. Asserted as a relation: the pair differ, and each still
 * names the plugin, so "different" cannot be met by a title that stopped
 * saying what it is about.
 */

import { generateMetadata as orgPluginMetadata } from '../app/(app)/[orgSlug]/plugins/[pluginRef]/layout'
import { generateMetadata as sitePluginMetadata } from '../app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/layout'

const PLUGIN_REF = 'bookings'
const HOST = 'aglyn-marketing'

async function orgTitle(): Promise<string> {
  const metadata = await orgPluginMetadata({
    params: Promise.resolve({ pluginRef: PLUGIN_REF }),
  })
  return String(metadata.title)
}

async function siteTitle(host: string = HOST): Promise<string> {
  const metadata = await sitePluginMetadata({
    params: Promise.resolve({ host, pluginRef: PLUGIN_REF }),
  })
  return String(metadata.title)
}

describe('the two pages about one plugin title themselves apart', () => {
  it('CONTROL: both name the plugin and say they are about a plugin', () => {
    // Without this, every assertion below is satisfied by two titles that
    // have stopped naming the thing they are about.
    return Promise.all([orgTitle(), siteTitle()]).then(([org, site]) => {
      for (const title of [org, site]) {
        expect(title).toContain(PLUGIN_REF)
        expect(title).toContain('Plugin')
      }
    })
  })

  it('separates the workspace installation from the site it runs on', async () => {
    expect(await orgTitle()).not.toBe(await siteTitle())
  })

  it('names the site on the page that is about one site', async () => {
    expect(await siteTitle()).toContain(HOST)
    // And the workspace page does not, because there is no site in that URL
    // to name — the difference is a fact one page has and the other does not.
    expect(await orgTitle()).not.toContain(HOST)
  })

  it('separates one plugin across two sites', async () => {
    expect(await siteTitle('site-a')).not.toBe(await siteTitle('site-b'))
  })
})
