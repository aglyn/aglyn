#!/usr/bin/env node
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

// No secret is shared between PRODUCTION and development/preview (AGL-2401,
// AGL-2403).
//
//   node tools/deploy/verify-env-isolation.mjs            # the isolation check
//   node tools/deploy/verify-env-isolation.mjs --json     # machine output
//   node tools/deploy/verify-env-isolation.mjs --deployment
//        # ALSO: did a config change actually reach the running deployment?
//
// Exit codes: 0 = every secret is environment-isolated; 1 = at least one
// secret spans production and a non-production environment; 2 = the check
// could not be performed (no token, an API error, or the evidence failed its
// own negative control — see "This check must be able to fail").
//
// ## IT NEVER READS A VALUE, AND THAT IS NOT A LIMITATION
//
// This script decides everything from env var METADATA. It never passes
// `decrypt=true`, never runs `vercel env pull`, never writes a value to disk
// and never prints one. It does not need to, because sameness is decidable
// from the record shape alone:
//
//   A Vercel environment variable is a RECORD with one value and a `target`
//   array. Two environments can only hold DIFFERENT values if they are
//   described by DIFFERENT records. So a single record whose target spans
//   `production` and `development` is PROOF that development holds the
//   production value — no decryption, no fingerprint, no handle on the secret
//   left behind afterwards.
//
// The AGL-2403 audit established the same fact by pulling every value and
// comparing salted hashes. That worked, but it put ten production secrets in a
// file on a laptop to prove they should not be on a laptop. This asks the
// question the other way round.
//
// ⚠️ The API hands back plaintext whether you want it or not — `decrypt=false`
// does NOT suppress the `value` field (measured 2026-08-23: 106 of console's
// 122 records carry one). The guarantee is therefore enforced in code, by
// `metadataOnly()` below, which drops every field but four the moment a
// response arrives. Read that comment before changing how records are read.
//
// The inverse — a record that spans only `production` — proves nothing about
// the OTHER environments (they may have their own record, or none). That is
// why the check is stated as "no record spans", not "each env differs".
//
// ## THE SHARED SCOPE IS THE WHOLE POINT
//
// `vercel env ls` shows PROJECT-scope variables only. It cannot see
// team-shared ("Shared Environment Variables") records, and that is exactly
// where `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
// `TOKEN_SIGNING_SECRET` and `GA4_API_SECRET` live. Measured 2026-08-20: 14 of
// the 15 team-shared keys appear in NONE of the three `vercel env ls`
// environments for aglyn-console, while every one of them is present in the
// production deployment's env key list. An audit that trusted `env ls` would
// have reported this repo clean.
//
// So this script reads BOTH scopes, and a failure to read the shared scope is
// exit 2 — never a quiet pass on the project scope alone.
//
// ## THIS CHECK MUST BE ABLE TO FAIL
//
// A guard that cannot go red is not evidence. Two negative controls run before
// any verdict is issued, and both abort with exit 2 rather than reporting
// "clean":
//
//   1. Per project, at least one key must be represented by MORE THAN ONE
//      record (a per-environment split). If the API never splits a key, then
//      "one record spanning three environments" would be how it represents
//      everything and would prove nothing. Measured 2026-08-20: aglyn-console
//      splits USAGE_EMAIL_FROM, VERCEL_TEAM_ID, VERCEL_TENANT_PROJECT_ID and
//      NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST; aglyn-tenant splits
//      USAGE_EMAIL_FROM.
//   2. The shared scope must return a non-empty record set.
//
// ## WHAT COUNTS AS A SECRET
//
// Deny by default. Every key is a secret unless it is named in ALLOW_SHARED
// with a written reason, because the failure directions are not symmetric: a
// wrongly-flagged config value costs one line in a report, a wrongly-excused
// credential is the thing this file exists to catch. Adding a key to
// ALLOW_SHARED is a deliberate act with a sentence attached.
//
// `NEXT_PUBLIC_*` is allowed as a class: Next inlines those into the client
// bundle by definition, so they are published, not shared. A credential must
// never carry that prefix — `check-provider-key-exposure.mjs` is the guard for
// that, and it is a different question from this one.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TEAM_SCOPE = 'team_JFfQodGE8VhCAZM6usYTu54M'
const API = 'https://api.vercel.com'

