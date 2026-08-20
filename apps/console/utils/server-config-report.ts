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
 * RESOLVED SERVER CONFIG — what this deployment actually decided (AGL-2069).
 *
 * ## The link nothing observed
 *
 * An env flip is verifiable from OUTSIDE to four links: the key is attached
 * to the deployment, its value reads back, no shared-scope twin shadows it,
 * and the code path is real. What none of that observes is the last link —
 * that the configured value arrives byte-for-byte in the running function's
 * `process.env`. Every external check is a reading of Vercel's *intent*; the
 * runtime's own answer was never asked for.
 *
 * That gap bit us on 2026-08-19: a var was set on the Vercel PROJECT while
 * the DEPLOYMENT serving traffic still lacked it, and the only way to tell
 * was diffing deployment env key lists by hand.
 *
 * It is not hypothetical rigour either. `meteredBackfillMode()` lowercases
 * without trimming, so `STRIPE_METERED_BACKFILL="immediate "` resolves to
 * `boundary` while all four external checks stay green. This module reports
 * the resolver's REAL answer and, separately, flags when that answer
 * disagrees with what the configured text appears to say.
 *
 * ## The invariant that outranks every other line here
 *
 * **A VALUE IS NEVER ECHOED.** Not truncated, not masked, not "just the
 * prefix". There is deliberately no code path that puts a raw env string into
 * the output: every knob goes through a reporter that returns an enum word, a
 * boolean, or a fixed class name, and the report is built from a FIXED
 * descriptor list rather than by iterating `process.env`. A staff-gated env
 * dump is still a credential surface — `tools/deploy/verify-env-isolation.mjs`
 * refuses `decrypt=true` for the same reason.
 *
 * The structural half of that is what makes it hold: adding a knob means
 * writing a descriptor whose reporter has a safe return type, so there is no
 * "just this once" shape to reach for. `SECRET_CLASSES` and the enum words
 * are the entire vocabulary the output can contain.
 *
 * Pure: no `process.env` read, no clock, no fetch. The route supplies the
 * environment and the resolvers' real answers.
 */

/** Where a knob's effective value came from. */
export type ConfigSource = 'env' | 'default'

/**
 * The complete vocabulary a secret-shaped knob may report.
 *
 * A closed set on purpose. Anything not recognized reports `unrecognized`
 * rather than describing what it saw — "it starts with pk_" is still a fact
 * about the value, and the moment the report starts characterizing unknown
 * strings it has become a very slow env dump.
 */
export const SECRET_CLASSES = [
  'absent',
  'live',
  'test',
  'restricted-live',
  'restricted-test',
  'unrecognized',
] as const

export type SecretClass = (typeof SECRET_CLASSES)[number]

export interface ResolvedKnob {
  /** The environment variable's name. Names are not secrets; values are. */
  key: string
  label: string
  /**
   * The resolved, safe-to-render summary: an enum word, a class name or a
   * presence word. Never a raw value, in whole or in part.
   */
  value: string
  /**
   * `env` means someone set it. `default` means the code default is in
   * force. The distinction is the entire point of the endpoint — AGL-1875
   * read `boundary` as a set value when it was the code default, and the two
   * are indistinguishable from the resolved mode alone.
   */
  source: ConfigSource
  /** Non-null when the configured text does not mean what it appears to. */
  warning: string | null
  /** What this knob decides, for whoever reads it on a bad day. */
  drives: string
}

export interface DeploymentIdentity {
  id: string | null
  commit: string | null
  /** Vercel's environment name: production / preview / development. */
  env: string | null
  region: string | null
}

export interface ServerConfigReport {
  deployment: DeploymentIdentity
  knobs: ResolvedKnob[]
  /** Knob keys whose configured text does not resolve to what it looks like. */
  warnings: string[]
}

/**
 * Is a raw env string absent for configuration purposes?
 *
 * An empty string is ABSENT, matching what every resolver here does with it.
 * Reporting `''` as "set" would say someone chose this when what actually
 * happens is the code default — the exact confusion `source` exists to end.
 */
function isAbsent(raw: string | undefined): boolean {
  return raw === undefined || raw === ''
}

