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

// Guard the guard. check-firewall-posture.mjs is trusted to notice when bot
// protection stops protecting, and a checker that reports "posture fine"
// because it asserted nothing is indistinguishable from a healthy firewall —
// which is exactly how a PUT that returns 200 while deleting managed rules got
// through in the first place.
//
// Every case below starts from a config that is KNOWN GOOD (it mirrors the
// live aglyn-tenant document, minus the secret) and damages exactly one thing,
// then asserts the SPECIFIC finding rather than merely `ok === false`. A test
// that only checks `ok` passes just as happily when the detector has collapsed
// into "return false".
//
// Nothing here touches the network or the real Vercel config.
//
//   npm run test:firewall-posture

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EXPECTED_POSTURE,
  evaluatePosture,
  evaluateProject,
  evaluateRule,
  fetchFirewallConfig,
  formatReport,
  validatePostureTable,
} from './firewall-posture.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const tenantExpected = EXPECTED_POSTURE.find((e) => e.project === 'aglyn-tenant')
const consoleExpected = EXPECTED_POSTURE.find((e) => e.project === 'aglyn-console')
const pluginsExpected = EXPECTED_POSTURE.find((e) => e.project === 'aglyn-plugins')

const bypass = (action = 'bypass') => ({
  mitigate: { redirect: null, action, rateLimit: null, actionDuration: null },
})

/** The live-good aglyn-tenant config, with the probe secret stubbed. */
function healthyTenantConfig() {
  return {
    firewallEnabled: true,
    version: 4,
    managedRules: { bot_protection: { active: true, action: 'challenge' } },
    ips: [],
    rules: [
      {
        name: 'CI and uptime probe bypass',
        id: 'rule_ci_and_uptime_probe_bypass_9U7qre',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [
          { conditions: [{ op: 'eq', type: 'header', key: 'x-aglyn-probe', value: 'not-the-real-token' }] },
        ],
      },
      {
        name: 'Plugin job runner bypass',
        id: 'rule_plugin_job_runner_bypass_LnyY2A',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [
          {
            conditions: [
              { type: 'path', op: 'eq', value: '/api/plugins/run-jobs' },
              { op: 'ex', type: 'header', key: 'x-plugin-jobs-secret', value: '' },
            ],
          },
        ],
      },
      {
        name: 'Health endpoint bypass',
        id: 'rule_health_endpoint_bypass_X48B7Y',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/api/health' }] }],
      },
    ],
  }
}

/**
 * The console as actually deployed: the probe rule; ONE machine-traffic rule
 * that is a single hole with twelve mouths (eleven exact paths and one
 * `/api/health` prefix); and, since 2026-08-23, the plugin loader control
 * plane bypass — one exact path plus one prefix.
 */
function healthyConsoleConfig() {
  const paths = [
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
  ]
  return {
    firewallEnabled: true,
    version: 2,
    managedRules: { bot_protection: { active: true, action: 'challenge' } },
    ips: [],
    rules: [
      {
        name: 'CI and uptime probe bypass',
        id: 'rule_probe_console',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [
          { conditions: [{ op: 'eq', type: 'header', key: 'x-aglyn-probe', value: 'not-the-real-token' }] },
        ],
      },
      {
        name: 'Machine traffic bypass',
        id: 'rule_machine_console',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [
          { conditions: [{ op: 'pre', type: 'path', value: '/api/health' }] },
          ...paths.map((value) => ({ conditions: [{ op: 'eq', type: 'path', value }] })),
        ],
      },
      {
        name: 'Plugin loader control plane bypass',
        id: 'rule_loader_console',
        active: true,
        valid: true,
        action: bypass(),
        conditionGroup: [
          { conditions: [{ op: 'eq', type: 'path', value: '/api/marketplace/listing-versions' }] },
          { conditions: [{ op: 'pre', type: 'path', value: '/api/plugin-host-origins' }] },
        ],
      },
    ],
  }
}

const evalConsole = (config) => evaluateProject({ expected: consoleExpected, config })

const evalTenant = (config) => evaluateProject({ expected: tenantExpected, config })
const findingsFor = (config) => evalTenant(config).findings.join('\n')
const ruleNamed = (config, name) => config.rules.find((r) => r.name === name)

