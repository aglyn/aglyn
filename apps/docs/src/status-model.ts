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
 * What the /status page believes, and how it is allowed to say it (AGL-2411).
 *
 * Split out of `pages/status.tsx` because the page could not be unit tested —
 * it imports `@theme/Layout` and `@docusaurus/useDocusaurusContext`, neither
 * of which exists outside a Docusaurus build. Every rule below is therefore
 * a pure function with an injected clock and an injected `fetch`, and every
 * one of them has a spec that has been watched to go red.
 *
 * ## Three rules, each of which is a way a status page lies
 *
 * **1. Only our own contract may produce a verdict.** `operational` is
 * reachable from exactly one shape: HTTP 200 carrying `{"status":"ok"}` from
 * `libs/aglyn/.../health-report.ts`. A 200 with an unreadable body, a CDN
 * interstitial, a bot-protection challenge and a redirect all read as
 * UNKNOWN. The failure this page exists because of is a health surface that
 * could not go red (`/api/health/crons` sat at 503 for fifty-one hours while
 * every HEAD probe answered a hardcoded 200), and "I could not measure it" is
 * the one answer a monitor must never round to "fine".
 *
 * **2. Unknown is not healthy, and it is not down either.** From a browser, a
 * blocked CORS read, a captive portal, a DNS failure and a real outage are
 * indistinguishable. Calling that `down` cries wolf; calling it `ok` is the
 * `.catch(() => null)` bug that renders an unreachable probe as a measured
 * zero. It gets its own verdict and its own words.
 *
 * **3. Nothing from a response body reaches the page except a verdict.** The
 * health endpoints are public and already codes-not-messages, but their
 * bodies still carry `commit`, `region`, `host`, and counts that describe
 * business volume — `recentOrgCreations`, `refusedSignups`, `exportCount`,
 * `undelivered`. `publicDetail` passes CHECK KEYS through a fixed allowlist
 * and reads nothing else, so a field added to a health route later cannot
 * arrive on a public page by default.
 */

/** A service this page probes. Built by `parseTargets`, never by hand. */
export interface StatusTarget {
  /** Stable key for React and for the readings map. */
  name: string
  /** What a visitor sees. */
  label: string
  /** One line of plain English about what this surface does. */
  description: string
  /** Origin, no trailing slash. */
  base: string
  /** Health path on that origin. Defaults to `/api/health`. */
  path: string
}

export type Verdict = 'checking' | 'operational' | 'degraded' | 'unknown'

export interface Reading {
  verdict: Verdict
  /** Round trip in ms. Shown only when operational; it is a latency, not a secret. */
  ms?: number
  /** Public, redacted, allowlisted. Never derived from a body VALUE. */
  detail?: string
}

/**
 * The overall line at the top. `unconfigured` is its own state on purpose:
 * a build that probes nothing must say so rather than inherit the `every()`
 * over an empty array, which is `true` and would have printed "all services
 * are responding normally" while checking none.
 */
export type Overall =
  | 'unconfigured'
  | 'checking'
  | 'operational'
  | 'degraded'
  | 'unknown'

/** Default health path, matching every `/api/health` route in the platform. */
export const DEFAULT_HEALTH_PATH = '/api/health'

/** A probe that has not answered in this long is reported as unknown. */
export const PROBE_TIMEOUT_MS = 10_000

/**
 * `DOCS_STATUS_TARGETS` → targets.
 *
 * Grammar: `name|label|origin|description|path`, comma separated. The fifth
 * field is new (AGL-2411) and optional, so every four-field value documented
 * for self-hosters keeps working. It exists because `/api/health` aggregates
 * liveness only; the checks worth showing a customer are the ones that render
 * a real page (`/api/health/render/site`), and without a path there was no way
 * to point at one.
 *
 * UNSET STILL MEANS NOTHING (AGL-2124). A self-hosted docs build must never
 * fall back to Aglyn's origins — it would print our uptime as the operator's,
 * which is a false all-clear during their outage. Aglyn's own deployment
 * configures this like any other operator would.
 */
export function parseTargets(raw: unknown): StatusTarget[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, label, base, description, path] = entry
        .split('|')
        .map((part) => part.trim())
      return {
        name,
        label: label || name,
        base: (base ?? '').replace(/\/+$/, ''),
        description: description || '',
        // A path that does not start with `/` is a typo, not a relative URL;
        // pasting it onto an origin would silently probe something else.
        path: path && path.startsWith('/') ? path : DEFAULT_HEALTH_PATH,
      }
    })
    .filter((target) => Boolean(target.name && target.base))
}