const PROJECTS = [
  { label: 'console', id: 'prj_gEzxEXc0Lhs81rmaXIg2a1GbsDfl', name: 'aglyn-console' },
  { label: 'tenant', id: 'QmVstR8xiYtabTkVo2t9NNsiYY72nSTbNr1MGDLffzZeLn', name: 'aglyn-tenant' },
]

/** The non-production environments a production secret must never span. */
const NON_PRODUCTION = ['development', 'preview']

/**
 * Keys that may legitimately hold one value across every environment.
 *
 * Each entry is a REASON, not a note — if you cannot write the sentence, the
 * key does not belong here.
 */
const ALLOW_SHARED = {
  // Service-account JSON fields that are public by construction. The account's
  // identity and endpoints are not the credential; FIREBASE_PRIVATE_KEY and
  // FIREBASE_PRIVATE_KEY_ID are, and they are deliberately absent from this
  // list.
  FIREBASE_TYPE: 'constant literal "service_account"',
  FIREBASE_PROJECT_ID: 'the GCP project id, published in every client config',
  FIREBASE_CLIENT_ID: 'the OAuth client id — an identifier, not a credential',
  FIREBASE_CLIENT_EMAIL: 'the service account identity; useless without the private key',
  FIREBASE_AUTH_URI: 'a Google endpoint URL, identical for every project',
  FIREBASE_TOKEN_URI: 'a Google endpoint URL, identical for every project',
  FIREBASE_AUTH_PROVIDER_X509_CERT_URL: 'a public Google certificate endpoint',
  FIREBASE_CLIENT_X509_CERT_URL: 'a public certificate endpoint for this account',

  // Configuration and identifiers. None authorizes anything.
  GA4_MEASUREMENT_ID: 'a GA4 stream identifier, shipped to every browser',
  STRIPE_METERED_BACKFILL: 'a behaviour switch, not a credential',
  VERCEL_TEAM_ID: 'an account identifier, visible in every dashboard URL',
  VERCEL_CONSOLE_PROJECT_ID: 'a project identifier',
  VERCEL_TENANT_PROJECT_ID: 'a project identifier',
  AGLYN_APP_HOSTNAME: 'a hostname resolved in public DNS',
  AGLYN_CONSOLE_HOSTNAME: 'a hostname resolved in public DNS',
  AGLYN_TENANT_HOSTNAME: 'a hostname resolved in public DNS',
  AGLYN_TENANT_DOMAIN: 'the platform domain tenant sites are served under',
  AGLYN_TENANT_CUSTOM_DOMAIN: 'a customer domain, published by the site itself',
  AGLYN_TENANT_DEMO: 'the demo site identifier',
  USAGE_EMAIL_FROM: 'the From: address on usage mail, printed in every send',
  NODE_OPTIONS: 'node runtime flags, no credential material',
}

/**
 * Sharing that is a DECISION rather than a defect, per environment.
 *
 * `development` and `preview` are different questions and are reported
 * separately for that reason. A production credential in `preview` can be
 * deliberate — a preview build that exercises the real payment path before
 * release is a thing a team can reasonably choose. The same credential in
 * `development` is a different claim entirely: that target is what
 * `vercel env pull` writes to a laptop, so accepting it means accepting the
 * value on every machine that ever ran the command.
 *
 * An entry silences the named environments for that key and nothing else — the
 * other environment still fails the run. Each needs `who` and `why`, so that a
 * year from now the entry reads as a decision somebody made rather than as an
 * exception somebody needed.
 *
 * Deliberately EMPTY. The point of the mechanism is that accepting a shared
 * credential is an explicit, attributed edit to this file, not a quiet
 * allowlist entry, and not a finding everyone learns to scroll past.
 */
const ACCEPTED = {
  // STRIPE_SECRET_KEY: {
  //   environments: ['preview'],
  //   who: 'Zach, 2026-08-__',
  //   why: 'preview exercises the real payment path before release (AGL-2401)',
  // },
}

/**
 * Findings whose remediation is already tracked. Purely presentational — they
 * still fail the run. The point is that a reader of the output can tell a
 * known, owned item from a new one.
 */