// ── The control: the known-good document must pass ─────────────────────────
// Without this, every red below could be produced by a checker that fails on
// everything.

test('the live-good tenant config passes', () => {
  const result = evalTenant(healthyTenantConfig())
  assert.deepEqual(result.findings, [])
  assert.equal(result.ok, true)
})

// ── The PUT fingerprint ────────────────────────────────────────────────────

test('bot_protection deleted entirely (the PUT-returns-200 fingerprint) fails', () => {
  const config = healthyTenantConfig()
  delete config.managedRules.bot_protection
  const findings = findingsFor(config)
  assert.match(findings, /bot_protection is ABSENT/)
  // The finding must name the cause, because the operator's next move is a
  // repair, and repairing this with another PUT re-breaks it.
  assert.match(findings, /PATCH managedRules\.update/)
  assert.equal(evalTenant(config).ok, false)
})

test('a whole managedRules object wiped by a PUT fails', () => {
  const config = healthyTenantConfig()
  config.managedRules = {}
  assert.match(findingsFor(config), /bot_protection is ABSENT/)
})

test('bot_protection present but inactive fails', () => {
  const config = healthyTenantConfig()
  config.managedRules.bot_protection.active = false
  assert.match(findingsFor(config), /bot_protection\.active is false, expected true/)
})

test('bot_protection downgraded from challenge to log fails', () => {
  const config = healthyTenantConfig()
  config.managedRules.bot_protection.action = 'log'
  assert.match(findingsFor(config), /bot_protection\.action is "log", expected "challenge"/)
})

test('firewallEnabled false fails even with every rule intact', () => {
  const config = healthyTenantConfig()
  config.firewallEnabled = false
  assert.match(findingsFor(config), /firewallEnabled is false.*every rule below is inert/s)
})

// ── Bypass-rule scope decay: the quiet one ─────────────────────────────────

test('the plugin runner rule decayed to PATH-ONLY fails', () => {
  const config = healthyTenantConfig()
  const rule = ruleNamed(config, 'Plugin job runner bypass')
  // Drop the header condition — the rule still exists, still bypasses, still
  // has the right name, and now lets anything reach the job runner.
  rule.conditionGroup[0].conditions = [{ type: 'path', op: 'eq', value: '/api/plugins/run-jobs' }]
  const findings = findingsFor(config)
  assert.match(findings, /NO LONGER REQUIRES header x-plugin-jobs-secret exists/)
  assert.equal(evalTenant(config).ok, false)
})

test('the plugin runner rule decayed to HEADER-ONLY fails', () => {
  const config = healthyTenantConfig()
  const rule = ruleNamed(config, 'Plugin job runner bypass')
  rule.conditionGroup[0].conditions = [{ op: 'ex', type: 'header', key: 'x-plugin-jobs-secret', value: '' }]
  assert.match(findingsFor(config), /NO LONGER REQUIRES path eq "\/api\/plugins\/run-jobs"/)
})

test('a SECOND, wider condition group re-opens the rule and fails', () => {
  // The subtle decay: the original group is untouched and still fully scoped,
  // so any check that looks for "a group that matches" reports clean. Groups
  // are OR'd, so this config bypasses on path alone.
  const config = healthyTenantConfig()
  const rule = ruleNamed(config, 'Plugin job runner bypass')
  rule.conditionGroup.push({
    conditions: [{ type: 'path', op: 'eq', value: '/api/plugins/run-jobs' }],
  })
  const findings = findingsFor(config)
  assert.match(findings, /condition group 2 of 2/)
  assert.match(findings, /NO LONGER REQUIRES header x-plugin-jobs-secret exists/)
})

test('a rule stripped of all condition groups fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'Plugin job runner bypass').conditionGroup = []
  assert.match(findingsFor(config), /NO condition groups — it would match every request/)
})

test('an empty condition group fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'Plugin job runner bypass').conditionGroup = [{ conditions: [] }]
  assert.match(findingsFor(config), /has no conditions — that group matches every request/)
})

// ── Bypass-rule presence, state and secrets ────────────────────────────────

