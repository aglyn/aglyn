#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * VALUES THE NATIVE APPS NEED FROM MODULES THAT ARE NOT PURE (AGL-3669).
 *
 * The contracts generator reads only proven-pure modules. Two things the
 * native screens need live in modules that reach the plugin registries, so
 * this generator ASKS those modules, through jiti, and writes only their
 * answers:
 *
 * 1. The plan features a screen gates on.
 * The console locks a section behind a plan feature with `checkEntitlement`
 * (overlays, A/B testing, funnels, sequences). The native apps must lock the
 * same sections on the same plans, and must not hand-copy the plan table. The
 * table lives in `plan-entitlements.ts`, which reaches the plugin registries
 * and so is not a pure module the contracts generator may read; this
 * generator instead ASKS it, through jiti, and writes only its answers:
 *
 *   - `libs/native/contracts/derived-values.generated.json`: for each feature
 *     below, each plan's default, and the console's own answer for a set of
 *     workspaces (a per-org override, a dead subscription, a comp) that each
 *     platform's unit tests replay;
 *   - `libs/native/apple/Sources/AglynCore/DerivedValues.generated.swift` and
 *     `libs/native/kotlin/core/src/commonMain/kotlin/com/aglyn/core/DerivedValues.generated.kt`:
 *     the defaults as a literal table, and the goal events as a list.
 *
 * 2. The events an A/B test can count as its goal: the host and site event
 *    types the console's goal picker offers (`HOST_EVENT_TYPES` and
 *    `SITE_EVENT_TYPES`).
 *
 * 3. The release flags that gate a native area (`release_outreach` and the
 *    rest), as the console evaluates them: the value the checked-in Remote
 *    Config template publishes (`cloud/firebase-remoteconfig.template.json`,
 *    read through the console's own `parseReleaseFlagValue`), with recorded
 *    `isReleaseFlagOnForOrg` answers (overrides, plans, rollout buckets) both
 *    platforms replay.
 *
 * Values cross, never code: the native trees still read nothing but
 * generated files. `--check` fails when any output is stale.
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '../..')
const CHECK = process.argv.includes('--check')

/** The features a native screen gates on, by the console's names. */
export const NATIVE_PLAN_FEATURES = ['marketingOverlays', 'abTesting', 'screenAnalytics', 'outreach']

const JSON_OUT = 'libs/native/contracts/derived-values.generated.json'
const SWIFT_OUT = 'libs/native/apple/Sources/AglynCore/DerivedValues.generated.swift'
const KOTLIN_OUT = 'libs/native/kotlin/core/src/commonMain/kotlin/com/aglyn/core/DerivedValues.generated.kt'

function aliases() {
  const paths = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions.paths
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(ROOT, target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(ROOT, target)
  }
  return alias
}

/**
 * The workspaces whose answers each platform replays.
 * AGL-1715-EXEMPT: fixture inputs for the replay cases, not a copy of the live-status set.
 */
const CASE_ORGS = [
  { plan: 'free' },
  { plan: 'starter' },
  { plan: 'pro' },
  { plan: 'business' },
  { plan: 'enterprise' },
  { plan: 'nonsense' },
  { plan: 'business', billingStatus: 'canceled' },
  { plan: 'business', billingStatus: 'past_due' },
  { plan: 'pro', subscription: { status: 'unpaid' } },
  { plan: 'free', entitlements: { planComp: { plan: 'business' } } },
  { plan: 'starter', billingStatus: 'active', entitlements: { planComp: { plan: 'business' } } },
  { plan: 'starter', billingStatus: 'canceled', entitlements: { planComp: { plan: 'pro' } } },
  { plan: 'free', entitlements: { features: { abTesting: true, outreach: true } } },
  { plan: 'enterprise', entitlements: { features: { marketingOverlays: false } } },
]

