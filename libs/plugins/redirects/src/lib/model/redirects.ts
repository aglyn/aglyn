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

import {
  compileLinearPattern,
  explainLinearPattern,
  type LinearPattern,
} from './linear-regex'

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
  /**
   * The uid of the publishing-role member who last saved this rule with an
   * EXTERNAL destination (AGL-1881). Absent on every internal rule, and on
   * every rule written before that issue.
   *
   * This is provenance, not preference. `cloud/firebase-firestore.rules` lets
   * only `canPublishHostContent` — admin or editor, never `author` — write
   * anything in `hosts/{hostId}/redirects`, so the presence of this field is
   * the serve path's evidence that a publisher chose to send traffic off the
   * platform. `matchRedirect` will not serve an absolute destination without
   * it, which is what makes a rule written BEFORE the rules were fixed refuse
   * to fire rather than having to be trusted.
   *
   * Deliberately a uid rather than a boolean: `true` says nothing a log can be
   * read against, and the recovery for a rule that stops firing is for a
   * publisher to open it and save, which stamps their own uid.
   */
  externalDestinationApprovedBy?: string
}

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const
export const REDIRECT_KINDS = ['exact', 'prefix', 'regex'] as const
export const REDIRECT_DEFAULT_PRIORITY = 100

/** Max regex source length — a rule source has no business being longer. */
const REGEX_SOURCE_MAX = 200

/**
 * Anchors a rule source to the whole path unless the author anchored it
 * themselves. Kept in one place so validation and matching cannot disagree
 * about what is actually compiled.
 */
function anchorSource(pattern: string): string {
  return (
    (pattern.startsWith('^') ? '' : '^') +
    pattern +
    (pattern.endsWith('$') ? '' : '$')
  )
}

/**
 * Compiles a regex rule's source for LINEAR-TIME matching (SEC-M8).
 *
 * Redirect sources are attacker-controlled: any host member with the
 * `author` role can write `source` and `kind` straight to Firestore with the
 * client SDK, so the console's validation is a convenience, not a control —
 * this function, on the request path, is the only thing standing between a
 * customer-authored string and the tenant event loop.
 *
 * It therefore does not use `RegExp`. `compileLinearPattern` runs the
 * pattern on a Thompson NFA simulation whose cost is bounded by
 * `path length × program length` for every possible input, replacing the
 * AGL-505 star-height heuristic that `(a|a|aa)+` walked straight through
 * (9 characters, 59 s measured on a 27-character path).
 *
 * Returns null for malformed patterns and for syntax outside the supported
 * subset — callers reject at save and skip at match, so a bad pattern can
 * never take a site down.
 */
export function compileRedirectRegex(source: string): LinearPattern | null {
  const pattern = String(source ?? '').trim()
  if (!pattern || pattern.length > REGEX_SOURCE_MAX) return null
  return compileLinearPattern(anchorSource(pattern))
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
    if (compileRedirectRegex(rule.source) === null) {
      // Say *why* — the supported subset excludes lookaround and
      // backreferences, and "not a valid regular expression" would send an
      // author hunting for a typo that isn't there.
      const pattern = String(rule.source ?? '').trim()
      if (!pattern) return 'Enter a pattern'
      if (pattern.length > REGEX_SOURCE_MAX) {
        return `Patterns are limited to ${REGEX_SOURCE_MAX} characters`
      }
      const reason = explainLinearPattern(anchorSource(pattern))
      return reason
        ? `That pattern can't be used: ${reason}`
        : 'The pattern is not a valid regular expression'
    }
  } else if (!normalizeRedirectSource(rule.source)) {
    return 'Enter a site path like /old-page'
  }
  if (!normalizeRedirectDestination(rule.destination)) {
    return 'Destinations are internal paths or https:// URLs'
  }
  return null
}

/**
 * Does this destination leave the platform? (AGL-1881.)
 *
 * Written as "not internal" rather than as "starts with https://", so that
 * anything the normalizer has not already vouched for — an empty string, a
 * protocol-relative `//host`, a scheme we never expected — answers TRUE and
 * meets the approval gate rather than slipping past it. `strictNullChecks` is
 * off repo-wide: an absent destination arrives here as `undefined`, folds to
 * `''`, and must not read as "internal, therefore safe".
 */
export function isExternalRedirectDestination(destination: string): boolean {
  const value = String(destination ?? '').trim()
  return !(value.startsWith('/') && !value.startsWith('//'))
}

/**
 * Has a publisher vouched for this rule's external destination? (AGL-1881.)
 *
 * The `typeof` test is the point. With `strictNullChecks` off, a missing field
 * is `undefined` and a stored `null` is `null`; both must answer FALSE, and so
 * must a stamp that is present but blank. Only a non-empty string counts.
 */
function externalDestinationApproved(rule: {
  externalDestinationApprovedBy?: unknown
}): boolean {
  const approver = rule.externalDestinationApprovedBy
  return typeof approver === 'string' && approver.trim().length > 0
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
 *
 * The DESTINATION is validated here too (AGL-1881), after substitution: it
 * must still normalize, and an external one must carry a publisher's stamp.
 * See the two notes inside the loop.
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
    /**
     * Validate the destination HERE, on the serve path, after any `$n`
     * substitution (AGL-1881).
     *
     * This function used to hand `rule.destination` straight back. Console
     * validation was the only thing standing between a stored string and a
     * `Location:` header — the same "the console is a convenience, not a
     * control" note `compileRedirectRegex` already carries about `source`,
     * one field over and never applied.
     *
     * Two distinct holes close on this line:
     *
     *  1. A destination that never met `normalizeRedirectDestination` at all,
     *     because it was written straight to Firestore rather than through the
     *     console — `http://` (a downgrade), `//host` (protocol-relative), a
     *     `javascript:`/`data:` scheme, a value carrying whitespace or CRLF.
     *  2. A destination that DID meet it and stops meeting it once captures
     *     are substituted. `/$1` is an internal path at save time and becomes
     *     `//attacker.example` when the pattern's group swallows a hostname —
     *     an open redirect out of a rule that reads as entirely internal.
     *     Post-substitution is the only place either can be seen.
     *
     * A rule that fails is SKIPPED, not fatal: evaluation continues to the
     * next rule exactly as it does for an uncompilable pattern, so a bad
     * destination can never take a site down.
     */
    const validated = normalizeRedirectDestination(destination)
    if (!validated) continue
    destination = validated
    /**
     * An external destination fires only with a publisher's stamp on it.
     *
     * This is the defence-in-depth half of AGL-1881, and it is what makes the
     * rules fix retroactive. Rules stop an `author` from WRITING one from now
     * on; a rule already written — before this file, from a role that has
     * since been refused, or by any path we have not thought of — still sits
     * in Firestore, and without this it would still be served on every request
     * to the site. Absent stamp, absent field, blank stamp: all refuse.
     *
     * Internal destinations are untouched, which is deliberate. The cost of
     * failing closed here is paid ONLY by rules that send traffic off the
     * platform, and recovering one is a publisher opening it and pressing
     * Save.
     */
    if (
      isExternalRedirectDestination(destination) &&
      !externalDestinationApproved(rule)
    ) {
      continue
    }
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
