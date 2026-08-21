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

// Declares the expected Vercel WAF posture of every project, and evaluates a
// live firewall config against it (AGL-2483).
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️  THE TRAP THIS EXISTS FOR: `PUT` SILENTLY DELETES MANAGED RULES
// ═══════════════════════════════════════════════════════════════════════════
//
// On 2026-08-21, adding one custom rule to `aglyn-tenant` with
//
//     PUT /v1/security/firewall/config?projectId=<p>&teamId=<t>
//
// returned **HTTP 200**, inserted the rule exactly as asked — and turned OFF
// managed bot protection for the whole project. Every tenant site went
// unchallenged and nothing said so.
//
// The mechanism is a two-step foot-gun:
//
//   1. `PUT` is a WHOLE-DOCUMENT replace. Whatever key you omit is deleted.
//   2. You are FORCED to omit `managedRules`. Sending it back verbatim — even
//      byte-identical to what the API just returned — is rejected with
//      `"managedRules.bot_protection should NOT be valid"`. So the obvious
//      read-modify-write loop cannot work: the API refuses the only body that
//      would have preserved the setting, and then treats the absence you were
//      forced into as an instruction to delete.
//
// The result reads as success in every way a human checks it. The rule is
// there. The status is 200. The response body looks right. Only a read-back of
// `managedRules` shows the damage.
//
// ✅ THE SAFE WRITE — always `PATCH`, one operation at a time:
//
//     PATCH /v1/security/firewall/config?projectId=<p>&teamId=<t>
//     { "action": "managedRules.update", "id": "bot_protection",
//       "value": { "active": true, "action": "challenge" } }
//
// `id` is REQUIRED. Omitting it fails with ``Invalid request: `action` should
// be equal to constant`` — an error about the BODY SHAPE that reads like a
// complaint about the `action` string, and sends you off rewriting a value
// that was correct all along. Custom rules use the same PATCH surface
// (`rules.insert` / `rules.update` / `rules.remove`), so there is never a
// reason to reach for PUT.
//
// ⛔ Do not "simplify" any tooling here into a PUT. The 200 is the danger.
//
// ═══════════════════════════════════════════════════════════════════════════
//
// ## Why a bypass rule needs its SCOPE asserted, not just its presence
//
// A bypass rule is a hole punched through bot protection. "The rule is still
// there" is not the safety property — "the rule is still NARROW" is. The
// plugin job runner rule is the sharp case: it is scoped to the path
// `/api/plugins/run-jobs` AND the presence of the `x-plugin-jobs-secret`
// header. Drop the header condition and it decays to path-only, which leaves
// an unauthenticated job-runner endpoint reachable by anything on the
// internet — while still passing any check that merely counts rules by name.
//
// `conditionGroup` entries are OR'd against each other. So a rule can be
// re-opened WITHOUT touching the existing group, simply by appending a second,
// looser group. That is why `evaluateRule` below requires EVERY group to carry
// EVERY required condition, rather than looking for one group that matches.
//
// ## Secrets
//
// The probe rule matches on a shared-secret header VALUE, and that value is
// returned in the config. It is never asserted literally and never printed:
// the expectation is `valueNonEmpty`, and `describeCondition` redacts. This
// repository is public and Actions logs on a public repo are world-readable.

/** Vercel team scope — the same constant `verify-production-aliases.mjs` uses. */
export const TEAM_SCOPE = 'team_JFfQodGE8VhCAZM6usYTu54M'

/** Managed rule id for Vercel's Bot Protection ruleset. */
export const BOT_PROTECTION = 'bot_protection'

/**
 * The two shared-secret bypass conditions, named once so the tenant and docs
 * entries below cannot drift apart by transcription.
 */
const PROBE_HEADER_CONDITION = Object.freeze({
  type: 'header',
  op: 'eq',
  key: 'x-aglyn-probe',
  // Never the literal token. Asserting non-emptiness catches the rule being
  // blanked without putting the secret in a public repo. See "Secrets" above.
  valueNonEmpty: true,
})

const PROBE_BYPASS_RULE = Object.freeze({
  name: 'CI and uptime probe bypass',
  why: 'uptime-probe.yml would report a false outage on every run without it',
  conditions: [PROBE_HEADER_CONDITION],
})

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPECTED POSTURE — the whole declaration. Adding a project or a bypass rule
 * is an edit to THIS TABLE, never to the logic below.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `expect` is exactly one of:
 *
 *   'protected'    firewallEnabled, bot_protection = {active, challenge}, and
 *                  precisely the declared bypass rules — each still scoped.
 *   'unprotected'  a KNOWN GAP. Requires a `gap` rationale. Still asserted:
 *                  the run fails if the project QUIETLY GAINS protection, so
 *                  the table can never silently describe a fiction. Reported
 *                  as a loud warning on every run, and failed outright under
 *                  `--strict`.
 *
 * There is deliberately no third "don't look at it" mode. A project absent
 * from this table is a project nobody is watching.
 */
