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
 * Turns a console URL or path into where the app should go (AGL-3620).
 *
 * Every link the app meets is a console link: a universal link to the
 * console's own domain, an `aglyn://` link, or a notification's `link`. A
 * plugin that answers a path natively registers a deep link for it; anything
 * else opens in the authenticated console WebView, so no link is a dead end.
 */

import type { MobileDeepLink, MobileParams } from './types'

export type MobileLinkTarget =
  | { kind: 'screen'; screen: string; params: MobileParams }
  | { kind: 'console'; path: string }

/**
 * The console nests most pages under the workspace and site they belong to:
 * `/{orgSlug}/hosts/{hostSlug}/redirects` for a site's page and
 * `/{orgSlug}/crm` for a workspace's (`console-routes.ts`). Matching runs on
 * the path after that prefix; the slugs ride along as `orgSlug` and
 * `hostSlug` params. The console's own top-level sections are not
 * workspaces, and are matched whole.
 */
export const CONSOLE_TOP_LEVEL = new Set([
  'admin',
  'api',
  'auth',
  'billing',
  'manage',
  'signin',
  'signup',
  'support',
])

export function splitConsoleScope(path: string): {
  orgSlug?: string
  hostSlug?: string
  rest: string
} {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length || CONSOLE_TOP_LEVEL.has(segments[0])) return { rest: path || '/' }
  const [orgSlug, maybeHosts, hostSlug, ...after] = segments
  if (maybeHosts === 'hosts' && hostSlug) {
    return { orgSlug, hostSlug, rest: `/${after.join('/')}` }
  }
  return { orgSlug, rest: `/${segments.slice(1).join('/')}` }
}

/** The path part of a console URL, an `aglyn://` URL, or a bare path. */
export function consolePathOf(link: string): string | null {
  const value = String(link ?? '').trim()
  if (!value) return null
  if (value.startsWith('/')) return value.startsWith('//') ? null : value
  const scheme = /^aglyn:\/\/(.*)$/i.exec(value)
  if (scheme) return `/${scheme[1].replace(/^\/+/, '')}`
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function splitQuery(path: string): [string, URLSearchParams] {
  const at = path.indexOf('?')
  return at < 0
    ? [path, new URLSearchParams()]
    : [path.slice(0, at), new URLSearchParams(path.slice(at + 1))]
}

/** Matches `/a/:b/c` against a path; returns the `:` params or null. */
export function matchPathPattern(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  if (want.length !== have.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i += 1) {
    if (want[i].startsWith(':')) {
      try {
        params[want[i].slice(1)] = decodeURIComponent(have[i])
      } catch {
        return null
      }
    } else if (want[i] !== have[i]) {
      return null
    }
  }
  return params
}

export function resolveMobileLink(
  link: string,
  deepLinks: readonly MobileDeepLink[],
): MobileLinkTarget | null {
  const full = consolePathOf(link)
  if (!full) return null
  const [path, query] = splitQuery(full)
  const scope = splitConsoleScope(path)
  // Most specific pattern first: fewer `:` segments wins a tie in length.
  const ordered = [...deepLinks].sort(
    (a, b) =>
      b.path.split('/').length - a.path.split('/').length ||
      (a.path.match(/:/g)?.length ?? 0) - (b.path.match(/:/g)?.length ?? 0),
  )
  for (const candidate of ordered) {
    const params = matchPathPattern(candidate.path, scope.rest)
    if (params) {
      return {
        kind: 'screen',
        screen: candidate.screen,
        params: {
          ...Object.fromEntries(query.entries()),
          ...(scope.orgSlug ? { orgSlug: scope.orgSlug } : {}),
          ...(scope.hostSlug ? { hostSlug: scope.hostSlug } : {}),
          ...params,
        },
      }
    }
  }
  return { kind: 'console', path: full }
}