/**
 * Classify a secret-shaped credential WITHOUT reading its content.
 *
 * Only Stripe's documented prefixes are matched, and the return value is one
 * of `SECRET_CLASSES` — never anything derived from `raw`. The length is not
 * reported either: it is a fact about the secret, and a report that leaks
 * length has already conceded the principle.
 */
export function describeSecretClass(raw: string | undefined): SecretClass {
  if (isAbsent(raw)) return 'absent'
  const value = String(raw)
  if (value.startsWith('sk_live_')) return 'live'
  if (value.startsWith('sk_test_')) return 'test'
  if (value.startsWith('rk_live_')) return 'restricted-live'
  if (value.startsWith('rk_test_')) return 'restricted-test'
  return 'unrecognized'
}

/**
 * A knob whose only reportable fact is whether it exists.
 *
 * The fallback reporter, and the one to reach for whenever a value is not a
 * closed enum. A bucket name or a webhook URL is not a credential, but it is
 * also not a *decision*, and "set / not set" answers the operational question
 * ("is this deployment configured for it?") without widening the surface.
 */
export function describePresence(raw: string | undefined): 'set' | 'not set' {
  return isAbsent(raw) ? 'not set' : 'set'
}

export interface EnumKnobInput {
  key: string
  label: string
  drives: string
  /** The raw environment text, exactly as the runtime received it. */
  raw: string | undefined
  /** Values the real resolver accepts. */
  allowed: readonly string[]
  /** What the real resolver returns when nothing valid is configured. */
  fallback: string
  /**
   * What the REAL resolver returned for this environment.
   *
   * Passed in rather than recomputed. A report that re-derives the answer is
   * a second transcription of the rule, and a second transcription is exactly
   * how the two drift until the report is confidently wrong — the failure
   * mode `isCronDryRun` was extracted to end. This endpoint's whole claim is
   * "the runtime says so", which it can only make by asking the runtime.
   */
  resolved: string
}

/**
 * One enum-valued knob, resolved and cross-checked.
 *
 * Two independent things are reported and they are not merged:
 *   - `value` is what the resolver ACTUALLY returned. Always. Even when that
 *     is surprising, especially when it is surprising.
 *   - `warning` is set when the configured text does not lead there — the
 *     whitespace case, an unrecognized word, or a resolver that disagrees
 *     with its own documented rule.
 *
 * Merging them would produce the failure this endpoint exists to catch: a
 * report that "corrects" a trailing space into the value someone meant, and
 * so agrees with all four external checks while production does the opposite.
 */
export function analyzeEnumKnob(input: EnumKnobInput): ResolvedKnob {
  const { key, label, drives, raw, allowed, fallback, resolved } = input
  const absent = isAbsent(raw)
  const source: ConfigSource = absent ? 'default' : 'env'

  let warning: string | null = null
  if (!absent) {
    const text = String(raw)
    const lowered = text.toLowerCase()
    const tidied = text.trim().toLowerCase()
    if (!allowed.includes(lowered)) {
      warning = allowed.includes(tidied)
        ? `${key} is set to a value with surrounding whitespace, so it ` +
          `resolves to "${fallback}" instead of "${tidied}". Re-set it with ` +
          'no leading or trailing spaces.'
        : `${key} is set to a value this deployment does not recognize, so ` +
          `the default "${fallback}" is in force. Accepted: ${allowed.join(', ')}.`
    }
  }

  // The resolver disagreeing with the rule as stated here is its own alarm,
  // and a louder one: it means the descriptor and the code have drifted, so
  // every OTHER knob's reasoning is suspect too. Reported, never smoothed.
  const expected = absent
    ? fallback
    : allowed.includes(String(raw).toLowerCase())
      ? String(raw).toLowerCase()
      : fallback
  if (resolved !== expected) {
    warning =
      `${key} resolved to "${resolved}", which is not what this ` +
      `deployment's own rule predicts ("${expected}"). The report and the ` +
      'resolver have drifted — trust the resolver and fix the descriptor.'
  }

  return { key, label, value: resolved, source, warning, drives }
}

/**
 * A knob reported only as a class or a presence word.
 *
 * `source` is `env` whenever anything is set, because for these there is no
 * "code default" to fall back to — absent means the feature is simply off.
 */
export function analyzeOpaqueKnob(input: {
  key: string
  label: string
  drives: string
  raw: string | undefined
  value: string
}): ResolvedKnob {
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    source: isAbsent(input.raw) ? 'default' : 'env',
    warning: null,
    drives: input.drives,
  }
}