test('a missing probe bypass rule fails', () => {
  const config = healthyTenantConfig()
  config.rules = config.rules.filter((r) => r.name !== 'CI and uptime probe bypass')
  assert.match(findingsFor(config), /"CI and uptime probe bypass" is MISSING/)
})

test('a deactivated bypass rule fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'CI and uptime probe bypass').active = false
  assert.match(findingsFor(config), /is present but INACTIVE/)
})

test('a bypass rule whose mitigation changed away from bypass fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'CI and uptime probe bypass').action = bypass('deny')
  assert.match(findingsFor(config), /no longer mitigates with "bypass" \(found "deny"\)/)
})

test('a probe rule whose secret value was blanked fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'CI and uptime probe bypass').conditionGroup[0].conditions[0].value = ''
  assert.match(findingsFor(config), /NO LONGER REQUIRES header x-aglyn-probe eq <non-empty, redacted>/)
})

test('a probe rule matching a DIFFERENT header key fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'CI and uptime probe bypass').conditionGroup[0].conditions[0].key = 'x-something-else'
  assert.match(findingsFor(config), /NO LONGER REQUIRES header x-aglyn-probe/)
})

test('an undeclared active bypass rule fails', () => {
  const config = healthyTenantConfig()
  config.rules.push({
    name: 'Temporary debugging bypass',
    id: 'rule_oops',
    active: true,
    valid: true,
    action: bypass(),
    conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/' }] }],
  })
  assert.match(findingsFor(config), /UNDECLARED active bypass rule "Temporary debugging bypass"/)
})

test('a non-bypass custom rule is not reported as an undeclared hole', () => {
  const config = healthyTenantConfig()
  config.rules.push({
    name: 'Block a bad crawler',
    active: true,
    valid: true,
    action: bypass('deny'),
    conditionGroup: [{ conditions: [{ type: 'user_agent', op: 'sub', value: 'BadBot' }] }],
  })
  assert.deepEqual(evalTenant(config).findings, [])
})

test('a config with no rules at all fails for every declared rule', () => {
  const config = healthyTenantConfig()
  config.rules = []
  const findings = evalTenant(config).findings
  assert.equal(findings.length, tenantExpected.bypassRules.length)
  assert.ok(findings.every((f) => /is MISSING/.test(f)))
})

// ── Absent configs, and the known-gap mode ─────────────────────────────────

test('a protected project with NO config at all fails', () => {
  const result = evaluateProject({ expected: tenantExpected, config: null })
  assert.match(result.findings.join('\n'), /NO firewall configuration exists at all/)
  assert.equal(result.ok, false)
})

test('a known-gap project with no config passes but WARNS', () => {
  const result = evaluateProject({ expected: pluginsExpected, config: null })
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 0)
  assert.match(result.warnings.join('\n'), /UNPROTECTED \(known gap\)/)
  assert.match(result.warnings.join('\n'), /plugin loader origin/)
})

test('a known-gap project that silently GAINS a config fails, so the table cannot lie', () => {
  const result = evaluateProject({ expected: pluginsExpected, config: healthyTenantConfig() })
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /declares "aglyn-plugins" an UNPROTECTED known gap, but a live/)
  assert.match(result.findings.join('\n'), /move this entry to expect: 'protected'/)
})

// ── The console's machine-traffic bypass, which is one hole with many mouths ─

test('the console posture as deployed passes', () => {
  const result = evalConsole(healthyConsoleConfig())
  assert.deepEqual(result.findings, [])
  assert.equal(result.ok, true)
})

test('a THIRTEENTH group for an undeclared path fails', () => {
  // The whole point of declaring the allowlist. Appending a group is how a
  // scoped bypass quietly becomes a wide one, and groups are OR'd so the
  // original eleven still look right.
  const config = healthyConsoleConfig()
  ruleNamed(config, 'Machine traffic bypass').conditionGroup.push({
    conditions: [{ op: 'eq', type: 'path', value: '/api/orgs' }],
  })
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /NO LONGER REQUIRES path eq one of 11 declared paths/)
})

test('a group that drops its path condition entirely fails', () => {
  const config = healthyConsoleConfig()
  ruleNamed(config, 'Machine traffic bypass').conditionGroup.push({ conditions: [] })
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /has no conditions/)
})

