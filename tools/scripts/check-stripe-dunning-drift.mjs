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

// Watches for drift between Stripe's dunning behaviour and what this repo
// believes it to be (AGL-2430).
//
//   npm run check:stripe-dunning-drift
//   npm run check:stripe-dunning-drift -- --require-observed
//   npm run check:stripe-dunning-drift -- --schedule-file=<path>
//
// ## WHY THIS IS SHAPED SO ODDLY
//
// The obvious checker — read the setting, compare it to the constant — is
// impossible, and that impossibility is the whole reason this file exists.
// Stripe's retry schedule, the Smart Retries flag and the
// after-the-final-retry behaviour live ONLY in the Dashboard, held
// independently per mode, with no API surface whatsoever. Probed read-only
// on 2026-08-20 (live) and again on 2026-08-24 (test): `/v1/billing/settings`,
// `/v1/subscription_settings`, `/v1/billing/dunning`,
// `/v1/billing/retry_settings`, `/v1/account/settings` and
// `/v1/billing/configurations` all answer 404 "Unrecognized request URL",
// and `GET /v1/account` carries no field matching `dunning|retry|smart_retr`.
//
// So `LIVE_MODE_DUNNING_SCHEDULE` is a transcription of a human reading a
// screen on one particular day, and if somebody edits that screen tomorrow
// nothing anywhere goes red. That is the standing failure shape this repo
// keeps re-learning: CONFIGURATION THAT LIVES ONLY IN A VENDOR CONSOLE, THAT
// NOTHING VERIFIES.
//
// What this checker does instead of reading the setting:
//
//   1. RE-PROBES whether the setting has become readable. If Stripe ships an
//      endpoint, the recorded "unreadable" premise is stale and the whole
//      design above should be replaced by the obvious checker. That is drift
//      in a recorded fact, so it exits 1, not 2.
//   2. WATCHES THE ACCOUNT'S BEHAVIOUR for anything the record forbids — a
//      sixth attempt when five are recorded, an `unpaid` subscription when
//      the terminal state is recorded as `canceled`, a retry scheduled past
//      the recorded window. Behaviour is downstream of the setting, so a
//      changed setting eventually shows up here even though the setting
//      itself cannot be read.
//   3. CHECKS THE RECORD AGAINST THE CODE that depends on it, which is the
//      one part that needs no credential at all.
//
// ## THE ZERO-OBSERVATION TRAP, HANDLED EXPLICITLY
//
// Step 2 is vacuous until a real renewal fails. An account that has never
// dunned anybody contradicts nothing, and reporting that as "in sync" would
// be exactly the measured zero this repo has been burned by before — a
// checker that has only ever seen an empty list is indistinguishable from a
// checker that is working. So the report always separates CHECKED claims
// from UNVERIFIED ones and prints the observation count it worked from, and
// `--require-observed` turns "nothing to look at" into exit 2. The launch-day
// runbook should use that flag once live subscriptions exist; before then a
// bare run is honest as long as its report is read.
//
// ## MODE
//
// Everything here is per-mode, so the report NAMES the mode it read and
// compares against that mode's recorded schedule. A green run against a
// `sk_test_` key says nothing whatsoever about live, and the report says so
// in those words rather than leaving it to be inferred.
//
// ## SAFETY
//
// GET only. Every request goes through the single `get()` helper below and
// there is no other call to `fetch` in this file, so read-only is a property
// of the code rather than a promise in a comment. It is therefore safe to
// point at a live key — which is the point, since live is the mode that
// matters.
//
// Auth: STRIPE_DUNNING_CHECK_KEY wins; otherwise the first Stripe secret
// found in the env files listed in KEY_SOURCES. The key's VALUE is never
// printed, logged, or included in any report — only its mode.
//
// ## EXIT CODES
//
//   0 = every claim that could be evaluated held
//   1 = an observation or a probe CONTRADICTS the recorded schedule
//   2 = the check could not be performed (no key, unreadable key, API
//       failure, no schedule recorded for this mode, or the recorded
//       constants could not be parsed out of the source)

import { readFileSync } from 'node:fs'

const SCHEDULE_FILE = 'apps/console/utils/stripe-dunning-schedule.ts'
const AUTO_LOCK_FILE = 'apps/console/utils/billing-auto-lock.ts'

/** Env files that may carry a Stripe secret, most specific first. */
const KEY_SOURCES = [
  ['apps/console/.env.production.local', 'STRIPE_SECRET_KEY_TEST'],
  ['apps/console/.env.local', 'STRIPE_SECRET_KEY'],
  ['.env', 'STRIPE_SECRET_KEY'],
]

