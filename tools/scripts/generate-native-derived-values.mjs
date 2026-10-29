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
 * 4. The marketplace's take rate (`marketplaceFeePct`), which the console's
 *    publish panel states for the publisher's plan: each plan's rate, the paid
 *    plans' rate the panel compares against, and `resolveMarketplaceFeePct`'s
 *    answers for a set of workspaces (an override, an out-of-range override, a
 *    dead subscription, a comp) both platforms replay.
 *
 * 5. The plan a workspace's team proposed (AGL-4011): the bundle's words the workspace Home's card reads in one line
 *    (`describeBundle`: each add-on's label, each Aglyn AI tier's name, the most each plan sells of each add-on and
 *    the add-on tokens a stored proposal may name), with `readUpgradeProposal` + `upgradeProposalSummary` answers for
 *    a set of stored proposals both platforms replay.
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

/**
 * The features a native screen gates on, by the console's names: the screens' own, then the ones the nav manifest's
 * create lists ask for (NATIVE_NAV_MANIFEST.create[].items[].planFeature), then the plugins' own flags, where the native
 * screen shows the console's upgrade notice when the plan leaves them out (AGL-3966).
 */
export const NATIVE_PLAN_FEATURES = [
  'marketingOverlays', 'abTesting', 'screenAnalytics', 'outreach', 'giftCards', 'storefrontSubscriptions', 'commerceAnalytics',
  'abandonedCart', 'productReviews', 'dropshipRouting', 'contentGating', 'crm', 'commerce', 'bookings', 'eventCalendar',
  'dataStore', 'redirects', 'workflows',
]

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

/**
 * The workspaces whose marketplace take rate each platform replays: the plan cases, then per-org overrides (a negotiated
 * rate, an out-of-range one that falls back to the free rate, a string the resolver ignores) and a comp, which lifts caps
 * but never a price.
 */
const FEE_CASE_ORGS = [
  ...CASE_ORGS,
  { plan: 'pro', entitlements: { marketplaceFeePct: 12 } },
  { plan: 'pro', entitlements: { marketplaceFeePct: 0 } },
  { plan: 'free', entitlements: { marketplaceFeePct: 150 } },
  { plan: 'business', entitlements: { marketplaceFeePct: -1 } },
  { plan: 'business', entitlements: { marketplaceFeePct: '15' } },
  { plan: 'free', entitlements: { planComp: { plan: 'business', uncapped: true } } },
]

/** The stored proposals whose summary each platform replays (`upgradeProposal` on the org document). */
const PROPOSAL_CASE_ORGS = [
  {},
  { upgradeProposal: { plan: 'pro' } },
  { upgradeProposal: { plan: 'free' } },
  { upgradeProposal: { plan: 'enterprise' } },
  { upgradeProposal: { plan: 'business', interval: 'year' } },
  { upgradeProposal: { plan: 'business', interval: 'month', coupon: 'BOOTH25' } },
  { upgradeProposal: { plan: 'business', coupon: 'not a code!' } },
  { upgradeProposal: { plan: 'starter', addons: { siteCare: 1 } } },
  { upgradeProposal: { plan: 'pro', addons: { managers: 2, hosts: 1, aiAddon: 1 }, aiTier: 'boost', interval: 'year' } },
  { upgradeProposal: { plan: 'pro', addons: { aiAddon: 1 } } },
  { upgradeProposal: { plan: 'starter', addons: { posRegisters: 3, eventCalendar: 4, datasets: 2000 } } },
  { upgradeProposal: { plan: 'business', addons: { extraSeat: 2, extraSite: 1, members: 0, datasets: false } } },
  { upgradeProposal: { plan: 'scale', addons: { managers: 1, members: 1, siteCare: true } } },
  { billingStatus: 'active', upgradeProposal: { plan: 'business' } },
  { billingStatus: 'canceled', upgradeProposal: { plan: 'business', interval: 'year' } },
]

/** A number as a Kotlin Double literal (`20.0`, `12.5`). */
const kotlinDouble = (value) => (Number.isInteger(value) ? `${value}.0` : String(value))

