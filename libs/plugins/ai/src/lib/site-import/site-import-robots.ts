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

/*==========================================
 * ROBOTS.TXT AND SITEMAPS, FOR AGLYNBOT (AGL-3974).
 *
 * The site-import crawler asks a site's robots.txt before every page, as
 * RFC 9309 describes it: the group naming `AglynBot` if there is one, else
 * the `*` group; the longest matching rule decides, and `Allow` wins a tie;
 * `*` matches any run and a trailing `$` anchors the end. A site that keeps
 * a path from crawlers keeps it from this one, even though the person asking
 * owns the site: the file is the site's own statement of what a robot may
 * read, and the person can change it.
 *
 * Sitemaps are read for their `<loc>` addresses, and a sitemap index for the
 * sitemaps it lists. Gzipped sitemaps are not read.
 *=========================================*/

/** The product token AglynBot matches robots.txt groups by. */
export const AGLYN_BOT_TOKEN = 'aglynbot'

export interface RobotsRule {
  allow: boolean
  /** The path pattern as written, `*` and `$` included. */
  pattern: string
}

export interface RobotsGroup {
  /** Lowercased product tokens, version suffixes removed. */
  agents: string[]
  rules: RobotsRule[]
}

export interface RobotsTxt {
  groups: RobotsGroup[]
  /** Every `Sitemap:` address, as written. */
  sitemaps: string[]
}

/** robots.txt as groups and sitemaps; unknown lines are skipped. */
export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let group: RobotsGroup | null = null
  let lastWasAgent = false
  for (const rawLine of String(text ?? '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      const agent = value.toLowerCase().split('/')[0].trim()
      if (!group || !lastWasAgent) {
        group = { agents: [], rules: [] }
        groups.push(group)
      }
      if (agent) group.agents.push(agent)
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!group) continue
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything, which is what no rule does.
      if (!value) continue
      group.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return { groups, sitemaps }
}

/**
 * The rules that apply to `token`: every group naming it, merged; when none
 * does, every `*` group, merged; when neither exists, none (all allowed).
 */
export function robotsRulesFor(robots: RobotsTxt, token: string = AGLYN_BOT_TOKEN): RobotsRule[] {
  const own = robots.groups.filter((group) => group.agents.includes(token))
  const chosen = own.length ? own : robots.groups.filter((group) => group.agents.includes('*'))
  return chosen.flatMap((group) => group.rules)
}

function patternMatchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  const regex = new RegExp(`^${source}${anchored ? '$' : ''}`)
  return regex.test(path) ? body.length : -1
}

/** A path with a percent-encoding case that compares the way robots.txt writes it. */
function comparablePath(path: string): string {
  return path.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
}

/**
 * Whether `pathWithQuery` (`/a/b?c=d`) may be crawled under `rules`.
 * `/robots.txt` itself is always allowed.
 */
export function robotsAllows(rules: readonly RobotsRule[], pathWithQuery: string): boolean {
  const path = comparablePath(pathWithQuery || '/')
  if (path === '/robots.txt') return true
  let best = -1
  let allowed = true
  for (const rule of rules) {
    const length = patternMatchLength(comparablePath(rule.pattern), path)
    if (length < 0) continue
    if (length > best || (length === best && rule.allow)) {
      best = length
      allowed = rule.allow
    }
  }
  return allowed
}

export interface SitemapEntries {
  /** True for a `<sitemapindex>`: `locations` are sitemaps, not pages. */
  index: boolean
  locations: string[]
}

/** The `<loc>` addresses of a sitemap or a sitemap index, entities decoded. */
export function parseSitemap(xml: string, limit = 5_000): SitemapEntries {
  const source = String(xml ?? '')
  const index = /<sitemapindex\b/i.test(source)
  const locations: string[] = []
  for (const match of source.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) {
    const value = match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim()
    if (value) locations.push(value)
    if (locations.length >= limit) break
  }
  return { index, locations }
}