/**
 * Slack allowed between a recorded window and an observed one, in days.
 *
 * Smart Retries does not run on a fixed cron — Stripe picks the moments,
 * varying them by card and by time of day, and the test-clock drill landed
 * on 21.08 days against a Dashboard that says "3 weeks". Two days absorbs
 * that without absorbing a real schedule change: the settings Stripe offers
 * are a week apart, so a genuine edit moves the number far further than
 * this.
 */
const WINDOW_SLACK_DAYS = 2

/**
 * The endpoints that WOULD expose dunning configuration if it were exposed.
 * All six 404 today; any of them answering is the good news that makes this
 * whole file obsolete, and must be noticed rather than ignored.
 */
const CONFIG_ENDPOINTS = [
  '/v1/billing/settings',
  '/v1/subscription_settings',
  '/v1/billing/dunning',
  '/v1/billing/retry_settings',
  '/v1/account/settings',
  '/v1/billing/configurations',
]

const args = process.argv.slice(2)
const requireObserved = args.includes('--require-observed')
const scheduleFile =
  args.find((a) => a.startsWith('--schedule-file='))?.split('=')[1] ??
  SCHEDULE_FILE

function inconclusive(message) {
  console.error(`\nCOULD NOT CHECK (exit 2)\n\n${message}\n`)
  process.exit(2)
}

function readEnvValue(file, name) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const match = text.match(new RegExp(`^${name}=(.+)$`, 'm'))
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
}

/** Resolves the key and its mode. Never returns or logs the value alone. */
function resolveKey() {
  let key = process.env.STRIPE_DUNNING_CHECK_KEY?.trim()
  let source = 'STRIPE_DUNNING_CHECK_KEY'
  if (!key) {
    for (const [file, name] of KEY_SOURCES) {
      const found = readEnvValue(file, name)
      if (found) {
        key = found
        source = `${name} in ${file}`
        break
      }
    }
  }
  if (!key) {
    inconclusive(
      'No Stripe secret key. Set STRIPE_DUNNING_CHECK_KEY, or run from a\n' +
        'checkout root whose env files carry one:\n  ' +
        KEY_SOURCES.map(([f, n]) => `${n} in ${f}`).join('\n  ') +
        '\n\nExiting 2 rather than 0: with no key this check reads nothing,\n' +
        'and a green run that read nothing is precisely the silence it\n' +
        'exists to break.',
    )
  }
  const mode = key.startsWith('sk_test_') || key.startsWith('rk_test_')
    ? 'test'
    : key.startsWith('sk_live_') || key.startsWith('rk_live_')
      ? 'live'
      : null
  if (!mode) {
    inconclusive(
      `The key from ${source} has no recognised Stripe prefix, so its MODE\n` +
        'cannot be established. Everything this check compares is per-mode,\n' +
        'so a comparison against an unknown mode would be meaningless.\n\n' +
        'Note this is also the guard against the comment that lies: this\n' +
        "account has an env file labelled '# Stripe (TEST MODE)' above a\n" +
        'LIVE key. Mode is taken from the prefix, never from a label.',
    )
  }
  return { key, mode, source }
}

