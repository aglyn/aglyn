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
// ## That same error message also means "your description is too long"
//
// `value.description` is capped at **256 characters**, and exceeding it
// produces the identical ``Invalid request: `action` should be equal to
// constant`` — no mention of `description`, no mention of a length. Measured
// 2026-08-23: 250 chars validates, 260 does not. This is very likely why
// `rules.insert` was written off as "also failed this way" when the console
// rules first went in, and why a PUT was reached for instead. `rules.insert`
// works fine; the description was just too long.
//
// ## Validating a rule body WITHOUT writing anything
//
// Send it as `rules.update` against an id that does not exist. The schema is
// checked BEFORE the lookup, so:
//
//   HTTP 404 "Rule not found: …"                      → the shape is VALID
//   HTTP 400 "`action` should be equal to constant"   → the shape is INVALID
//
// That gives a dry run against the real validator with no chance of leaving a
// half-built rule behind — which beats inserting a probe rule and deleting it,
// because the delete can fail.
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
      Object.freeze({
        name: 'Health endpoint bypass',
        why: 'four GCP uptime checks read 0% for three days — the challenge answered them with a 429 checkpoint and they cannot be given a bypass header',
        // ADDED 2026-08-23 (AGL-2486). `tenant-health` and `beacon-heartbeat
        // tenant` had been at 0% since 2026-08-21, alongside `marketing-home`
        // and `customer-site`, all four on this project and all four answering
        // 429 Vercel Security Checkpoint.
        //
        // WHY A PATH BYPASS IS THE RIGHT SHAPE HERE, where it would be wrong
        // for the job runner above: `/api/health` and `/api/health/*` are
        // PUBLIC by design, take no auth, read no session, and answer codes
        // rather than messages. There is nothing behind them for a challenge
        // to protect, and challenging them broke the only thing watching the
        // tenant. Contrast the job runner, which is a privileged endpoint and
        // therefore carries a header condition as well — a path-only rule
        // there would leave it open to the internet.
        //
        // Unlike the probe-header bypass, this needs no shared secret and so
        // fixes the endpoints for ANY monitor chosen later, not just GCP's.
        // `pre` rather than `eq` because the tenant serves two of them:
        // `/api/health` and `/api/health/error-beacon` (the beacon heartbeat).
        //
        // MEASURED on 2026-08-23, anonymous `Monitor/1.0`, both halves:
        //   /api/health               200   (challenge bypassed)
        //   /api/health/error-beacon  200   (challenge bypassed)
        //   /                         429   (the page challenge still stands)
        //
        // SCOPE NOTE: `pre` is a prefix, so this rule is exactly as narrow as
        // the `/api/health` namespace is kept. Every route under it must stay
        // public and secrets-free; a privileged route added there would be
        // unchallenged on the day it shipped. `apps/tenant/app/api/` has no
        // other segment beginning `health`, so nothing outside that directory
        // is reachable through this rule today.
        //
        // This does NOT fix `marketing-home` or `customer-site`. Those probe
        // real pages, and the page challenge is doing real work; they need
        // Google's checker IPs allowlisted instead. See docs/UPTIME_AND_SLA.md.
        conditions: Object.freeze([
          Object.freeze({ type: 'path', op: 'pre', value: '/api/health' }),
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
      Object.freeze({
        name: 'Plugin loader control plane bypass',
        why: 'plugins.aglyn.com/load fetches both of these SERVER-SIDE and can carry no bypass header; challenged, a site on a verified custom domain cannot frame a plugin at all',
        // ADDED 2026-08-23 (AGL-2483), repairing a live break that the console
        // enablement two days earlier had introduced and nothing had noticed.
        //
        // `tools/plugin-loader/origin/api/load.mjs` fetches two PUBLIC,
        // unauthenticated, read-only console endpoints from inside its own
        // serverless function, to build the sandbox document's CSP:
        //
        //   /api/marketplace/listing-versions  → the plugin's declared
        //       `connect-src` origins
        //   /api/plugin-host-origins/{hostId}  → the framing site's VERIFIED
        //       custom domain, for `frame-ancestors`
        //
        // A function's `fetch` has no browser to solve a challenge and cannot
        // be given the probe token — that token is scoped to our own scripts,
        // and production infrastructure must not borrow it. So both calls got
        // a 429 checkpoint, `fetchJson` folded them to null, and the loader
        // took its fail-strict path. Failing CLOSED is the right design, but
        // the SECOND consequence is a hard outage rather than a degradation:
        // with no extra ancestor, `frame-ancestors` omits the customer's own
        // domain and the browser blocks the iframe outright — a blank plugin
        // on every custom-domain site, with the reason only in a console log.
        //
        // MEASURED on 2026-08-23, before and after, on host `DXnRbPH4CQ`
        // (cname aglyn.com):
        //   before  frame-ancestors app.aglyn.com *.aglyn.app
        //   after   frame-ancestors app.aglyn.com *.aglyn.app https://aglyn.com
        // and a host id with no custom domain still gains nothing, so the
        // difference is the lookup succeeding rather than a blanket widening.
        //
        // The break was LATENT, not an active outage — worth keeping straight
        // so nobody re-derives a panic from this comment. Every code plugin
        // with a live install is `trust: 'realm'`, and realm bundles run in
        // the app realm, never through this iframe; no published version
        // declares a network origin either. Both consequences were loaded and
        // pointed with nothing yet in front of them: the first sandbox-tier
        // install on a custom domain, or the first declared network origin,
        // would have hit it — and would have read as a plugin bug.
        //
        // Scope: both endpoints are public by design and read-only. The
        // publisher view of listing-versions (`?scope=publisher`) verifies its
        // own Firebase ID token and 401s without one, so this bypasses the bot
        // challenge and nothing else. `eq` on listing-versions is deliberate —
        // `pre` would also admit `/api/marketplace/listing-versions-*`.
        conditions: Object.freeze([
          Object.freeze({ type: 'path', op: 'eq', value: '/api/marketplace/listing-versions' }),
        ]),
        // The host-origins lookup carries the id as a path segment, so it can
        // only be matched by prefix. Declared as an alternate group shape for
        // the same reason `/api/health` is above.
        alsoAllowsGroups: Object.freeze([
          Object.freeze({ type: 'path', op: 'pre', value: '/api/plugin-host-origins' }),
        ]),
      }),
    ]),
  }),
  Object.freeze({
    project: 'aglyn-plugins',
    label: 'plugins',
    expect: 'unprotected',
    serves: 'plugins.aglyn.com — the plugin loader origin',
    // ── REVIEWED 2026-08-23 (AGL-2483). Verdict: NOT a confidentiality or
    //    integrity exposure. Left unprotected ON PURPOSE, with the reasoning
    //    written down so the next person does not have to re-derive it.
    //
    // This origin serves exactly two things, and nothing else (`/` is a 404):
    //
    //   GET /load          the sandbox HTML shell plus a per-request CSP.
    //                      No secrets, no user data, no auth, no session. Its
    //                      whole content ships in this repo.
    //   GET /artifacts/*   an edge rewrite to the console's
    //                      /api/plugin-artifacts/*, which streams
    //                      content-addressed plugin bundles.
    //
    // CONFIDENTIALITY — nothing to leak. Bundles are deliberately public
    // code: the marketplace lists them, and the serving route says so in as
    // many words. A URL needs the exact sha256, and anyone entitled to the
    // listing already has it. A WAF would gate a read that is public by
    // design.
    //
    // INTEGRITY — a WAF in front of our own origin cannot change which bytes
    // we serve, and every property that matters is already enforced by the
    // consumer, not the edge: every loader re-hashes the bundle against the
    // pinned sha256 before executing a byte, realm bundles additionally carry
    // a platform Ed25519 signature, the iframe owns its own sandbox attribute
    // (4e4192b6f), and the served CSP is per-manifest. The real integrity
    // risk is a malicious plugin getting PUBLISHED, which review answers and
    // a firewall does not touch.
    //
    // WHAT IS ACTUALLY EXPOSED — cost and availability. `/load` answers
    // `Cache-Control: private, no-store`, so every request is a function
    // invocation, and each one makes up to TWO further calls to the console.
    // That is an unauthenticated, uncacheable ~3x amplifier. Someone hammering
    // it runs up a bill; they do not get data and they do not get code
    // execution. A bill is not a breach, and the proportionate answer is not
    // a WAF.
    //
    // WHY NOT A CHALLENGE, EVER: `/load` is fetched by visitors to customer
    // sites and by the plugin iframe itself — traffic we neither control nor
    // can hand a bypass header. A challenge here breaks live customer sites.
    // Ruled out on the merits, not deferred.
    //
    // IF ABUSE EVER APPEARS, in order of proportionality: (1) make `/load`
    // cacheable — it is a pure function of its query string, and an s-maxage
    // would let the CDN absorb a flood for free, which is a bigger win than
    // any rule here; (2) a Vercel rate-limit custom rule on `/load` keyed by
    // IP, generous enough that a real visitor never meets it; (3) managed bot
    // protection in `log` action for visibility only. Never `challenge`,
    // never `deny`.
    gap: 'No config has ever existed. REVIEWED 2026-08-23 and deliberately left open: this origin serves only a secrets-free sandbox HTML shell and content-addressed plugin bundles that are public by design and hash-verified (realm: signature-verified) by every consumer before execution, so there is no confidentiality or integrity exposure for a WAF to close. The real exposure is cost/availability — /load is no-store, so every request is a function invocation plus up to two console calls. A challenge is ruled out on the merits: /load is fetched by customer-site visitors and by the plugin iframe, traffic we cannot give a bypass header to. See the comment above this entry for the proportionate controls if abuse ever appears. AGL-2483.',
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
      if (satisfied) continue
      /*
       * Name what the offending group ACTUALLY matches.
       *
       * Without it the finding says only what is missing, which reads as "the
       * path condition was dropped" — and the reader goes looking for an open
       * door. The common reality is narrower and duller: one appended group
       * bypassing one undeclared path, often a route that has since been
       * deleted. It still widens the rule, so it is still a finding; naming
       * the path is what turns it into a one-minute fix instead of an
       * investigation against the live API.
       */
      const matches = conditions.map((actual) => describeCondition(actual)).join(' AND ')
      findings.push(
        `${label}${where} NO LONGER REQUIRES ${describeCondition(required)} — ` +
          'the bypass has widened; groups are OR\'d, so every group must carry ' +
          `every condition. That group bypasses: ${matches || '(nothing — it matches every request)'}`,
      )
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