export const EXPECTED_POSTURE = Object.freeze([
  Object.freeze({
    project: 'aglyn-tenant',
    label: 'tenant',
    expect: 'protected',
    serves: 'every customer site on *.aglyn.app and their custom domains',
    bypassRules: Object.freeze([
      PROBE_BYPASS_RULE,
      Object.freeze({
        name: 'Plugin job runner bypass',
        why: 'the every-minute pluginJobsBeat was answered with a 429 checkpoint, so no beat was written and cron health read job-silent',
        // BOTH conditions are load-bearing. Path-only would leave the job
        // runner open to the internet; header-only would bypass the challenge
        // site-wide for anyone who guessed the header name.
        conditions: Object.freeze([
          Object.freeze({ type: 'path', op: 'eq', value: '/api/plugins/run-jobs' }),
          Object.freeze({ type: 'header', op: 'ex', key: 'x-plugin-jobs-secret' }),
        ]),
      }),
    ]),
  }),
  Object.freeze({
    project: 'aglyn-docs',
    label: 'docs',
    expect: 'protected',
    serves: 'docs.aglyn.com',
    bypassRules: Object.freeze([PROBE_BYPASS_RULE]),
  }),
  Object.freeze({
    project: 'aglyn-console',
    label: 'console',
    expect: 'protected',
    serves: 'app.aglyn.com — sign-in, billing, and the staff surfaces',
    // Enabled 2026-08-21 (AGL-2483), after this checker found that no config
    // had EVER existed here: a scripted User-Agent reached sign-in and billing
    // with a plain 200 while the marketing site answered the identical request
    // with a challenge — the protection was on backwards.
    //
    // Order mattered more than the decision. The rules below went in FIRST,
    // while nothing was being challenged, and bot protection was turned on
    // second; enabling it first would have challenged Stripe's webhook and all
    // ten scheduled jobs. Note that the managed rule MUST be set through
    // PATCH `managedRules.update`, never a config PUT — see the header above.
    bypassRules: Object.freeze([
      PROBE_BYPASS_RULE,
      Object.freeze({
        name: 'Machine traffic bypass',
        why: "Stripe's webhook and the ten CRON_SECRET jobs would be challenged, silently breaking billing and every scheduled job",
        // Each of these enforces its OWN auth — a Stripe signature or a bearer
        // secret — so this bypasses the bot challenge and nothing else.
        // Verified in both directions on the day it went in: a wrong-secret
        // request reached the app and was refused 401, and an ordinary console
        // route answered the same client 429.
        conditions: Object.freeze([
          Object.freeze({
            type: 'path',
            op: 'eq',
            valueAnyOf: Object.freeze([
              '/api/billing/webhook',
              '/api/billing/report-usage',
              '/api/billing/usage-alerts',
              '/api/billing/usage-email',
              '/api/admin/audit-archive',
              '/api/admin/backfill-scope',
              '/api/admin/finish-domain-attachments',
              '/api/admin/firestore-export',
              '/api/admin/reap-plugin-artifacts',
              '/api/admin/reverify-plugin-versions',
              '/api/admin/run-erasures',
            ]),
          }),
        ]),
        // The health routes ride the same rule as a `pre` group, which the
        // per-group loop below tolerates: a group carrying `path pre
        // /api/health` fails the `eq` expectation above. Declared separately
        // so that stays honest rather than silently excused.
        alsoAllowsGroups: Object.freeze([
          Object.freeze({ type: 'path', op: 'pre', value: '/api/health' }),
        ]),
      }),
    ]),
  }),
  Object.freeze({
    project: 'aglyn-plugins',
    label: 'plugins',
    expect: 'unprotected',
    serves: 'plugins.aglyn.com — the plugin loader origin',
    gap: 'No config has ever existed, and plugins.aglyn.com answers a bot User-Agent with an origin 404 rather than a challenge. The console was the other half of this finding and was closed on 2026-08-21; this one was NOT, because the loader is fetched by customer sites and by the plugin iframe itself, so a challenge here would have to be reconciled with traffic we do not control and cannot give a bypass header to. Deliberately still open. AGL-2483.',
  }),
])

/**
 * Startup mode guard, mirroring the one in `verify-production-aliases.mjs`
 * (AGL-1610): an entry that declares no mode, or an unprotected entry with no
 * rationale, is the shape that produces an unguarded green. Fail at startup
 * rather than reporting on it.
 *
 * @returns {string[]} problems; empty means the table is well-formed.
 */