const KNOWN_ISSUE = {
  STRIPE_SECRET_KEY: 'AGL-2401',
  STRIPE_WEBHOOK_SECRET: 'AGL-2401',
  CRON_SECRET: 'AGL-2403',
  TOKEN_SIGNING_SECRET: 'AGL-2403',
  RESEND_API_KEY: 'AGL-2403',
  GA4_API_SECRET: 'AGL-2403',
  // The Firebase Admin service-account credential. Not in AGL-2403's original
  // table, because that audit's test was four-way identity ACROSS projects and
  // console's copy differs from tenant's — but within each project one record
  // still covers development, preview and production, which is the fact that
  // matters. Admin SDK bypasses every Firestore and Storage rule.
  FIREBASE_PRIVATE_KEY: 'AGL-2403',
  FIREBASE_PRIVATE_KEY_ID: 'AGL-2403',
  // Read by nothing in the repo — the remedy is deletion, not rotation.
  RECAPTCHA_PRIVATE_KEY: 'AGL-2403',
  APP_CHECK_DEBUG_TOKEN_FROM_CI: 'AGL-2402',
  APP_CHECK_DEBUG_TOKEN_FROM_CONSOLE: 'AGL-2402',
  // preview-only exposure (not on a laptop), so narrower than the rest —
  // still one value in front of production.
  MEMBER_SESSION_SECRET: 'AGL-2403',
  REVALIDATE_SECRET: 'AGL-2403',
  PLUGIN_JOBS_SECRET: 'AGL-2403',
  // A Vercel API token can rewrite the environment variables themselves, so
  // sharing it with preview makes every other split on this list revocable by
  // whoever holds the preview build.
  VERCEL_TOKEN: 'AGL-2403',
  // Found 2026-08-23 by the first wired run, and UNTRACKED until then — which
  // is the point of leaving new findings unlabelled rather than defaulting
  // them to the nearest issue. Grants issue read/write on the Aglyn Linear
  // workspace, i.e. the planning record this whole launch runs on.
  LINEAR_API_KEY: 'AGL-2403',
}

const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')
const WITH_DEPLOYMENT = args.includes('--deployment')
const SELF_TEST = args.includes('--self-test')

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node tools/deploy/verify-env-isolation.mjs [--deployment] [--json] [--self-test]\n\n' +
      '  --deployment  also diff the env KEY list of the newest production\n' +
      '                deployment against the one before it, which is how you\n' +
      '                prove a dashboard change reached the running build.\n' +
      '  --json        machine-readable output on stdout.\n' +
      '  --self-test   drive the verdict over doctored records; no network, no\n' +
      '                token. Proves the guard can still go RED.\n\n' +
      'Reads Vercel env METADATA only. Never decrypts, never prints a value.\n',
  )
  process.exit(0)
}

const unknownArgs = args.filter((a) => !['--deployment', '--json', '--self-test'].includes(a))
if (unknownArgs.length) {
  process.stderr.write(`Unknown argument(s): ${unknownArgs.join(', ')}\n`)
  process.exit(2)
}

/** Progress goes to stderr so --json keeps stdout machine-clean. */
const note = (line) => {
  if (!JSON_OUT) process.stderr.write(`${line}\n`)
}

class Fatal extends Error {}

/**
 * The Vercel API token: `VERCEL_TOKEN` first, then the CLI's own auth file —
 * the same credential `vercel` already uses, never a new secret. Matches
 * `verify-production-aliases.mjs` so one login serves both.
 */
function readVercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim()
  // In CI the repo secret is the ONLY acceptable credential. Without this,
  // a runner image that happened to carry a developer's `vercel login` would
  // let the job pass on a credential nobody configured — the same shape as
  // `check-firewall-posture.mjs`, which disables its fallback the same way.
  if (process.env.CI) return null
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.vercel', 'auth.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (token) return String(token).trim()
    } catch {
      // Unreadable or not JSON — try the next candidate.
    }
  }
  return null
}

async function api(token, path) {
  // Belt and braces: this script must never ask for plaintext, so a URL that
  // would request it is a programming error rather than a runtime option.
  if (/decrypt=true/.test(path)) {
    throw new Fatal(`refusing to request decrypted values: ${path}`)
  }
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Fatal(`GET ${path} -> HTTP ${res.status} ${res.statusText}`)
  }
  return res.json()
}

/**
 * ⚠️ `decrypt=false` DOES NOT SUPPRESS THE VALUE. Measured 2026-08-23 against
 * aglyn-console: `/v9/projects/{id}/env?decrypt=false` and the v10 form with
 * no flag at all both return 122 records of which **106 carry a readable
 * plaintext `value`**. The flag governs an explicit decrypt request, not
 * whether the field comes back.
 *
 * So the "reads metadata only" guarantee cannot rest on a query parameter. It
 * rests on this function: every record is projected down to the four fields
 * the verdict needs the instant it arrives, and the response object is
 * dropped. Nothing downstream — no formatter, no `--json` dump, no future
 * debug line added by someone who did not read this comment — can reach a
 * value, because by then there is none to reach.
 */