async function build() {
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false, alias: aliases() })
  const m = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'))
  const plans = Object.keys(m.PLAN_ENTITLEMENTS)
  const defaults = Object.fromEntries(
    plans.map((plan) => [plan, Object.fromEntries(NATIVE_PLAN_FEATURES.map((f) => [f, m.checkEntitlement({ plan }, f)]))]),
  )
  const cases = CASE_ORGS.flatMap((org) =>
    NATIVE_PLAN_FEATURES.map((feature) => ({ org, feature, result: m.checkEntitlement(org, feature) })),
  )
  const hostEvents = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/host-events.ts'))
  const siteEvents = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/site-interactions.ts'))
  const goalEvents = [...hostEvents.HOST_EVENT_TYPES, ...siteEvents.SITE_EVENT_TYPES]
  const flags = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/release-flags.ts'))
  const template = JSON.parse(readFileSync(join(ROOT, 'cloud/firebase-remoteconfig.template.json'), 'utf8')).parameters ?? {}
  const releaseFlags = Object.fromEntries(
    flags.RELEASE_FLAG_KEYS.map((key) => {
      const value = flags.parseReleaseFlagValue(template[key]?.defaultValue?.value, flags.getReleaseFlagDefinition(key).defaultEnabled)
      return [key, { enabled: value.enabled, rolloutPercent: value.rolloutPercent ?? 0, plans: value.plans ?? [] }]
    }),
  )
  const flagValues = [
    { enabled: true },
    { enabled: false },
    { enabled: false, rolloutPercent: 50 },
    { enabled: false, rolloutPercent: 100 },
    { enabled: true, plans: ['business', 'enterprise'] },
  ]
  const flagCases = []
  for (const value of flagValues) {
    for (const orgId of ['org-a', 'org-b', 'org-c', 'mobile-demo-org', null]) {
      for (const plan of ['free', 'business', null]) {
        for (const overrides of [null, { release_outreach: true }, { release_outreach: false }]) {
          flagCases.push({
            flag: 'release_outreach', value, orgId, plan, overrides,
            result: flags.isReleaseFlagOnForOrg('release_outreach', value, orgId, overrides, plan),
          })
        }
      }
    }
  }
  const json = `${JSON.stringify({ '//': 'GENERATED by tools/scripts/generate-native-derived-values.mjs', plans, defaults, cases, goalEvents, releaseFlags, flagCases }, null, 2)}\n`

  const swiftRows = plans
    .map((plan) => `    "${plan}": [${NATIVE_PLAN_FEATURES.map((f) => `"${f}": ${defaults[plan][f]}`).join(', ')}],`)
    .join('\n')
  const swift = `// GENERATED by tools/scripts/generate-native-derived-values.mjs; do not edit.
// The console's checkEntitlement answers for each plan (plan-entitlements.ts).

/// Each plan's default for the plan features native screens gate on.
public enum PlanFeatureDefaults {
  public static let byPlan: [String: [String: Bool]] = [
${swiftRows}
  ]
}

/// The events an A/B test can count as its goal, in the console's picker order.
public enum ExperimentGoalEvents {
  public static let all: [String] = [${goalEvents.map((e) => `"${e}"`).join(', ')}]
}

/// Each release flag as the Remote Config template publishes it.
public enum ReleaseFlagDefaults {
  public static let byKey: [String: ReleaseFlagValue] = [
${Object.entries(releaseFlags).map(([key, v]) => `    "${key}": ReleaseFlagValue(enabled: ${v.enabled}, rolloutPercent: ${v.rolloutPercent}, plans: [${v.plans.map((p) => `"${p}"`).join(', ')}]),`).join('\n')}
  ]
}
`
  const kotlinRows = plans
    .map((plan) => `    "${plan}" to mapOf(${NATIVE_PLAN_FEATURES.map((f) => `"${f}" to ${defaults[plan][f]}`).join(', ')}),`)
    .join('\n')
  const kotlin = `// GENERATED by tools/scripts/generate-native-derived-values.mjs; do not edit.
// The console's checkEntitlement answers for each plan (plan-entitlements.ts).
package com.aglyn.core

/** Each plan's default for the plan features native screens gate on. */
object PlanFeatureDefaults {
  val byPlan: Map<String, Map<String, Boolean>> = mapOf(
${kotlinRows}
  )
}

/** The events an A/B test can count as its goal, in the console's picker order. */
object ExperimentGoalEvents {
  val all: List<String> = listOf(${goalEvents.map((e) => `"${e}"`).join(', ')})
}

/** Each release flag as the Remote Config template publishes it. */
object ReleaseFlagDefaults {
  val byKey: Map<String, ReleaseFlagValue> = mapOf(
${Object.entries(releaseFlags).map(([key, v]) => `    "${key}" to ReleaseFlagValue(${v.enabled}, ${v.rolloutPercent}, listOf(${v.plans.map((p) => `"${p}"`).join(', ')})),`).join('\n')}
  )
}
`
  return { [JSON_OUT]: json, [SWIFT_OUT]: swift, [KOTLIN_OUT]: kotlin }
}

const outputs = await build()
let stale = 0
for (const [path, content] of Object.entries(outputs)) {
  const file = join(ROOT, path)
  let current
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    current = null
  }
  if (current === content) {
    console.log(`ok ${path}`)
  } else if (CHECK) {
    console.error(`stale ${path}: run node tools/scripts/generate-native-derived-values.mjs`)
    stale += 1
  } else {
    writeFileSync(file, content)
    console.log(`wrote ${path}`)
  }
}
process.exit(stale ? 1 : 0)