/**
 * `DOCS_STATUS_FALLBACK_URL` → an independent status page, or nothing.
 *
 * The one link on this page whose whole job is to work when this page does
 * not, so it is the one link that must not be able to point somewhere
 * unexpected. This is operator-supplied configuration rendered into an
 * `href`, and `javascript:` and `data:` are both valid URLs — a value that is
 * not plainly `http(s)` is dropped rather than rendered, because a status
 * page is exactly the surface a reader arrives at already alarmed and
 * inclined to click.
 *
 * Returns the URL to link, or `null` for "print no such sentence". UNSET IS
 * NOT A DEFAULT (AGL-2124): a self-hosted build must never fall back to
 * Aglyn's monitor, which would report our uptime as the operator's at the
 * moment theirs is down.
 */
export function fallbackLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const value = raw.trim()
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:' ? value : null
  } catch {
    return null
  }
}

/** The host a visitor should recognise, for the card. Never an internal id. */
export function targetHost(target: StatusTarget): string {
  try {
    return new URL(target.base).host
  } catch {
    return target.base
  }
}

/** The URL a probe actually requests, cache-buster included. */
export function probeUrl(target: StatusTarget, at: number): string {
  return `${target.base}${target.path}?at=${at}`
}

/**
 * Check keys we are willing to name in public, and the words we name them in.
 *
 * An ALLOWLIST rather than a prettifier: an unrecognised key — including
 * every key a future health route adds — collapses to "a dependency". The
 * alternative leaks internal subsystem naming (`signupRefusals`,
 * `meteredPricing`, `billingWebhook`) onto a page anyone can read.
 */
const PUBLIC_CHECK_LABELS: Record<string, string> = {
  firestore: 'the data store',
  render: 'page rendering',
}

const GENERIC_CHECK_LABEL = 'a dependency'

/**
 * A public sentence for a degraded body — built ONLY from check keys.
 *
 * Nothing here reads a value. `code`, `host`, `commit`, `region`, and every
 * count in a health body are ignored by construction rather than by omission,
 * because "remember not to add the new field" is not a control.
 */
export function publicDetail(body: unknown): string {
  const checks = (body as { checks?: Record<string, unknown> } | null)?.checks
  const failed =
    checks && typeof checks === 'object'
      ? Object.entries(checks)
          .filter(([, value]) => (value as { ok?: unknown })?.ok !== true)
          .map(([key]) => PUBLIC_CHECK_LABELS[key] ?? GENERIC_CHECK_LABEL)
      : []
  const unique = Array.from(new Set(failed))
  if (!unique.length) return 'the service reported a problem'
  return `${unique.join(' and ')} ${unique.length > 1 ? 'are' : 'is'} not responding normally`
}

/**
 * Turn one HTTP answer into a verdict.
 *
 * The ladder, in the order it is applied:
 *
 * - **5xx** → `degraded`. The origin failed to serve, whatever the body says.
 *   This is the branch a real outage lands in, and it must not depend on the
 *   body parsing — a 503 whose body is an HTML error page is still a 503.
 * - **200 + `{"status":"ok"}`** → `operational`. The only path to green.
 * - **200 + `{"status":"degraded"}`** → `degraded`. Should not happen against
 *   our contract (degraded is a 503), and if it ever does, the body's own
 *   claim wins over the status code rather than being rounded up.
 * - **anything else** → `unknown`. A 429 bot challenge, a 404 from a
 *   misconfigured path, a 200 of HTML from a proxy: all of them mean this
 *   page did not get a reading, and none of them is evidence of health.
 */
export function readingFromResponse(
  status: number,
  body: unknown,
  ms: number,
): Reading {
  const claimed = (body as { status?: unknown } | null)?.status

  if (status >= 500 && status < 600) {
    return {
      verdict: 'degraded',
      ms,
      detail: claimed === 'degraded' ? publicDetail(body) : 'the service returned an error',
    }
  }
  if (status === 200 && claimed === 'ok') return { verdict: 'operational', ms }
  if (claimed === 'degraded') return { verdict: 'degraded', ms, detail: publicDetail(body) }

  return {
    verdict: 'unknown',
    ms,
    detail: 'the reply was not a status this page can read',
  }
}

/** Turn a thrown fetch into a verdict. Always `unknown` — see rule 2. */
export function readingFromError(error: unknown, ms: number): Reading {
  const name = (error as { name?: string } | null)?.name
  return {
    verdict: 'unknown',
    ms,
    detail:
      name === 'TimeoutError'
        ? `no answer within ${Math.round(PROBE_TIMEOUT_MS / 1000)}s`
        : 'this check could not be completed from your browser',
  }
}