/**
 * The deployment this answer came from.
 *
 * Without it the report is unattributable: "mode is immediate" is worthless
 * if you cannot tell which deployment said it, which is precisely the
 * project-vs-deployment confusion that started this issue. The commit ties
 * the reading to a promotion.
 */
export function readDeploymentIdentity(
  env: Record<string, string | undefined>,
): DeploymentIdentity {
  const pick = (key: string): string | null => {
    const raw = env[key]
    return isAbsent(raw) ? null : String(raw)
  }
  return {
    id: pick('VERCEL_DEPLOYMENT_ID'),
    commit: pick('VERCEL_GIT_COMMIT_SHA'),
    env: pick('VERCEL_ENV'),
    region: pick('VERCEL_REGION'),
  }
}

/**
 * What the route must hand in: the real resolvers' answers.
 *
 * Deliberately a narrow, named struct rather than a bag of functions. It
 * keeps this module free of imports from the server barrel (so it stays
 * testable without a Firebase app) while making it impossible to build a
 * report that quietly recomputed a rule instead of observing it.
 */
export interface ResolverAnswers {
  meteredBackfillMode: string
}

/** Modes `meteredBackfillMode()` accepts. Mirrors its own union. */
export const METERED_BACKFILL_MODES = [
  'boundary',
  'immediate',
  'off',
] as const

/**
 * THE DESCRIPTOR LIST.
 *
 * Start with the knobs a flip actually turns, not with coverage. Each entry
 * names its reporter, and the reporters are the only things that can put text
 * in the output — which is what keeps "never echo a value" a property of the
 * shape rather than a rule someone has to remember.
 */
export function buildServerConfigReport(
  env: Record<string, string | undefined>,
  answers: ResolverAnswers,
): ServerConfigReport {
  const knobs: ResolvedKnob[] = [
    analyzeEnumKnob({
      key: 'STRIPE_METERED_BACKFILL',
      label: 'Metered backfill',
      drives:
        'Whether a subscription that should carry a metered item gets one ' +
        'immediately, only at a period boundary, or never. Decides what ' +
        'customers are billed for usage.',
      raw: env['STRIPE_METERED_BACKFILL'],
      allowed: METERED_BACKFILL_MODES,
      fallback: 'boundary',
      resolved: answers.meteredBackfillMode,
    }),
    analyzeOpaqueKnob({
      key: 'STRIPE_SECRET_KEY',
      label: 'Stripe mode',
      drives:
        'Which Stripe account takes the money. `test` on a production ' +
        'deployment means no charge is real; `live` on a preview means one is.',
      raw: env['STRIPE_SECRET_KEY'],
      value: describeSecretClass(env['STRIPE_SECRET_KEY']),
    }),
    analyzeOpaqueKnob({
      key: 'CRON_SECRET',
      label: 'Scheduled jobs',
      drives:
        'Every scheduled route refuses to run without it. Absent means the ' +
        'archival, the erasure runner and the usage rollup are all 501ing.',
      raw: env['CRON_SECRET'],
      value: describePresence(env['CRON_SECRET']),
    }),
    analyzeOpaqueKnob({
      key: 'PLUGIN_ARTIFACTS_BUCKET',
      label: 'Plugin artifacts bucket',
      drives:
        'Where plugin bundles live. Absent means the reaper and the ' +
        're-verifier both 501, and nothing says so.',
      raw: env['PLUGIN_ARTIFACTS_BUCKET'],
      value: describePresence(env['PLUGIN_ARTIFACTS_BUCKET']),
    }),
    analyzeOpaqueKnob({
      key: 'STAFF_ALERT_EMAIL',
      label: 'Staff alert address',
      drives:
        'Where erasure-hold reminders and verifier regressions go. Absent ' +
        'means those alerts are computed and then dropped.',
      raw: env['STAFF_ALERT_EMAIL'],
      value: describePresence(env['STAFF_ALERT_EMAIL']),
    }),
  ]

  return {
    deployment: readDeploymentIdentity(env),
    knobs,
    warnings: knobs
      .filter((knob) => knob.warning)
      .map((knob) => knob.warning as string),
  }
}