export function validatePostureTable(table) {
  const problems = []
  const seen = new Set()
  for (const entry of table) {
    const name = entry?.project ?? '(unnamed)'
    if (typeof entry?.project !== 'string' || entry.project.length === 0) {
      problems.push('an entry has no `project` name')
      continue
    }
    if (seen.has(entry.project)) problems.push(`duplicate entry for "${entry.project}"`)
    seen.add(entry.project)

    if (entry.expect !== 'protected' && entry.expect !== 'unprotected') {
      problems.push(`"${name}": \`expect\` must be 'protected' or 'unprotected', got ${JSON.stringify(entry.expect)}`)
      continue
    }
    if (entry.expect === 'protected') {
      if (!Array.isArray(entry.bypassRules)) {
        problems.push(`"${name}": a protected entry needs a \`bypassRules\` array (use [] for none)`)
        continue
      }
      for (const rule of entry.bypassRules) {
        if (typeof rule?.name !== 'string' || rule.name.length === 0) {
          problems.push(`"${name}": a bypass rule has no \`name\``)
        }
        if (!Array.isArray(rule?.conditions) || rule.conditions.length === 0) {
          // A bypass rule with no declared conditions asserts nothing about
          // scope, which is precisely the decay this checker exists to catch.
          problems.push(
            `"${name}": bypass rule "${rule?.name ?? '?'}" declares no conditions — ` +
              'a hole through bot protection must have its scope asserted',
          )
        }
      }
    }
    if (entry.expect === 'unprotected' && (typeof entry.gap !== 'string' || entry.gap.trim().length === 0)) {
      problems.push(`"${name}": an 'unprotected' entry must carry a \`gap\` rationale`)
    }
  }
  return problems
}

/** Human-readable condition, with any secret value redacted. */
export function describeCondition(condition) {
  const key = typeof condition?.key === 'string' && condition.key.length > 0 ? ` ${condition.key}` : ''
  if (condition?.valueNonEmpty === true) return `${condition.type}${key} ${condition.op} <non-empty, redacted>`
  if (condition?.op === 'ex') return `${condition.type}${key} exists`
  if (Array.isArray(condition?.valueAnyOf)) {
    return `${condition.type}${key} ${condition.op} one of ${condition.valueAnyOf.length} declared paths`
  }
  const value = condition?.value === undefined ? '' : ` "${condition.value}"`
  return `${condition?.type}${key} ${condition?.op}${value}`
}

/**
 * Does a live condition satisfy a required one? Every declared facet must
 * match; facets the expectation omits are not constrained.
 */
function conditionSatisfies(required, actual) {
  if (actual === null || typeof actual !== 'object') return false
  if (actual.type !== required.type) return false
  if (actual.op !== required.op) return false
  if (required.key !== undefined && String(actual.key ?? '') !== required.key) return false
  if (required.value !== undefined && String(actual.value ?? '') !== required.value) return false
  if (required.valueNonEmpty === true && String(actual.value ?? '').length === 0) return false
  // `valueAnyOf` is for a rule that is ONE hole with several mouths: the
  // console's machine-traffic bypass lists a dozen paths, one per OR'd group,
  // so the groups do NOT all carry the same value. Declaring the allowlist
  // keeps the scope assertion intact in both directions — a group whose path
  // is not on the list fails, so the rule cannot be widened by appending a
  // thirteenth group for a route nobody declared.
  if (Array.isArray(required.valueAnyOf) && !required.valueAnyOf.includes(String(actual.value ?? ''))) {
    return false
  }
  return true
}

/** The mitigation action of a live rule, tolerating both response shapes. */
export function ruleAction(rule) {
  const nested = rule?.action?.mitigate?.action
  if (typeof nested === 'string') return nested
  if (typeof rule?.action === 'string') return rule.action
  return null
}

/**
 * Assert one expected bypass rule against the live rule of the same name.
 *
 * The scope assertion is the point: EVERY `conditionGroup` must carry EVERY
 * required condition. Groups are OR'd, so checking "some group matches" would
 * pass a rule that had a second, wide-open group appended to it.
 *
 * @returns {string[]} findings; empty means the rule is present and still scoped.
 */