/**
 * Probe one target.
 *
 * `fetch` and the clock are injected so the spec can drive every branch
 * without a network — including the branch where `response.json()` itself
 * throws, which is the one that used to fold into "operational".
 *
 * `redirect: 'error'` is deliberate and matches `tools/scripts/probe-uptime.mjs`:
 * a base that 3xxes to the real host would otherwise report the redirect
 * TARGET's health under this target's name. Pointing a monitor at a
 * redirecting hostname is a mistake this repo has already made once.
 */
export async function probeTarget(
  target: StatusTarget,
  deps: {
    /**
     * Defaulted rather than required, and defaulted through a CLOSURE.
     *
     * `probeTarget(target, { fetch })` reads correctly and is wrong: a bare
     * `fetch` reference loses its binding to `window`, and calling it throws
     * `TypeError: Illegal invocation` in every browser. Every target then
     * reported "no reading" on a perfectly healthy day — the page was
     * pessimistic rather than falsely green, so nothing crashed and nothing
     * logged, and the unit suite could not see it because the spec injects its
     * own function. The browser run is what caught it (AGL-2411).
     */
    fetch?: typeof fetch
    now?: () => number
    timeoutMs?: number
  } = {},
): Promise<Reading> {
  const call: typeof fetch =
    deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  try {
    const response = await call(probeUrl(target, startedAt), {
      // Belt and braces. The endpoint sends `no-store`, the URL carries a
      // cache-buster, and this asks the browser not to reuse a stored copy —
      // a status page reading from cache reports the past.
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS),
    })
    // `.json()` rejects on an HTML body. Swallowing that to `null` is safe
    // ONLY because `readingFromResponse` treats a missing `status` as unknown
    // rather than as ok — the swallow is not allowed to imply health.
    const body = await response.json().catch(() => null)
    return readingFromResponse(response.status, body, now() - startedAt)
  } catch (error) {
    return readingFromError(error, now() - startedAt)
  }
}

/** Every target starts as `checking`, never as absent-and-therefore-fine. */
export function initialReadings(
  targets: StatusTarget[],
): Record<string, Reading> {
  return Object.fromEntries(
    targets.map((target) => [target.name, { verdict: 'checking' as Verdict }]),
  )
}

/**
 * The headline verdict.
 *
 * Precedence is `unconfigured` → `checking` → `degraded` → `unknown` →
 * `operational`, and `operational` is only reachable when there is at least
 * one target AND every one of them read green. A missing reading counts as
 * `checking`, so a target that never resolved cannot be quietly dropped from
 * the `every()`.
 */
export function overallStatus(
  targets: StatusTarget[],
  readings: Record<string, Reading>,
): Overall {
  if (!targets.length) return 'unconfigured'
  const verdicts = targets.map(
    (target) => readings[target.name]?.verdict ?? 'checking',
  )
  if (verdicts.some((verdict) => verdict === 'checking')) return 'checking'
  if (verdicts.some((verdict) => verdict === 'degraded')) return 'degraded'
  if (verdicts.some((verdict) => verdict === 'unknown')) return 'unknown'
  return 'operational'
}

/** The sentence under the heading. Kept beside the states so none is missed. */
export const OVERALL_SUMMARY: Record<Overall, string> = {
  unconfigured:
    'This documentation build is not configured to check any services. ' +
    'Set DOCS_STATUS_TARGETS to monitor your own deployment.',
  checking: 'Checking each service from your browser…',
  operational: 'All checked services are responding normally.',
  degraded: 'At least one service is not responding normally.',
  unknown:
    'Some checks could not be completed from your browser, so this page ' +
    'cannot confirm that everything is healthy.',
}

export const VERDICT_WORDS: Record<Verdict, string> = {
  checking: 'Checking…',
  operational: 'Operational',
  degraded: 'Degraded',
  unknown: 'No reading',
}

/**
 * Grey for both states this page is not certain about, and the two certain
 * states keep the colours a status page is read for. `unknown` deliberately
 * does NOT get the red it used to: an unreachable check is not an outage, and
 * a page that paints one red teaches people to ignore the red that matters.
 */
export const VERDICT_COLOURS: Record<Verdict, string> = {
  checking: '#9aa0a6',
  operational: '#1a9c53',
  degraded: '#c5342b',
  unknown: '#6b7280',
}