/** The only network call in this file, and it is a GET. */
async function get(key, path) {
  let response
  try {
    response = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch (error) {
    inconclusive(`Could not reach the Stripe API (${path}): ${error.message}`)
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    /* a non-JSON body is handled by the status check at each call site */
  }
  return { status: response.status, body }
}

/** Pulls one `key: value` out of a named exported object literal. */
function readField(source, exportName, field) {
  const block = source.match(
    new RegExp(`export const ${exportName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'),
  )
  if (!block) return undefined
  const line = block[1].match(
    new RegExp(`^\\s*${field}:\\s*(.+?),?\\s*$`, 'm'),
  )
  if (!line) return undefined
  return line[1].replace(/\s+as const$/, '').replace(/^'|'$/g, '')
}

function readRecordedSchedule(mode) {
  let source
  try {
    source = readFileSync(scheduleFile, 'utf8')
  } catch (error) {
    inconclusive(`Could not read ${scheduleFile}: ${error.message}`)
  }
  const name =
    mode === 'live' ? 'LIVE_MODE_DUNNING_SCHEDULE' : 'TEST_MODE_DUNNING_SCHEDULE'

  if (new RegExp(`export const ${name}[^=]*=\\s*null`).test(source)) {
    inconclusive(
      `${name} is null in ${scheduleFile} — no ${mode}-mode schedule has\n` +
        'been recorded, so there is nothing for observed behaviour to be\n' +
        'compared against. Exiting 2: "no expectation" is not "no drift".',
    )
  }

  const schedule = {
    mode: readField(source, name, 'mode'),
    attempts: Number(readField(source, name, 'attempts')),
    cancelsAfterDays: Number(readField(source, name, 'cancelsAfterDays')),
    terminalStatus: readField(source, name, 'terminalStatus'),
    measuredOn: readField(source, name, 'measuredOn'),
  }

  const missing = Object.entries(schedule)
    .filter(([, v]) => v === undefined || (typeof v === 'number' && !isFinite(v)))
    .map(([k]) => k)
  if (missing.length) {
    inconclusive(
      `Could not parse ${missing.join(', ')} out of ${name} in\n` +
        `${scheduleFile}. The constant was renamed, reshaped or moved.\n\n` +
        'Exiting 2 rather than skipping the fields: a checker that quietly\n' +
        'drops the expectation it cannot find still prints a reassuring 0.',
    )
  }
  if (schedule.mode !== mode) {
    inconclusive(
      `${name}.mode is '${schedule.mode}' but this run holds a ${mode}-mode\n` +
        'key. Refusing to compare a schedule against the wrong mode — that\n' +
        'is the exact confusion AGL-2430 was opened about.',
    )
  }
  return schedule
}

function readGraceDays() {
  let source
  try {
    source = readFileSync(AUTO_LOCK_FILE, 'utf8')
  } catch (error) {
    inconclusive(`Could not read ${AUTO_LOCK_FILE}: ${error.message}`)
  }
  const match = source.match(/export const BILLING_LOCK_GRACE_DAYS\s*=\s*(\d+)/)
  if (!match) {
    inconclusive(
      `Could not parse BILLING_LOCK_GRACE_DAYS out of ${AUTO_LOCK_FILE}.`,
    )
  }
  return Number(match[1])
}

/** Follows `has_more` so a long account cannot hide its dunning behind page 1. */
async function listAll(key, path, cap = 5) {
  const items = []
  let starting = null
  for (let page = 0; page < cap; page++) {
    const url = `${path}${path.includes('?') ? '&' : '?'}limit=100${
      starting ? `&starting_after=${starting}` : ''
    }`
    const { status, body } = await get(key, url)
    if (status !== 200) {
      inconclusive(
        `Stripe answered ${status} for ${path}: ` +
          `${body?.error?.message ?? 'no message'}\n\n` +
          'Exiting 2: an unread list is not an empty one.',
      )
    }
    items.push(...(body.data ?? []))
    if (!body.has_more || !items.length) break
    starting = items[items.length - 1].id
  }
  return items
}

const DAY = 86400

async function main() {
  const { key, mode, source } = resolveKey()
  const recorded = readRecordedSchedule(mode)
  const graceDays = readGraceDays()

  const checked = []
  const unverified = []
  const differences = []

  // ── Claim 1: the setting is still unreadable through the API ────────────
  const answering = []
  for (const path of CONFIG_ENDPOINTS) {
    const { status } = await get(key, path)
    if (status !== 404) answering.push(`${path} → ${status}`)
  }
  const account = await get(key, '/v1/account')
  if (account.status !== 200) {
    inconclusive(
      `Stripe answered ${account.status} for /v1/account — the key from ` +
        `${source} could not read the account.\n\n` +
        'Exiting 2: nothing below was measured.',
    )
  }
  const accountHits = (
    JSON.stringify(account.body).match(/dunning|smart_retr/gi) ?? []
  ).length
  if (answering.length || accountHits) {
    differences.push(
      'The recorded premise "no API exposes the dunning schedule" is now ' +
        'FALSE:\n    ' +
        [
          ...answering,
          ...(accountHits
            ? [`/v1/account carries ${accountHits} dunning/retry field(s)`]
            : []),
        ].join('\n    ') +
        '\n  Read the setting through the API and replace this checker with ' +
        'a real one.',
    )
  } else {
    checked.push(
      `no API surface exposes the schedule (${CONFIG_ENDPOINTS.length} ` +
        'endpoints 404, /v1/account clean) — so the recorded value still ' +
        'rests on a human Dashboard read',
    )
  }

  // ── Claim 2: the record is coherent with the code that depends on it ────
  if (recorded.cancelsAfterDays >= graceDays) {
    differences.push(
      `BILLING_LOCK_GRACE_DAYS is ${graceDays} but Stripe is recorded as ` +
        `reaching its terminal state at ${recorded.cancelsAfterDays} days.\n` +
        '  The auto-lock would fire while Stripe is still retrying — locking ' +
        'a customer out\n  mid-recovery, before the card has run out of ' +
        'chances.',
    )
  } else {
    checked.push(
      `BILLING_LOCK_GRACE_DAYS (${graceDays}) sits ` +
        `${(graceDays - recorded.cancelsAfterDays).toFixed(2)} days past the ` +
        `recorded terminal state (${recorded.cancelsAfterDays}d)`,
    )
  }

  // ── Claim 3: observed behaviour contradicts nothing in the record ───────
  const subscriptions = await listAll(key, '/v1/subscriptions?status=all')
  const invoices = await listAll(key, '/v1/invoices')

  const dunned = subscriptions.filter(
    (s) => s.cancellation_details?.reason === 'payment_failed',
  )
  const retried = invoices.filter((i) => (i.attempt_count ?? 0) > 1)
  const observations = dunned.length + retried.length

  if (recorded.terminalStatus === 'canceled') {
    const unpaid = subscriptions.filter((s) => s.status === 'unpaid')
    if (unpaid.length) {
      differences.push(
        `${unpaid.length} subscription(s) are in status 'unpaid', but the ` +
          `${mode} terminal state is recorded as 'canceled'.\n  The ` +
          '"after the final retry" Dashboard setting has been changed to ' +
          '*mark unpaid*.\n  That inverts which auto-lock branch is ' +
          'reachable — see billing-auto-lock.ts.',
      )
    }
  }

  for (const invoice of invoices) {
    if ((invoice.attempt_count ?? 0) > recorded.attempts) {
      differences.push(
        `An invoice reached attempt ${invoice.attempt_count}, but only ` +
          `${recorded.attempts} attempts are recorded for ${mode} mode.\n` +
          '  Stripe is retrying more times than the record says.',
      )
    }
    if (invoice.next_payment_attempt && invoice.period_end) {
      const days = (invoice.next_payment_attempt - invoice.period_end) / DAY
      if (days > recorded.cancelsAfterDays + WINDOW_SLACK_DAYS) {
        differences.push(
          `An open invoice has a retry scheduled ${days.toFixed(2)} days ` +
            `after its period end, past the recorded ${recorded.cancelsAfterDays}-day ` +
            'window.\n  The retry schedule has been lengthened.',
        )
      }
    }
  }

  for (const sub of dunned) {
    if (!sub.canceled_at || !sub.current_period_end) continue
    const days = (sub.canceled_at - sub.current_period_end) / DAY
    if (days > recorded.cancelsAfterDays + WINDOW_SLACK_DAYS) {
      differences.push(
        `A dunning cancellation took ${days.toFixed(2)} days from the period ` +
          `end, past the recorded ${recorded.cancelsAfterDays}-day window.`,
      )
    }
  }

  if (observations === 0) {
    unverified.push(
      'the retry COUNT, the WINDOW and the TERMINAL STATE. Nothing in this ' +
        'account has\n    ever dunned: 0 subscriptions cancelled for ' +
        `payment_failed and 0 invoices past\n    attempt 1, across ` +
        `${subscriptions.length} subscription(s) and ${invoices.length} ` +
        'invoice(s) read.\n    Nothing contradicted the record because there ' +
        'was nothing to contradict it WITH.',
    )
  } else {
    checked.push(
      `${observations} dunning observation(s) — ${dunned.length} ` +
        `payment_failed cancellation(s), ${retried.length} retried ` +
        'invoice(s) — contradict nothing in the record',
    )
  }

  // ── Report ─────────────────────────────────────────────────────────────
  console.log(`Stripe dunning drift — ${mode.toUpperCase()} mode`)
  console.log(`  key source:      ${source} (mode from prefix, not a label)`)
  console.log(
    `  recorded:        ${recorded.attempts} attempts / ` +
      `${recorded.cancelsAfterDays}d → ${recorded.terminalStatus} ` +
      `(recorded ${recorded.measuredOn})`,
  )
  console.log(
    `  read:            ${subscriptions.length} subscription(s), ` +
      `${invoices.length} invoice(s)`,
  )

  console.log('\nCHECKED')
  for (const line of checked) console.log(`  ✓ ${line}`)

  if (unverified.length) {
    console.log('\nNOT VERIFIED — no evidence existed either way')
    for (const line of unverified) console.log(`  ? ${line}`)
  }

  if (mode === 'test') {
    console.log(
      '\n⚠ This run read TEST mode. The schedule is held independently per\n' +
        '  mode, so none of the above is a statement about the live account\n' +
        '  your paying customers are on. Re-run with a live key for that.',
    )
  }

  if (differences.length) {
    console.error('\nDIFFERS (exit 1)\n')
    for (const line of differences) console.error(`  ✗ ${line}\n`)
    console.error(
      `Reconcile ${scheduleFile} against the live Dashboard at\n` +
        'Settings → Billing → Subscriptions and emails, then update the ' +
        'constants.\n',
    )
    process.exit(1)
  }

  if (requireObserved && observations === 0) {
    inconclusive(
      '--require-observed was passed and this account has never dunned ' +
        'anybody.\n\nThe behavioural half of this check is vacuous, so it is ' +
        'reported as unperformed\nrather than as a pass. Use the bare command ' +
        'before the first live renewal fails.',
    )
  }

  console.log(
    `\nIN SYNC (exit 0) — ${checked.length} claim(s) checked` +
      (unverified.length ? `, ${unverified.length} left unverified` : ''),
  )
  process.exit(0)
}

main().catch((error) => {
  inconclusive(`Unexpected failure: ${error?.stack ?? error}`)
})
