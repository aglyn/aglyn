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
 * robots.txt and sitemaps as AglynBot reads them (AGL-3974), against the
 * matching rules RFC 9309 sets out.
 */

import {
  parseRobotsTxt,
  parseSitemap,
  robotsAllows,
  robotsRulesFor,
} from './site-import-robots'

describe('which group applies', () => {
  const robots = parseRobotsTxt(
    [
      'User-agent: *',
      'Disallow: /private',
      '',
      'User-agent: Googlebot',
      'User-agent: AglynBot/1.0',
      'Disallow: /drafts',
      '# a comment line',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\r\n'),
  )

  it('is the group naming AglynBot, version suffix and case aside, and only that group', () => {
    const rules = robotsRulesFor(robots)
    expect(robotsAllows(rules, '/drafts/one')).toBe(false)
    expect(robotsAllows(rules, '/private')).toBe(true)
  })

  it('is the * group when nothing names AglynBot', () => {
    const rules = robotsRulesFor(parseRobotsTxt('User-agent: *\nDisallow: /private\n'))
    expect(robotsAllows(rules, '/private/x')).toBe(false)
    expect(robotsAllows(rules, '/public')).toBe(true)
  })

  it('is nothing at all when neither exists, which allows everything', () => {
    const rules = robotsRulesFor(parseRobotsTxt('User-agent: OtherBot\nDisallow: /\n'))
    expect(rules).toEqual([])
    expect(robotsAllows(rules, '/anything')).toBe(true)
  })

  it('collects every Sitemap line, wherever it sits', () => {
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml'])
  })
})

describe('which rule decides', () => {
  const rules = robotsRulesFor(
    parseRobotsTxt(
      [
        'User-agent: *',
        'Disallow: /shop',
        'Allow: /shop/about',
        'Disallow: /*.php$',
        'Disallow: /*?session=',
        'Allow: /tie',
        'Disallow: /tie',
        'Disallow:',
      ].join('\n'),
    ),
  )

  it('is the longest match', () => {
    expect(robotsAllows(rules, '/shop/cart')).toBe(false)
    expect(robotsAllows(rules, '/shop/about/team')).toBe(true)
  })

  it('reads * as any run and a trailing $ as the end', () => {
    expect(robotsAllows(rules, '/blog/index.php')).toBe(false)
    expect(robotsAllows(rules, '/blog/index.php5')).toBe(true)
    expect(robotsAllows(rules, '/page?session=abc')).toBe(false)
  })

  it('gives a tie to Allow, and reads an empty Disallow as no rule', () => {
    expect(robotsAllows(rules, '/tie')).toBe(true)
    expect(robotsAllows(rules, '/elsewhere')).toBe(true)
  })

  it('never keeps a robot off robots.txt itself', () => {
    expect(robotsAllows(robotsRulesFor(parseRobotsTxt('User-agent: *\nDisallow: /')), '/robots.txt')).toBe(true)
  })
})

describe('parseSitemap', () => {
  it('reads a urlset’s locations, entities decoded', () => {
    expect(
      parseSitemap(
        '<urlset><url><loc> https://a.test/one </loc></url><url><loc>https://a.test/?a=1&amp;b=2</loc></url></urlset>',
      ),
    ).toEqual({ index: false, locations: ['https://a.test/one', 'https://a.test/?a=1&b=2'] })
  })

  it('knows a sitemap index from a urlset, and stops at its limit', () => {
    const index = parseSitemap(
      '<sitemapindex><sitemap><loc><![CDATA[https://a.test/s1.xml]]></loc></sitemap><sitemap><loc>https://a.test/s2.xml</loc></sitemap></sitemapindex>',
      1,
    )
    expect(index).toEqual({ index: true, locations: ['https://a.test/s1.xml'] })
  })
})
