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
 * URL redirects (AGL-154): paid per-host rules at
 * `hosts/{hostId}/redirects/{id}`. Exact source match in v1 (the `kind`
 * field leaves room for patterns later); destinations are internal paths
 * or absolute https URLs. Console validation and tenant enforcement share
 * these helpers so they can't disagree.
 */

export interface HostRedirect {
  /**
   * Match input: a normalized path for exact/prefix rules, a regular
   * expression for regex rules (v2, AGL-375).
   */
  source: string
  /**
   * Internal path (`/pricing`) or absolute https URL. Regex rules may
   * reference capture groups as `$1`, `$2`, ….
   */
  destination: string
  /** 302 by default while testing; owners promote to 301 when sure. */
  statusCode: 301 | 302 | 307 | 308
  enabled?: boolean
  /** Match mode (AGL-375); missing = exact (v1 rules). */
  kind?: 'exact' | 'prefix' | 'regex'
  /** Evaluation order — lower fires first; missing = 100 (v1 rules). */
  priority?: number
}

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const
export const REDIRECT_KINDS = ['exact', 'prefix', 'regex'] as const
export const REDIRECT_DEFAULT_PRIORITY = 100

/** Max regex source length — long patterns are a ReDoS smell. */
const REGEX_SOURCE_MAX = 200

/**
 * Compiles a regex rule's source, anchored to the whole path unless the
 * author anchored it themselves. Returns null for invalid patterns —
 * callers reject at save and skip at match, so a bad pattern can never
 * take a site down.
 */
export function compileRedirectRegex(source: string): RegExp | null {
  const pattern = String(source ?? '').trim()
  if (!pattern || pattern.length > REGEX_SOURCE_MAX) return null
  try {
    const anchored =
      (pattern.startsWith('^') ? '' : '^') +
      pattern +
      (pattern.endsWith('$') ? '' : '$')
    return new RegExp(anchored)
  } catch {
    return null
  }
}

/** Validation for a v2 rule; returns a problem string or null when ok. */
export function validateRedirectRule(rule: {
  kind?: string
  source: string
  destination: string
}): string | null {
  const kind = rule.kind ?? 'exact'
  if (!(REDIRECT_KINDS as readonly string[]).includes(kind)) {
    return 'Unknown match mode'
  }
  if (kind === 'regex') {
    if (!compileRedirectRegex(rule.source)) {
      return 'The pattern is not a valid regular expression'
    }
  } else if (!normalizeRedirectSource(rule.source)) {
    return 'Enter a site path like /old-page'
  }
  if (!normalizeRedirectDestination(rule.destination)) {
    return 'Destinations are internal paths or https:// URLs'
  }
  return null
}

export interface RedirectMatch {
  /** Destination with any capture groups substituted. */
  destination: string
  statusCode: 301 | 302 | 307 | 308
  /** The rule that fired (for hit recording). */
  index: number
}

/**
 * Evaluates rules against a request path (AGL-375): priority order
 * (lower first, stable by list order), exact → equality, prefix →
 * segment-boundary prefix, regex → anchored pattern with `$n` capture
 * substitution in the destination. Disabled, self-targeting, and
 * invalid rules never fire.
 */
export function matchRedirect(
  rules: Array<HostRedirect & { deletedAt?: unknown }>,
  path: string,
): RedirectMatch | null {
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false && !rule.deletedAt)
    .sort(
      (a, b) =>
        (a.rule.priority ?? REDIRECT_DEFAULT_PRIORITY) -
          (b.rule.priority ?? REDIRECT_DEFAULT_PRIORITY) ||
        a.index - b.index,
    )
  for (const { rule, index } of ordered) {
    const kind = rule.kind ?? 'exact'
    let destination: string | null = null
    if (kind === 'exact') {
      if (rule.source === path) destination = rule.destination
    } else if (kind === 'prefix') {
      if (
        path === rule.source ||
        (path.startsWith(rule.source) &&
          (rule.source === '/' || path[rule.source.length] === '/'))
      ) {
        destination = rule.destination
      }
    } else if (kind === 'regex') {
      const pattern = compileRedirectRegex(rule.source)
      const matched = pattern?.exec(path)
      if (matched) {
        destination = rule.destination.replace(
          /\$(\d)/g,
          (token, groupIndex: string) => matched[Number(groupIndex)] ?? '',
        )
      }
    }
    if (!destination) continue
    if (isSelfRedirect({ source: path, destination })) continue
    const statusCode = (REDIRECT_STATUS_CODES as readonly number[]).includes(
      rule.statusCode,
    )
      ? rule.statusCode
      : 302
    return { destination, statusCode, index }
  }
  return null
}

/**
 * Source normalization: leading slash, lowercase, query/hash stripped,
 * trailing slash stripped (root stays `/`). Returns null for unusable
 * input so callers reject rather than store junk.
 */
export function normalizeRedirectSource(input: string): string | null {
  let path = String(input ?? '').trim()
  if (!path) return null
  // Absolute URLs and protocol-ish sources are not paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return null
  if (!path.startsWith('/')) path = `/${path}`
  path = path.split(/[?#]/)[0].toLowerCase()
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (path.length > 500 || /\s/.test(path)) return null
  return path || '/'
}

/**
 * Destination validation: an internal path (normalized like sources but
 * case-preserved) or an absolute https URL. Returns the cleaned value or
 * null when invalid.
 */
export function normalizeRedirectDestination(input: string): string | null {
  const value = String(input ?? '').trim()
  if (!value || value.length > 1000 || /\s/.test(value)) return null
  if (/^https:\/\/[^/]+/i.test(value)) return value
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value.length > 1 ? value.replace(/\/+$/, '') : '/'
  }
  return null
}

/**
 * True when the rule would redirect a path onto itself — the loop case
 * both the console and the tenant enforcement must refuse (they validate
 * independently and may disagree; this is the shared floor).
 */
export function isSelfRedirect(redirect: {
  source: string
  destination: string
}): boolean {
  const destination = redirect.destination.toLowerCase()
  if (destination.startsWith('/')) {
    const normalized =
      destination.length > 1 ? destination.replace(/\/+$/, '') : '/'
    return normalized === redirect.source
  }
  return false
}