export function evaluateRule(expectedRule, liveRule) {
  const findings = []
  const label = `bypass rule "${expectedRule.name}"`

  if (liveRule === null || liveRule === undefined) {
    return [`${label} is MISSING — ${expectedRule.why ?? 'declared in the posture table'}`]
  }
  if (liveRule.active !== true) findings.push(`${label} is present but INACTIVE`)
  if (liveRule.valid === false) findings.push(`${label} is marked invalid by Vercel`)

  const action = ruleAction(liveRule)
  if (action !== 'bypass') {
    findings.push(`${label} no longer mitigates with "bypass" (found ${JSON.stringify(action)})`)
  }

  const groups = Array.isArray(liveRule.conditionGroup) ? liveRule.conditionGroup : []
  if (groups.length === 0) {
    findings.push(`${label} has NO condition groups — it would match every request`)
    return findings
  }

  groups.forEach((group, index) => {
    const conditions = Array.isArray(group?.conditions) ? group.conditions : []
    const where = groups.length > 1 ? ` (condition group ${index + 1} of ${groups.length})` : ''
    if (conditions.length === 0) {
      findings.push(`${label}${where} has no conditions — that group matches every request`)
      return
    }
    // A rule may declare ALTERNATE group shapes. The console's machine-traffic
    // bypass is one hole with two mouths: eleven groups pin an exact path, and
    // one matches the `/api/health` prefix. Without this a legitimate shape
    // would read as decay; with it, a group still has to match SOME declared
    // shape, so an undeclared group is still caught.
    const alternates = Array.isArray(expectedRule.alsoAllowsGroups)
      ? expectedRule.alsoAllowsGroups
      : []
    const matchesAlternate = alternates.some((alt) =>
      conditions.some((actual) => conditionSatisfies(alt, actual)),
    )
    if (matchesAlternate) return

    for (const required of expectedRule.conditions) {
      const satisfied = conditions.some((actual) => conditionSatisfies(required, actual))
      if (!satisfied) {
        findings.push(
          `${label}${where} NO LONGER REQUIRES ${describeCondition(required)} — ` +
            'the bypass has widened; groups are OR\'d, so every group must carry every condition',
        )
      }
    }
  })

  return findings
}

/**
 * Evaluate one project.
 *
 * @param {object} args
 * @param {object} args.expected  an EXPECTED_POSTURE entry
 * @param {object|null} args.config  the live `.../config/active` body, or null
 *   when the API answered 404 (no config has ever been created).
 * @returns {{project: string, label: string, expect: string, ok: boolean,
 *   findings: string[], warnings: string[]}}
 */
export function evaluateProject({ expected, config }) {
  const findings = []
  const warnings = []
  const absent = config === null || config === undefined

  if (expected.expect === 'unprotected') {
    if (absent) {
      warnings.push(
        `UNPROTECTED (known gap): ${expected.serves ?? expected.project} has no WAF configuration. ${expected.gap}`,
      )
    } else {
      // The table said there is nothing here. There is something here. Either
      // the gap was closed (good — record it) or a config appeared that nobody
      // declared (bad). Both demand a table edit, so both are failures; what
      // must never happen is this drifting unnoticed.
      const bot = config.managedRules?.[BOT_PROTECTION]
      findings.push(
        `the posture table declares "${expected.project}" an UNPROTECTED known gap, but a live ` +
          `firewall config now exists (firewallEnabled=${config.firewallEnabled}, ` +
          `bot_protection=${JSON.stringify(bot ?? null)}). If protection was deliberately ` +
          "enabled, move this entry to expect: 'protected' and declare its bypass rules.",
      )
    }
    return {
      project: expected.project,
      label: expected.label ?? expected.project,
      expect: expected.expect,
      ok: findings.length === 0,
      findings,
      warnings,
    }
  }

  // expect === 'protected'
  if (absent) {
    findings.push(
      'NO firewall configuration exists at all (the API answers 404 and reports zero versions). ' +
        'Bot protection is not merely off — it has never been configured.',
    )
    return {
      project: expected.project,
      label: expected.label ?? expected.project,
      expect: expected.expect,
      ok: false,
      findings,
      warnings,
    }
  }

  if (config.firewallEnabled !== true) {
    findings.push(`firewallEnabled is ${JSON.stringify(config.firewallEnabled)}, expected true — every rule below is inert`)
  }

  const bot = config.managedRules?.[BOT_PROTECTION]
  if (bot === null || bot === undefined) {
    findings.push(
      'managedRules.bot_protection is ABSENT. This is the exact fingerprint of a PUT to ' +
        '/v1/security/firewall/config: a 200 response, the custom rules intact, and the managed ' +
        'ruleset deleted. Restore with PATCH managedRules.update (see the header of this file).',
    )
  } else {
    if (bot.active !== true) findings.push(`managedRules.bot_protection.active is ${JSON.stringify(bot.active)}, expected true`)
    if (bot.action !== 'challenge') {
      findings.push(`managedRules.bot_protection.action is ${JSON.stringify(bot.action)}, expected "challenge"`)
    }
  }

  const liveRules = Array.isArray(config.rules) ? config.rules : []
  for (const expectedRule of expected.bypassRules) {
    const live = liveRules.find((r) => r?.name === expectedRule.name) ?? null
    findings.push(...evaluateRule(expectedRule, live))
  }

  // An undeclared bypass rule is an undeclared hole. Report it even though
  // every declared rule checked out.
  const declared = new Set(expected.bypassRules.map((r) => r.name))
  for (const live of liveRules) {
    if (declared.has(live?.name)) continue
    if (ruleAction(live) !== 'bypass') continue
    if (live?.active !== true) continue
    findings.push(
      `UNDECLARED active bypass rule "${live?.name ?? live?.id ?? '(unnamed)'}" — every hole through ` +
        'bot protection must be declared in the posture table so its scope is asserted',
    )
  }

  return {
    project: expected.project,
    label: expected.label ?? expected.project,
    expect: expected.expect,
    ok: findings.length === 0,
    findings,
    warnings,
  }
}