async function build() {
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false, alias: aliases() })
  const m = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'))
  const plans = Object.keys(m.PLAN_ENTITLEMENTS)
  const defaults = Object.fromEntries(
    plans.map((plan) => [plan, Object.fromEntries(NATIVE_PLAN_FEATURES.map((f) => [f, m.checkEntitlement({ plan }, f)]))]),
  )
  // The plan an upsell names: the cheapest one that carries the feature (the console's `planLabelGrantingFeature`).
  const grantedFrom = Object.fromEntries(
    NATIVE_PLAN_FEATURES.flatMap((f) => {
      const label = m.planLabelGrantingFeature(f)
      return label ? [[f, label]] : []
    }),
  )
  // A feature sold only as an add-on says so in its own words (the console extension's `upgradeNotice`).
  const events = await jiti.import(join(ROOT, 'libs/plugins/events-calendar/src/lib/model/upgrade-notice.ts'))
  const addOnNotices = { eventCalendar: events.eventCalendarUpgradeMessage(m.EVENT_CALENDAR_ADDON_MONTHLY_USD) }
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
  const marketplaceFee = {
    byPlan: Object.fromEntries(plans.map((plan) => [plan, m.PLAN_ENTITLEMENTS[plan].marketplaceFeePct])),
    // The rate the publish panel compares against: "On a paid plan it is …".
    paid: m.PLAN_ENTITLEMENTS.starter.marketplaceFeePct,
    cases: FEE_CASE_ORGS.map((org) => ({ org, result: m.resolveMarketplaceFeePct(org) })),
  }
  const bundle = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/bundle-intent.ts'))
  const proposal = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/upgrade-proposal.ts'))
  const bundleWords = {
    kinds: [...bundle.ADDON_KINDS],
    toggles: [...bundle.TOGGLE_ADDON_KIND_LIST],
    // What `parseBundleAddons` reads a stored key as, lower-cased: every spelling it accepts.
    tokens: { ...bundle.TOKEN_KINDS },
    labels: Object.fromEntries(bundle.ADDON_KINDS.map((kind) => [kind, bundle.bundleAddonLabel(kind)])),
    aiTierNames: Object.fromEntries(m.AI_TIER_IDS.map((tier) => [tier, bundle.bundleAddonLabel('aiAddon', undefined, tier)])),
    planLabels: { ...m.PLAN_LABELS },
    // The most of each add-on a plan sells; 0 where it sells none (`fitBundleAddonsToPlan`).
    planMax: Object.fromEntries(
      plans.map((plan) => [plan, Object.fromEntries(bundle.ADDON_KINDS.map((kind) => [kind, bundle.fitBundleAddonsToPlan({ [kind]: 999 }, plan).addons[kind] ?? 0]))]),
    ),
  }
  // The styles a new site can start in (AGL-4049): Create site asks one before
  // it creates anything, on every door the native apps included.
  const styles = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/site-styles.ts'))
  const siteStyles = styles.SITE_STYLES.map(({ id, name, blurb, preview, alt }) => ({ id, name, blurb, preview, alt }))
  const proposalCases = PROPOSAL_CASE_ORGS.map((org) => {
    const standing = proposal.standingUpgradeProposal(org)
    const summary = standing ? proposal.upgradeProposalSummary(standing) : null
    return { org, plan: standing?.plan ?? null, summary, bundled: standing ? summary !== m.PLAN_LABELS[standing.plan] : false }
  })
  const json = `${JSON.stringify({ '//': 'GENERATED by tools/scripts/generate-native-derived-values.mjs', plans, defaults, grantedFrom, addOnNotices, cases, goalEvents, releaseFlags, flagCases, marketplaceFee, bundleWords, proposalCases, siteStyles }, null, 2)}\n`
  const swiftMap = (o, v = (x) => JSON.stringify(x)) => `[${Object.entries(o).map(([k, x]) => `"${k}": ${v(x)}`).join(', ')}]`
  const kotlinMap = (o, v = (x) => JSON.stringify(x)) => `mapOf(${Object.entries(o).map(([k, x]) => `"${k}" to ${v(x)}`).join(', ')})`
  const list = (a) => a.map((x) => `"${x}"`).join(', ')

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

  /// The plan an upsell names for a feature: the cheapest one that carries it.
  public static let grantedFrom: [String: String] = [${Object.entries(grantedFrom).map(([f, label]) => `"${f}": "${label}"`).join(', ')}]

  /// What a workspace reads where a feature sold only as an add-on would be (its console extension's \`upgradeNotice\`).
  public static let addOnNotices: [String: String] = [${Object.entries(addOnNotices).map(([f, text]) => `"${f}": ${JSON.stringify(text)}`).join(', ')}]
}

/// The events an A/B test can count as its goal, in the console's picker order.
public enum ExperimentGoalEvents {
  public static let all: [String] = [${goalEvents.map((e) => `"${e}"`).join(', ')}]
}