const metadataOnly = (records) =>
  (records ?? []).map(({ key, target, type, projectId }) => ({ key, target, type, projectId }))

/** Team-shared records. Invisible to `vercel env ls`; see the header. */
async function sharedRecords(token) {
  const out = []
  let until = null
  for (let page = 0; page < 20; page += 1) {
    const suffix = until ? `&until=${encodeURIComponent(until)}` : ''
    const body = await api(token, `/v2/env?teamId=${TEAM_SCOPE}&limit=100${suffix}`)
    out.push(...metadataOnly(body?.data))
    until = body?.pagination?.next ?? null
    if (!until) return out
  }
  throw new Fatal('shared env listing did not terminate after 20 pages')
}

async function projectRecords(token, project) {
  const body = await api(token, `/v9/projects/${project.id}/env?teamId=${TEAM_SCOPE}&decrypt=false`)
  return metadataOnly(body?.envs)
}

/**
 * Which non-production environments hold this record's production value, minus
 * any that have been explicitly accepted for that key. Returns null when there
 * is nothing left to report.
 */
const spansProduction = (record) => {
  const target = new Set(record?.target ?? [])
  if (!target.has('production')) return null
  const accepted = new Set(ACCEPTED[record.key]?.environments ?? [])
  const also = NON_PRODUCTION.filter((env) => target.has(env) && !accepted.has(env))
  return also.length ? also : null
}

const isAllowed = (key) => key.startsWith('NEXT_PUBLIC_') || Object.hasOwn(ALLOW_SHARED, key)

/**
 * The reasons in ALLOW_SHARED are load-bearing, not decoration: an excuse
 * added without one is how a credential gets quietly waved through. Checked at
 * startup so it aborts rather than reporting clean.
 */
function assertEveryAllowanceHasAReason() {
  const bare = Object.entries(ALLOW_SHARED)
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 10)
    .map(([key]) => key)
  if (bare.length) {
    throw new Fatal(`ALLOW_SHARED entries with no reason written: ${bare.join(', ')}`)
  }
  const unattributed = Object.entries(ACCEPTED)
    .filter(
      ([, d]) =>
        !Array.isArray(d?.environments) ||
        !d.environments.length ||
        d.environments.some((e) => !NON_PRODUCTION.includes(e)) ||
        typeof d?.who !== 'string' ||
        d.who.trim().length < 3 ||
        typeof d?.why !== 'string' ||
        d.why.trim().length < 10,
    )
    .map(([key]) => key)
  if (unattributed.length) {
    throw new Fatal(
      `ACCEPTED entries need environments (from ${NON_PRODUCTION.join('/')}), who and why: ${unattributed.join(', ')}`,
    )
  }
}

/**
 * Negative control 1: a project whose keys are never split into
 * per-environment records cannot distinguish "shared" from "how the API talks",
 * so its verdict is not evidence.
 */
