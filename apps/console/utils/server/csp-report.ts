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
 * Reading CSP violation reports (AGL-523).
 *
 * The report-only policy has shipped since AGL-518 with **no reporting
 * directive at all**, so every violation it detected went to the console of
 * whoever happened to have devtools open and nowhere else. The evidence the
 * issue wanted before flipping to enforcing — "confirm no legitimate script is
 * being reported" — has therefore never existed, and the choice between
 * `strict-dynamic` and `'self' https: blob:` is currently a guess.
 *
 * Pure, and separate from the route, because the interesting part is not the
 * HTTP: it is deciding which reports are worth keeping.
 *
 * ## Why filtering is the whole job
 *
 * A CSP endpoint that logs everything is worse than none. Browser extensions
 * inject inline scripts into every page they touch, and each injection is a
 * violation — so an unfiltered collector on a logged-in app produces a
 * firehose of reports about code we do not ship and cannot fix. The signal
 * (one of OUR scripts is unnonced) drowns, the flip decision stays unmade,
 * and the log bill is real. Filtering at the edge, before anything is
 * emitted, is what makes the data usable.
 */

/** One violation, normalized across the two wire formats. */
export interface CspViolation {
  /** The page, PATH ONLY — see `documentPath`. */
  documentPath: string
  /** e.g. `script-src-elem`. */
  effectiveDirective: string
  /** What was blocked: a URL, or `inline` / `eval`. */
  blockedUri: string
  /** The script that triggered it, when the browser names one. */
  sourceFile: string
  /** Browser-capped excerpt of the offending inline script. */
  sample: string
  lineNumber: number | null
  /** `enforce` or `report`. */
  disposition: string
}

/**
 * Schemes whose violations are never ours to fix.
 *
 * Extension content scripts are the overwhelming majority of reports on any
 * real deployment. `webkit-masked-url` is Safari's redaction of the same
 * thing, and it is worth listing explicitly: it is opaque, so it can never be
 * actioned, and it arrives in volume.
 */
const FOREIGN_SCHEMES = [
  'chrome-extension:',
  'moz-extension:',
  'safari-extension:',
  'safari-web-extension:',
  'edge-extension:',
  'webkit-masked-url:',
  'chrome:',
  'resource:',
  'asset:',
]

const isForeign = (value: string) => {
  const lowered = value.toLowerCase()
  return FOREIGN_SCHEMES.some((scheme) => lowered.startsWith(scheme))
}

/** Trim a value that a hostile client controls, and that we log. */
const clamp = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

/**
 * The document URL reduced to its path.
 *
 * Query and fragment are dropped deliberately, for two reasons that point the
 * same way: they can carry user data we have no business logging, and keeping
 * them would split one recurring violation into a different line per visitor.
 * The path is what identifies the surface, which is what a fix needs.
 */
export function documentPath(rawUrl: unknown): string {
  const value = clamp(rawUrl, 2048)
  if (!value) return ''
  try {
    return new URL(value).pathname
  } catch {
    // Not a URL. Keep something rather than dropping the report, but never
    // echo an unbounded attacker-supplied string into the log.
    return value.slice(0, 200)
  }
}

/**
 * Normalize either wire format into `CspViolation[]`.
 *
 * Two exist and both are live: `report-uri` posts a single
 * `{"csp-report": {...}}` with kebab-case keys, while the Reporting API
 * (`report-to`) posts an ARRAY of `{type, body}` with camelCase ones. Both
 * directives are sent, because no single one is supported everywhere — so
 * this has to read both or half the browsers report into a parse error.
 */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (!payload || typeof payload !== 'object') return []

  // Reporting API: an array of envelopes, possibly mixed with other report
  // types (deprecation, intervention) that share the endpoint.
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as { type?: unknown }).type === 'csp-violation',
      )
      .map((entry) => fromModern((entry as { body?: unknown }).body))
      .filter((violation): violation is CspViolation => violation !== null)
  }

  const legacy = (payload as { 'csp-report'?: unknown })['csp-report']
  if (legacy && typeof legacy === 'object') {
    const violation = fromLegacy(legacy)
    return violation ? [violation] : []
  }
  return []
}

function fromModern(body: unknown): CspViolation | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return {
    documentPath: documentPath(b['documentURL']),
    effectiveDirective: clamp(b['effectiveDirective'], 64),
    blockedUri: clamp(b['blockedURL'], 512),
    sourceFile: clamp(b['sourceFile'], 512),
    sample: clamp(b['sample'], 80),
    lineNumber: typeof b['lineNumber'] === 'number' ? b['lineNumber'] : null,
    disposition: clamp(b['disposition'], 16) || 'report',
  }
}

function fromLegacy(body: unknown): CspViolation | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return {
    documentPath: documentPath(b['document-uri']),
    // `effective-directive` is the precise one but older browsers only send
    // `violated-directive`, which carries the whole source list. Take the
    // directive name off the front so both shapes group together.
    effectiveDirective:
      clamp(b['effective-directive'], 64) ||
      clamp(b['violated-directive'], 256).split(/\s+/)[0] ||
      '',
    blockedUri: clamp(b['blocked-uri'], 512),
    sourceFile: clamp(b['source-file'], 512),
    sample: clamp(b['script-sample'], 80),
    lineNumber: typeof b['line-number'] === 'number' ? b['line-number'] : null,
    disposition: clamp(b['disposition'], 16) || 'report',
  }
}

/**
 * Is this violation about code we ship?
 *
 * The test is the SOURCE of the offending script, not what was blocked. An
 * extension injecting an inline script reports `blocked-uri: inline` — exactly
 * what one of our own unnonced scripts reports — and the only thing that
 * separates them is `source-file` naming the extension. Filtering on
 * `blocked-uri` alone would therefore throw away the signal and keep the noise,
 * which is the failure mode worth being careful about.
 */
export function isActionableViolation(violation: CspViolation): boolean {
  if (!violation.effectiveDirective) return false
  if (isForeign(violation.sourceFile)) return false
  if (isForeign(violation.blockedUri)) return false
  // Safari reports some extension violations with the page as `source-file`
  // and nothing blocked at all. Nothing to act on either way.
  if (!violation.blockedUri && !violation.sample) return false
  return true
}

/**
 * A stable grouping key, so a recurring violation reads as one problem.
 *
 * Line numbers and samples are deliberately absent: a bundle rebuild moves
 * every line, and the point of the key is that the same defect keeps the same
 * identity across deploys.
 */
export function violationKey(violation: CspViolation): string {
  return [
    violation.effectiveDirective,
    violation.blockedUri,
    violation.documentPath,
  ].join('|')
}