/// The marketplace's take rate on each plan (\`marketplaceFeePct\`), and the paid plans' rate.
public enum MarketplaceFeeDefaults {
  public static let byPlan: [String: Double] = [${plans.map((plan) => `"${plan}": ${marketplaceFee.byPlan[plan]}`).join(', ')}]
  public static let paid: Double = ${marketplaceFee.paid}
}

/// A bundle's words (\`describeBundle\`, \`fitBundleAddonsToPlan\`): what the workspace Home's proposed plan reads in one line.
public enum BundleWords {
  public static let kinds: [String] = [${list(bundleWords.kinds)}]
  public static let toggles: [String] = [${list(bundleWords.toggles)}]
  public static let tokens: [String: String] = ${swiftMap(bundleWords.tokens)}
  public static let labels: [String: String] = ${swiftMap(bundleWords.labels)}
  public static let aiTierNames: [String: String] = ${swiftMap(bundleWords.aiTierNames)}
  public static let planLabels: [String: String] = ${swiftMap(bundleWords.planLabels)}
  public static let planMax: [String: [String: Int]] = ${swiftMap(bundleWords.planMax, (o) => swiftMap(o, String))}
}

/// One style a new site can start in (\`site-styles.ts\`): its id, its card's words, and its picture's path on the console's origin.
public struct SiteStyle: Equatable, Sendable {
  public let id: String
  public let name: String
  public let blurb: String
  public let preview: String
  public let alt: String
}

/// The styles a new site can start in, in the order a person is shown them; nothing is chosen for them.
public enum SiteStyles {
  public static let all: [SiteStyle] = [
${siteStyles.map((style) => `    SiteStyle(id: ${JSON.stringify(style.id)}, name: ${JSON.stringify(style.name)}, blurb: ${JSON.stringify(style.blurb)}, preview: ${JSON.stringify(style.preview)}, alt: ${JSON.stringify(style.alt)}),`).join('\n')}
  ]
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

  /** The plan an upsell names for a feature: the cheapest one that carries it. */
  val grantedFrom: Map<String, String> = mapOf(${Object.entries(grantedFrom).map(([f, label]) => `"${f}" to "${label}"`).join(', ')})

  /** What a workspace reads where a feature sold only as an add-on would be (its console extension's \`upgradeNotice\`). */
  val addOnNotices: Map<String, String> = mapOf(${Object.entries(addOnNotices).map(([f, text]) => `"${f}" to ${JSON.stringify(text).replace(/\$/g, '\\$')}`).join(', ')})
}

/** The events an A/B test can count as its goal, in the console's picker order. */
object ExperimentGoalEvents {
  val all: List<String> = listOf(${goalEvents.map((e) => `"${e}"`).join(', ')})
}

/** The marketplace's take rate on each plan (\`marketplaceFeePct\`), and the paid plans' rate. */
object MarketplaceFeeDefaults {
  val byPlan: Map<String, Double> = mapOf(${plans.map((plan) => `"${plan}" to ${kotlinDouble(marketplaceFee.byPlan[plan])}`).join(', ')})
  const val paid: Double = ${kotlinDouble(marketplaceFee.paid)}
}

/** A bundle's words (\`describeBundle\`, \`fitBundleAddonsToPlan\`): what the workspace Home's proposed plan reads in one line. */
object BundleWords {
  val kinds: List<String> = listOf(${list(bundleWords.kinds)})
  val toggles: List<String> = listOf(${list(bundleWords.toggles)})
  val tokens: Map<String, String> = ${kotlinMap(bundleWords.tokens)}
  val labels: Map<String, String> = ${kotlinMap(bundleWords.labels)}
  val aiTierNames: Map<String, String> = ${kotlinMap(bundleWords.aiTierNames)}
  val planLabels: Map<String, String> = ${kotlinMap(bundleWords.planLabels)}
  val planMax: Map<String, Map<String, Int>> = ${kotlinMap(bundleWords.planMax, (o) => kotlinMap(o, String))}
}

/** One style a new site can start in (\`site-styles.ts\`): its id, its card's words, and its picture's path on the console's origin. */
data class SiteStyle(val id: String, val name: String, val blurb: String, val preview: String, val alt: String)

/** The styles a new site can start in, in the order a person is shown them; nothing is chosen for them. */
object SiteStyles {
  val all: List<SiteStyle> = listOf(
${siteStyles.map((style) => `    SiteStyle(${[style.id, style.name, style.blurb, style.preview, style.alt].map((value) => JSON.stringify(value).replace(/\$/g, '\\$')).join(', ')}),`).join('\n')}
  )
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