function splitKeys(records) {
  const byKey = new Map()
  for (const record of records) {
    byKey.set(record.key, (byKey.get(record.key) ?? 0) + 1)
  }
  return [...byKey.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}

/**
 * Did a config change reach the RUNNING build? Being set on the project is a
 * different fact from being in the deployment, and only the second one serves
 * traffic. `/v13/deployments/{id}` returns the env KEY list (names only), so
 * the newest production deployment can be diffed against the one before it —
 * the change shows up as an added or removed KEY, and an unchanged diff is the
 * negative control that says the redeploy did not carry the change.
 *
 * A pure VALUE swap leaves the key list identical by construction, so the
 * evidence there is the deployment ID moving: a new id means the new value was
 * baked in, the old id is still serving the old one.
 */
async function deploymentKeyDiff(token, project) {
  const list = await api(
    token,
    `/v6/deployments?app=${project.name}&teamId=${TEAM_SCOPE}&limit=10&target=production&state=READY`,
  )
  const deployments = list?.deployments ?? []
  if (deployments.length < 2) {
    return { project: project.label, error: 'fewer than two READY production deployments to compare' }
  }
  const [newest, previous] = deployments
  const keysOf = async (id) => new Set((await api(token, `/v13/deployments/${id}?teamId=${TEAM_SCOPE}`))?.env ?? [])
  const newKeys = await keysOf(newest.uid)
  const oldKeys = await keysOf(previous.uid)
  return {
    project: project.label,
    newest: { id: newest.uid, created: new Date(newest.created).toISOString(), keys: newKeys.size },
    previous: { id: previous.uid, created: new Date(previous.created).toISOString(), keys: oldKeys.size },
    added: [...newKeys].filter((k) => !oldKeys.has(k)).sort(),
    removed: [...oldKeys].filter((k) => !newKeys.has(k)).sort(),
  }
}

/**
 * The whole verdict, over records already read. Pure: no network, no clock, no
 * filesystem — so `--self-test` can drive every branch, including the ones
 * that only occur once the remediation has been done and there is nothing left
 * to find.
 *
 * @param {object} args
 * @param {Array<object>} args.shared  team-shared records
 * @param {Array<{project: {label: string, id: string, name: string}, records: Array<object>}>} args.byProject
 * @returns {{findings: Array<object>, controls: Array<object>}}
 * @throws {Fatal} when a negative control fails — never a quiet pass.
 */
function evaluateRecords({ shared, byProject }) {
  if (!shared.length) {
    throw new Fatal(
      'the team-shared scope returned zero records — that is the false negative this check exists to avoid, not a clean result',
    )
  }

  const findings = []
  const controls = []

  for (const record of shared) {
    const also = spansProduction(record)
    if (!also || isAllowed(record.key)) continue
    const linked = PROJECTS.filter((p) => (record.projectId ?? []).includes(p.id)).map((p) => p.label)
    findings.push({
      scope: 'team-shared',
      key: record.key,
      sharedWith: also,
      // A shared record linked to no project is read by nothing. It is still a
      // stored secret, but editing it changes no deployment — the trap that
      // makes a rotation look done when the live copy never moved.
      projects: linked.length ? linked : ['(linked to no project — inert)'],
      issue: KNOWN_ISSUE[record.key] ?? null,
    })
  }

  for (const { project, records } of byProject) {
    const splits = splitKeys(records)
    controls.push({ project: project.label, records: records.length, splitKeys: splits })
    if (!splits.length) {
      throw new Fatal(
        `${project.name}: no key is split into per-environment records, so "one record spans three environments" proves nothing here — the check cannot fail and must not report clean`,
      )
    }
    for (const record of records) {
      const also = spansProduction(record)
      if (!also || isAllowed(record.key)) continue
      findings.push({
        scope: project.label,
        key: record.key,
        sharedWith: also,
        projects: [project.label],
        issue: KNOWN_ISSUE[record.key] ?? null,
      })
    }
  }

  findings.sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope))
  return { findings, controls }
}