test('losing the machine-traffic rule fails — billing and every cron would be challenged', () => {
  const config = healthyConsoleConfig()
  config.rules = config.rules.filter((r) => r.name !== 'Machine traffic bypass')
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /"Machine traffic bypass" is MISSING/)
})

// ── The plugin loader control plane bypass (AGL-2483, 2026-08-23) ──────────
//
// This rule exists because challenging these two endpoints does not degrade
// the plugin sandbox, it BREAKS it: with the host-origins lookup blocked, the
// loader omits the customer's own domain from `frame-ancestors` and the
// browser refuses the iframe. So the failure direction of losing this rule is
// a customer-visible outage, and each decay below has to be caught by name.

const LOADER_RULE = 'Plugin loader control plane bypass'

test('losing the loader bypass fails — custom-domain sites could not frame a plugin', () => {
  const config = healthyConsoleConfig()
  config.rules = config.rules.filter((r) => r.name !== LOADER_RULE)
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /"Plugin loader control plane bypass" is MISSING/)
})

test('the loader bypass deactivated fails', () => {
  const config = healthyConsoleConfig()
  ruleNamed(config, LOADER_RULE).active = false
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /Plugin loader control plane bypass" is present but INACTIVE/)
})

test('listing-versions widened from `eq` to `pre` fails — it would admit listing-versions-*', () => {
  // The sharp one. `pre` looks like a harmless generalisation and reads
  // identically in the Vercel UI, but it opens every sibling route whose path
  // merely STARTS with the declared one.
  const config = healthyConsoleConfig()
  const group = ruleNamed(config, LOADER_RULE).conditionGroup.find((g) =>
    g.conditions.some((c) => c.value === '/api/marketplace/listing-versions'),
  )
  group.conditions[0].op = 'pre'
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /NO LONGER REQUIRES path eq "\/api\/marketplace\/listing-versions"/)
})

test('a THIRD group on the loader bypass, for an undeclared path, fails', () => {
  // Groups are OR'd, so a rule can be re-opened without touching either
  // existing group. Appending `/api/admin` here would hand the whole staff
  // surface a bot-protection bypass while both declared groups still read
  // exactly right.
  const config = healthyConsoleConfig()
  ruleNamed(config, LOADER_RULE).conditionGroup.push({
    conditions: [{ op: 'pre', type: 'path', value: '/api/admin' }],
  })
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /condition group 3 of 3/)
})

test('the host-origins prefix retargeted to another route fails', () => {
  const config = healthyConsoleConfig()
  const group = ruleNamed(config, LOADER_RULE).conditionGroup.find((g) =>
    g.conditions.some((c) => c.value === '/api/plugin-host-origins'),
  )
  group.conditions[0].value = '/api/plugin'
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  // Named specifically: `/api/plugin` also prefixes `/api/plugins/run-jobs`,
  // so this widening would hand the job runner a second, undeclared bypass.
  assert.match(result.findings.join('\n'), /NO LONGER REQUIRES path eq "\/api\/marketplace\/listing-versions"/)
})

test('the loader bypass mitigating with something other than bypass fails', () => {
  const config = healthyConsoleConfig()
  ruleNamed(config, LOADER_RULE).action = bypass('challenge')
  const result = evalConsole(config)
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /no longer mitigates with "bypass"/)
})

// ── Health endpoint bypass decay (AGL-2486) ────────────────────────────────
// This rule is the only thing keeping `tenant-health` and `beacon-heartbeat
// tenant` green: without it the challenge answers GCP with a 429 checkpoint
// and both go to 0%, which is how they sat for three days. It decays in two
// opposite directions and BOTH are failures — losing it puts the monitoring
// back in the dark, and widening it unchallenges routes that are not health
// endpoints. Each shape below has to be caught by name.

test('losing the health bypass fails — the tenant uptime checks would go dark again', () => {
  const config = healthyTenantConfig()
  config.rules = config.rules.filter((r) => r.name !== 'Health endpoint bypass')
  assert.match(findingsFor(config), /"Health endpoint bypass" is MISSING/)
})

