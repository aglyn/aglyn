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

import { aiHostPublishContext, aiSiteStatusTable } from './ai-host-publish-context'

describe('aiHostPublishContext', () => {
  it('reads a starter site as published at its platform address, home first', () => {
    expect(
      aiHostPublishContext({ subdomain: 'vocation-to-pen', screens: { b: '/about', a: '/' } }, [
        { publishedAt: '2026-10-07T16:04:03.825Z' },
        { publishedAt: '2026-10-08T10:00:00.000Z', deletedAt: null },
      ]),
    ).toEqual({
      published: true,
      liveUrl: 'https://vocation-to-pen.aglyn.app',
      publishedPages: ['/', '/about'],
      firstPublishedAt: Date.parse('2026-10-07T16:04:03.825Z'),
    })
  })

  it('reads the routing map’s paths as URLs: a page published at `menu` is /menu (AGL-3834)', () => {
    // Copper Kettle Catering's map, 2026-10-15: the home is `/`, every other
    // page a bare slug. Only `/` was named, as if it were the only page.
    const host = {
      subdomain: 'copper-kettle-catering',
      screens: {
        FBwJbXvslg: 'catering-packages',
        iCiTY1bkPC: 'menu',
        _NI9jNkoBd: 'our-story',
        mtMXNnNLvS: 'contact',
        ugb5MGNC_2: '/',
        nested: 'services/pricing/',
        blank: '',
        odd: 7,
      },
    }
    const context = aiHostPublishContext(host)
    expect(context.publishedPages).toEqual([
      '/',
      '/catering-packages',
      '/contact',
      '/menu',
      '/our-story',
      '/services/pricing',
    ])
    expect(aiSiteStatusTable(context, 't3').rows[2]).toEqual({
      figure: 'Published pages',
      value: '/, /catering-packages, /contact, /menu, /our-story, /services/pricing',
    })
  })

  it('reads a site published only below its home as published', () => {
    expect(aiHostPublishContext({ subdomain: 'shop', screens: { a: 'about' } })).toMatchObject({
      published: true,
      publishedPages: ['/about'],
    })
  })

  it('reads a site with no route as unpublished, and names no first publish it was not given', () => {
    expect(aiHostPublishContext({ subdomain: 'shop' })).toEqual({
      published: false,
      liveUrl: 'https://shop.aglyn.app',
      publishedPages: [],
      firstPublishedAt: null,
    })
    expect(aiHostPublishContext(null)).toMatchObject({ published: false, liveUrl: null })
  })

  it('gives a custom domain only once it serves', () => {
    const host = { subdomain: 'shop', cname: 'www.example.com', screens: { h: '/' } }
    expect(aiHostPublishContext(host).liveUrl).toBe('https://www.example.com')
    expect(aiHostPublishContext({ ...host, cnameAttachmentPending: true }).liveUrl).toBe('https://shop.aglyn.app')
  })
})

describe('aiSiteStatusTable', () => {
  it('states publish, address and pages as citable rows, with paths past the bound counted', () => {
    const paths = Array.from({ length: 14 }, (_, index) => (index ? `/p${String.fromCharCode(96 + index)}` : '/'))
    const table = aiSiteStatusTable(
      { published: true, liveUrl: 'https://shop.aglyn.app', publishedPages: paths, firstPublishedAt: null },
      't3',
    )
    expect(table).toMatchObject({ ref: 't3', reader: 'site.status', days: 0, scope: 'site', period: null, omitted: 0 })
    expect(table.rows[0]).toEqual({ figure: 'Published', value: 'Yes: visitors can open the site now' })
    expect(table.rows[1]).toEqual({ figure: 'Address', value: 'https://shop.aglyn.app' })
    expect(table.rows[2]?.['value']).toMatch(/^\/, \/pa, .*, and 2 more$/)
  })

  it('says an unpublished site is not published, with no address it does not have', () => {
    const table = aiSiteStatusTable({ published: false, liveUrl: null, publishedPages: [], firstPublishedAt: null }, 't1')
    expect(table.rows.map((row) => row['value'])).toEqual(['No: no page is published yet', 'None yet', 'None'])
  })
})