async function main() {
  assertEveryAllowanceHasAReason()

  const token = readVercelToken()
  if (!token) {
    throw new Fatal('no Vercel token — set VERCEL_TOKEN or log in with `vercel login`')
  }

  note('Reading team-shared environment variables (invisible to `vercel env ls`)…')
  const shared = await sharedRecords(token)
  note(`  ${shared.length} shared records`)

  const byProject = []
  for (const project of PROJECTS) {
    note(`Reading project-scope environment variables for ${project.name}…`)
    byProject.push({ project, records: await projectRecords(token, project) })
  }

  const { findings, controls } = evaluateRecords({ shared, byProject })
  for (const control of controls) {
    note(`  ${control.project}: ${control.records} records; negative control OK (${control.splitKeys.length} per-env split key(s))`)
  }

  let deployments = null
  if (WITH_DEPLOYMENT) {
    deployments = []
    for (const project of PROJECTS) {
      note(`Diffing production deployment env keys for ${project.name}…`)
      deployments.push(await deploymentKeyDiff(token, project))
    }
  }

  // Waived sharing is REPORTED, never silent. An accepted decision that stops
  // being visible is indistinguishable from one nobody ever made.
  const accepted = Object.entries(ACCEPTED).map(([key, d]) => ({ key, ...d }))
  const result = { ok: findings.length === 0, findings, accepted, controls, deployments }

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write('\n')
    if (!findings.length) {
      process.stdout.write('OK — no secret spans production and a non-production environment.\n')
    } else {
      process.stdout.write(
        `${findings.length} secret(s) hold the SAME value in production and a non-production environment:\n\n`,
      )
      for (const f of findings) {
        const owner = f.issue ? `  [${f.issue}]` : '  [UNTRACKED]'
        process.stdout.write(
          `  ${f.key}\n` +
            `    scope        ${f.scope}\n` +
            `    shared with  ${f.sharedWith.join(', ')}\n` +
            `    reaches      ${f.projects.join(', ')}\n` +
            `  ${owner}\n\n`,
        )
      }
      process.stdout.write(
        'Each is ONE Vercel record covering several environments, so the value is\n' +
          'identical by construction. Split the record: keep production on its own,\n' +
          'and give development/preview their own record with a different value.\n',
      )
    }
    if (accepted.length) {
      process.stdout.write('\naccepted by decision, not silenced:\n')
      for (const a of accepted) {
        process.stdout.write(`  ${a.key} in ${a.environments.join(', ')} — ${a.why} (${a.who})\n`)
      }
    }
    for (const d of deployments ?? []) {
      process.stdout.write(`\nproduction deployment env keys — ${d.project}\n`)
      if (d.error) {
        process.stdout.write(`  ${d.error}\n`)
        continue
      }
      process.stdout.write(
        `  newest    ${d.newest.id}  ${d.newest.created}  ${d.newest.keys} keys\n` +
          `  previous  ${d.previous.id}  ${d.previous.created}  ${d.previous.keys} keys\n` +
          `  added     ${d.added.join(', ') || '(none)'}\n` +
          `  removed   ${d.removed.join(', ') || '(none)'}\n`,
      )
      if (!d.added.length && !d.removed.length) {
        process.stdout.write(
          '  NOTE: identical key lists. Expected for a pure value swap — in that case\n' +
            '        the evidence is the newest deployment ID being NEWER than the change.\n' +
            '        If you ADDED or REMOVED a key and see nothing here, the redeploy did\n' +
            '        not carry it.\n',
        )
      }
    }
  }

  process.exit(findings.length ? 1 : 0)
}

/**
 * The guard, guarded. Every case here is a state the LIVE data does not
 * currently contain, so a run against Vercel exercises none of them:
 *
 *   * today every finding is red, so "goes GREEN once the split is done" is
 *     untested by the live read — and a checker that cannot go green is a
 *     checker nobody will finish the work for;
 *   * the negative controls are green today, so nothing proves they still
 *     abort;
 *   * a NEW shared credential — the drift this exists to catch on the day it
 *     returns — does not exist yet by definition.
 *
 * Pure records, no network, no token. Runs in CI on a day the token is
 * missing, deliberately: gating it behind a credential it does not use would
 * recreate the "a guard that never runs" problem it was written for.
 */