test('the health bypass deactivated fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'Health endpoint bypass').active = false
  assert.match(findingsFor(config), /"Health endpoint bypass" is present but INACTIVE/)
})

test('the health bypass narrowed from `pre` to `eq` fails — the beacon heartbeat is a SUBPATH', () => {
  // `/api/health` would still answer 200 and a one-URL smoke test would call
  // it fixed, while `/api/health/error-beacon` — the `beacon-heartbeat
  // tenant` check — stayed challenged and stayed at 0%.
  const config = healthyTenantConfig()
  ruleNamed(config, 'Health endpoint bypass').conditionGroup = [
    { conditions: [{ type: 'path', op: 'eq', value: '/api/health' }] },
  ]
  assert.match(findingsFor(config), /"Health endpoint bypass" NO LONGER REQUIRES path pre "\/api\/health"/)
})

test('the health bypass widened to the whole /api prefix fails', () => {
  // The dangerous direction: one character deleted from the prefix and every
  // tenant API route is unchallenged, while the rule still passes any check
  // that merely looks for a rule of this name matching a path.
  const config = healthyTenantConfig()
  ruleNamed(config, 'Health endpoint bypass').conditionGroup = [
    { conditions: [{ type: 'path', op: 'pre', value: '/api' }] },
  ]
  assert.match(findingsFor(config), /"Health endpoint bypass" NO LONGER REQUIRES path pre "\/api\/health"/)
})

test('a SECOND, wider group on the health bypass re-opens it and fails', () => {
  // The original group is untouched and still correctly scoped; the hole is
  // the appended one. `conditionGroup` entries are OR'd, so this is the decay
  // that survives any check looking for "a group that matches".
  const config = healthyTenantConfig()
  const rule = ruleNamed(config, 'Health endpoint bypass')
  rule.conditionGroup = [
    ...rule.conditionGroup,
    { conditions: [{ type: 'path', op: 'pre', value: '/' }] },
  ]
  assert.match(findingsFor(config), /"Health endpoint bypass" \(condition group 2 of 2\) NO LONGER REQUIRES/)
})

test('the health bypass mitigating with something other than bypass fails', () => {
  const config = healthyTenantConfig()
  ruleNamed(config, 'Health endpoint bypass').action = bypass('deny')
  assert.match(findingsFor(config), /no longer mitigates with "bypass"/)
})

// ── Aggregate + strict mode ────────────────────────────────────────────────

function configsMatchingLiveToday() {
  return new Map([
    ['aglyn-tenant', healthyTenantConfig()],
    ['aglyn-docs', docsConfig()],
    ['aglyn-console', healthyConsoleConfig()],
    ['aglyn-plugins', null],
  ])
}

function docsConfig() {
  const config = healthyTenantConfig()
  config.rules = config.rules.filter((r) => r.name === 'CI and uptime probe bypass')
  return config
}

test('the posture measured live on 2026-08-23, after the loader bypass went in, passes', () => {
  const result = evaluatePosture({ configs: configsMatchingLiveToday() })
  assert.equal(result.ok, true)
  assert.equal(result.failedCount, 0)
  assert.equal(result.gapCount, 1, 'plugins is the only remaining known gap')
})

test('--strict turns the known gaps into a failure', () => {
  const result = evaluatePosture({ configs: configsMatchingLiveToday(), strict: true })
  assert.equal(result.ok, false)
})

test('one damaged project fails the whole run', () => {
  const configs = configsMatchingLiveToday()
  const damaged = healthyTenantConfig()
  delete damaged.managedRules.bot_protection
  configs.set('aglyn-tenant', damaged)
  const result = evaluatePosture({ configs })
  assert.equal(result.ok, false)
  assert.equal(result.failedCount, 1)
})

test('a project missing from the fetched map is treated as having no config', () => {
  // Never as "nothing to say". A lookup miss must not read as clean.
  const result = evaluatePosture({ configs: new Map() })
  assert.equal(result.ok, false)
  assert.equal(result.failedCount, 3, 'the three protected projects fail; the one gap warns')
})