/**
 * Evaluate every project.
 *
 * @param {object} args
 * @param {Array} args.table  posture entries (defaults to EXPECTED_POSTURE)
 * @param {Map<string, object|null>} args.configs  project name → live config (null = 404)
 * @param {boolean} [args.strict]  treat known gaps as failures
 */
export function evaluatePosture({ table = EXPECTED_POSTURE, configs, strict = false }) {
  const projects = table.map((expected) =>
    evaluateProject({ expected, config: configs.get(expected.project) ?? null }),
  )
  const failed = projects.filter((p) => !p.ok)
  const gaps = projects.filter((p) => p.warnings.length > 0)
  return {
    projects,
    strict,
    ok: failed.length === 0 && (!strict || gaps.length === 0),
    failedCount: failed.length,
    gapCount: gaps.length,
  }
}

/** Render the verdict. Contains no secret values by construction. */
export function formatReport(result) {
  const lines = []
  for (const project of result.projects) {
    const status = project.ok ? (project.warnings.length > 0 ? 'GAP ' : 'OK  ') : 'FAIL'
    lines.push(`${status} ${project.project} (${project.label})`)
    for (const warning of project.warnings) lines.push(`       ⚠ ${warning}`)
    for (const finding of project.findings) lines.push(`       ✗ ${finding}`)
  }
  lines.push('')
  lines.push(
    `${result.projects.length - result.failedCount} of ${result.projects.length} projects match the ` +
      `declared posture; ${result.gapCount} known gap(s)${result.strict ? ', failed under --strict' : ''}.`,
  )
  if (result.failedCount > 0) {
    lines.push('')
    lines.push('If bot_protection went missing, do NOT repair it with PUT — PUT deletes managed')
    lines.push('rules and still answers 200. Use:')
    lines.push('  PATCH /v1/security/firewall/config?projectId=<p>&teamId=<t>')
    lines.push('  { "action": "managedRules.update", "id": "bot_protection",')
    lines.push('    "value": { "active": true, "action": "challenge" } }')
  }
  return lines.join('\n')
}

/**
 * Read one project's ACTIVE firewall config.
 *
 * 404 is not an error here: it is the API's way of saying no config has ever
 * been created, which is a real posture and must reach the evaluator rather
 * than aborting the run. Everything else is an operational failure (exit 2) —
 * a checker that cannot see must never report clean.
 *
 * @returns {Promise<{ok: boolean, config: object|null, status: number, error: string|null}>}
 */
export async function fetchFirewallConfig({ token, projectId, teamId = TEAM_SCOPE, fetchImpl = fetch }) {
  const url =
    'https://api.vercel.com/v1/security/firewall/config/active' +
    `?projectId=${encodeURIComponent(projectId)}&teamId=${encodeURIComponent(teamId)}`
  let response
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (error) {
    return { ok: false, config: null, status: 0, error: `request failed: ${error?.message ?? error}` }
  }
  if (response.status === 404) return { ok: true, config: null, status: 404, error: null }
  if (!response.ok) {
    let detail = ''
    try {
      detail = `: ${JSON.stringify((await response.json())?.error ?? {})}`
    } catch {
      // Non-JSON body — the status alone is the signal.
    }
    return { ok: false, config: null, status: response.status, error: `HTTP ${response.status}${detail}` }
  }
  try {
    return { ok: true, config: await response.json(), status: response.status, error: null }
  } catch (error) {
    return { ok: false, config: null, status: response.status, error: `unparseable body: ${error?.message ?? error}` }
  }
}