function selfTest() {
  const CONSOLE = PROJECTS[0]
  const TENANT = PROJECTS[1]
  const failures = []
  const check = (name, condition) => {
    process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${name}\n`)
    if (!condition) failures.push(name)
  }
  const record = (key, target, extra = {}) => ({ key, target, type: 'encrypted', ...extra })
  // A project whose keys are never split would abort control 1, so every
  // fixture project carries one genuine per-environment split.
  const split = [record('SPLIT_ME', ['development']), record('SPLIT_ME', ['production'])]
  const evaluate = (shared, consoleRecords = [], tenantRecords = []) =>
    evaluateRecords({
      shared,
      byProject: [
        { project: CONSOLE, records: [...split, ...consoleRecords] },
        { project: TENANT, records: [...split, ...tenantRecords] },
      ],
    })
  const throws = (fn) => {
    try {
      fn()
      return false
    } catch (error) {
      return error instanceof Fatal
    }
  }

  // 1. THE GREEN. Production on its own record, dev/preview on another — the
  //    shape the runbook asks for. If this cannot pass, the work can never be
  //    reported done.
  const green = evaluate([record('CRON_SECRET', ['production']), record('CRON_SECRET', ['development', 'preview'])])
  check('a split credential is CLEAN', green.findings.length === 0)

  // 2. THE RED it exists for: one record spanning production and development.
  const red = evaluate([record('CRON_SECRET', ['development', 'preview', 'production'])])
  check('a spanning credential is a FINDING', red.findings.length === 1)
  check('the finding names both non-production environments', red.findings[0]?.sharedWith.join() === 'development,preview')

  // 3. preview-only is still a finding — narrower, not acceptable.
  check('preview-only sharing still fails', evaluate([record('X_SECRET', ['preview', 'production'])]).findings.length === 1)

  // 4. Non-production-only records are NOT findings. A throwaway dev value is
  //    the remedy, so flagging it would punish the fix.
  check('a development-only record is clean', evaluate([record('X_SECRET', ['development', 'preview'])]).findings.length === 0)

  // 5. A NEW credential is reported UNTRACKED, not silently folded into the
  //    nearest issue. This is the drift-returns case.
  const untracked = evaluate([record('BRAND_NEW_API_KEY', ['development', 'production'])])
  check('an unknown key reports issue: null (UNTRACKED)', untracked.findings[0]?.issue === null)
  check('a known key carries its issue id', red.findings[0]?.issue === 'AGL-2403')

  // 6. ALLOW_SHARED and the NEXT_PUBLIC_ class are honoured…
  check('an allowed key is not a finding', evaluate([record('FIREBASE_TOKEN_URI', ['development', 'production'])]).findings.length === 0)
  check('NEXT_PUBLIC_* is not a finding', evaluate([record('NEXT_PUBLIC_ANYTHING', ['development', 'production'])]).findings.length === 0)
  // …and the credential half of the same service account is NOT allowed. The
  // AGL-2403 audit missed FIREBASE_PRIVATE_KEY; this pins that it cannot be
  // waved through by the siblings around it.
  check(
    'FIREBASE_PRIVATE_KEY is NOT excused by its siblings',
    evaluate([record('FIREBASE_TOKEN_URI', ['production'])], [record('FIREBASE_PRIVATE_KEY', ['development', 'production'])])
      .findings.length === 1,
  )

  // 7. A shared record linked to no project is still reported, and says so.
  //    Rotating one of these changes no deployment — RESEND_API_KEY is in
  //    exactly this state today.
  const inert = evaluate([record('RESEND_API_KEY', ['development', 'production'], { projectId: [] })])
  check('an unlinked shared record is still a finding', inert.findings.length === 1)
  check('…and is labelled inert', /inert/.test(inert.findings[0]?.projects.join() ?? ''))
  check(
    'a linked shared record names its projects',
    evaluate([record('CRON_SECRET', ['development', 'production'], { projectId: [CONSOLE.id, TENANT.id] })]).findings[0]
      ?.projects.join() === 'console,tenant',
  )

  // 8. Both negative controls abort rather than reporting clean.
  check('an empty shared scope aborts', throws(() => evaluate([])))
  check(
    'a project with no per-environment split aborts',
    throws(() =>
      evaluateRecords({
        shared: [record('ANY', ['production'])],
        byProject: [{ project: CONSOLE, records: [record('ONLY_ONE', ['development', 'preview', 'production'])] }],
      }),
    ),
  )

  // 9. The policy tables must be self-consistent — an excuse with no reason
  //    written, or an acceptance with no name on it, aborts at startup.
  check('every ALLOW_SHARED entry has a reason', !throws(() => assertEveryAllowanceHasAReason()))

  // 10. The plaintext the API volunteers is dropped on arrival. `decrypt=false`
  //     does not suppress it, so this projection is the ONLY thing standing
  //     between a live response and a value reaching a formatter or a log.
  const projected = metadataOnly([
    { key: 'K', target: ['production'], type: 'encrypted', projectId: ['p'], value: 'PLAINTEXT', decrypted: true, id: 'env_1' },
  ])
  check('metadataOnly drops the value field', !Object.hasOwn(projected[0], 'value'))
  check(
    'metadataOnly keeps only the four verdict fields',
    Object.keys(projected[0]).sort().join() === 'key,projectId,target,type',
  )
  check(
    'no serialization of a projected record can contain the plaintext',
    !JSON.stringify(projected).includes('PLAINTEXT'),
  )

  process.stdout.write(`\n${failures.length ? `${failures.length} FAILED` : 'all self-test cases pass'}\n`)
  process.exit(failures.length ? 1 : 0)
}

if (SELF_TEST) {
  try {
    selfTest()
  } catch (error) {
    process.stderr.write(`verify-env-isolation --self-test: ${error?.stack ?? error}\n`)
    process.exit(2)
  }
}

main().catch((error) => {
  if (error instanceof Fatal) {
    process.stderr.write(`verify-env-isolation: ${error.message}\n`)
    process.exit(2)
  }
  process.stderr.write(`verify-env-isolation: unexpected failure: ${error?.stack ?? error}\n`)
  process.exit(2)
})