test('the report names the safe PATCH repair when something failed', () => {
  const configs = configsMatchingLiveToday()
  const damaged = healthyTenantConfig()
  damaged.managedRules = {}
  configs.set('aglyn-tenant', damaged)
  const report = formatReport(evaluatePosture({ configs }))
  assert.match(report, /do NOT repair it with PUT/)
  assert.match(report, /managedRules\.update/)
  assert.match(report, /^FAIL aglyn-tenant/m)
})

// ── The table itself ───────────────────────────────────────────────────────

test('the shipped posture table is well-formed', () => {
  assert.deepEqual(validatePostureTable(EXPECTED_POSTURE), [])
})

test('the table covers all four Vercel projects', () => {
  assert.deepEqual(
    EXPECTED_POSTURE.map((e) => e.project).sort(),
    ['aglyn-console', 'aglyn-docs', 'aglyn-plugins', 'aglyn-tenant'],
  )
})

test('the mode guard rejects an entry with no expect mode', () => {
  const problems = validatePostureTable([{ project: 'aglyn-x', serves: 'something' }])
  assert.match(problems.join('\n'), /`expect` must be 'protected' or 'unprotected'/)
})

test('the mode guard rejects an unprotected entry with no rationale', () => {
  const problems = validatePostureTable([{ project: 'aglyn-x', expect: 'unprotected' }])
  assert.match(problems.join('\n'), /must carry a `gap` rationale/)
})

test('the mode guard rejects a bypass rule with no declared conditions', () => {
  // An unscoped declaration would make the scope assertion vacuous — the rule
  // would "pass" no matter how wide it got.
  const problems = validatePostureTable([
    { project: 'aglyn-x', expect: 'protected', bypassRules: [{ name: 'wide open', conditions: [] }] },
  ])
  assert.match(problems.join('\n'), /declares no conditions/)
})

test('the mode guard rejects duplicate project entries', () => {
  const problems = validatePostureTable([
    { project: 'aglyn-x', expect: 'protected', bypassRules: [] },
    { project: 'aglyn-x', expect: 'protected', bypassRules: [] },
  ])
  assert.match(problems.join('\n'), /duplicate entry/)
})

// ── evaluateRule directly ──────────────────────────────────────────────────

test('evaluateRule reports a missing rule with its rationale', () => {
  const expected = tenantExpected.bypassRules.find((r) => r.name === 'Plugin job runner bypass')
  assert.match(evaluateRule(expected, null).join('\n'), /is MISSING — the every-minute pluginJobsBeat/)
})

// ── Transport ──────────────────────────────────────────────────────────────

test('a 404 means "no config has ever existed", not an error', () => {
  return fetchFirewallConfig({
    token: 't',
    projectId: 'aglyn-console',
    fetchImpl: async () => ({ status: 404, ok: false }),
  }).then((result) => {
    assert.equal(result.ok, true)
    assert.equal(result.config, null)
    assert.equal(result.status, 404)
  })
})

test('a 403 is an operational failure, never a clean read', () => {
  return fetchFirewallConfig({
    token: 't',
    projectId: 'aglyn-tenant',
    fetchImpl: async () => ({ status: 403, ok: false, json: async () => ({ error: { code: 'forbidden' } }) }),
  }).then((result) => {
    assert.equal(result.ok, false)
    assert.match(result.error, /HTTP 403/)
  })
})

test('a network failure is an operational failure', () => {
  return fetchFirewallConfig({
    token: 't',
    projectId: 'aglyn-tenant',
    fetchImpl: async () => {
      throw new Error('ECONNRESET')
    },
  }).then((result) => {
    assert.equal(result.ok, false)
    assert.match(result.error, /ECONNRESET/)
  })
})

// ── This repository is PUBLIC ──────────────────────────────────────────────

test('no shared-secret value is hard-coded in the checker or its library', () => {
  // The probe rule matches on a 64-hex-character shared secret that the API
  // returns in the config body. Asserting it literally would publish it.
  for (const file of ['firewall-posture.mjs', join('..', 'check-firewall-posture.mjs')]) {
    const source = readFileSync(join(here, file), 'utf8')
    assert.equal(
      /\b[0-9a-f]{64}\b/.test(source),
      false,
      `${file} contains something shaped like a 64-hex secret`,
    )
  }
})
