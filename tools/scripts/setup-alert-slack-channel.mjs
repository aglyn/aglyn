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
 * GIVE THE OUTAGE ALERTS A SECOND ROUTE OFF THE MAILBOX (AGL-2757)
 *
 * All 21 alert policies in `aglyn-main` deliver to exactly one place: email to
 * `zach@aglyn.com`, channel `7043898327231541746`. A bounce, a forwarding
 * rule, or one over-broad Gmail filter takes every monitor silent while each
 * policy keeps reading ENABLED, with a channel attached, and healthy. That is
 * the same shape as AGL-2734 — a monitor that looks armed and reaches nobody —
 * moved one hop downstream, past everything the Monitoring API can report.
 *
 *   node tools/scripts/setup-alert-slack-channel.mjs --dry-run
 *   node tools/scripts/setup-alert-slack-channel.mjs
 *
 * ## ⛔ This script does NOT create the Slack channel, deliberately
 *
 * The `slack` channel type takes an `auth_token` label — in Slack's own words a
 * permanent token, and the Monitoring API obfuscates it on read. Minting one
 * means installing the Google Cloud Monitoring app into the workspace, which is
 * an OAuth consent flow; the Cloud Console does it end to end and hands the
 * token straight to Monitoring, so it never lands in a shell history, a
 * transcript, or this file.
 *
 * So the channel is created ONCE by a human:
 *
 *   Console -> Monitoring -> Alerting -> Edit notification channels
 *     -> Slack -> Add new -> authorize -> pick the channel
 *
 * and this script does the part that is mechanical and easy to get wrong:
 * attaching it to the right policies without dropping the email one.
 *
 * `team` is output-only — Monitoring fills it in from the token — so there is
 * nothing to configure but the Slack channel name.
 *
 * ## Why a subset rather than all 21
 *
 * A second route is worth having where a page means the platform is broken for
 * real people. The other thirteen are diagnostics and CI-condition checks, and
 * AGL-2723 is the standing lesson that paging for a CI condition is how a
 * channel becomes one people mute. Muting the second route would defeat the
 * point of adding it.
 *
 * ## ⚠️ `updateMask=notificationChannels` REPLACES the list
 *
 * It does not merge, so every PATCH here reads the policy first and sends the
 * existing channels plus the new one. AGL-2734 hit the neighboring trap from
 * the other side: `updateMask=alertStrategy.autoClose` is refused as
 * "read-only, not supported, or unrecognized" because the mask is too narrow,
 * which reads like the field is immutable. Send the whole field, having merged
 * it yourself.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT = process.env.GCP_PROJECT ?? 'aglyn-main'
const DRY_RUN = process.argv.includes('--dry-run')
const API = 'https://monitoring.googleapis.com/v3'

/**
 * The policies that mean a real outage, by exact display name.
 *
 * Exact rather than a prefix or a regex: `Uptime failure:` alone would sweep
 * in `backup-state`, `journeys`, `scheduled-jobs` and `signup-volume`, which
 * are the CI-condition checks this deliberately leaves on one route.
 */
const OUTAGE_POLICIES = [
  'Uptime failure: marketing-home (aglyn.com)',
  'Uptime failure: customer-site (demo.aglyn.app)',
  'Uptime failure: console-health (app.aglyn.com/api/health)',
  'Uptime failure: tenant-health (aglyn.com/api/health)',
  'Uptime failure: auth-doors (app.aglyn.com/api/health/auth-doors)',
  'Server errors: uncaught 5xx (AGL-1921)',
  'Server errors: Vercel runtime 5xx via log drain (AGL-1921)',
  'Billing webhook is not delivering (AGL-1924)',
]

/**
 * An access token for the Monitoring API.
 *
 * `gcloud` periodically fails with "Reauthentication failed. cannot prompt
 * during non-interactive execution", which kills `print-access-token` and
 * every gcloud read with it. The ADC file is an `authorized_user` holding a
 * long-lived refresh token, and Google's token endpoint does not care that the
 * CLI is wedged — so fall back to redeeming it directly rather than failing.
 *
 * ⛔ The Firebase service account is NOT interchangeable here: it is refused by
 * Monitoring outright. This has to be the user credential.
 */
async function accessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    const path = join(
      homedir(),
      '.config/gcloud/application_default_credentials.json',
    )
    const creds = JSON.parse(readFileSync(path, 'utf8'))
    const body = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body,
    })
    if (!res.ok) {
      throw new Error(
        `gcloud could not mint a token and refreshing ADC returned ${res.status}. ` +
          'Run `gcloud auth application-default login` and try again.',
      )
    }
    return (await res.json()).access_token
  }
}

async function api(token, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function main() {
  const token = await accessToken()

  const channels = (
    await api(token, `projects/${PROJECT}/notificationChannels`)
  ).notificationChannels ?? []

  const slack = channels.filter((channel) => channel.type === 'slack')
  if (slack.length === 0) {
    // An absent channel and a broken one look identical from here, so say
    // which this is rather than reporting "nothing to do" (AGL-2734).
    console.error(
      'No Slack notification channel exists in this project yet.\n\n' +
        'Create it once in the Cloud Console — the OAuth flow is the only way to\n' +
        'mint the auth_token, and doing it there keeps the token out of every\n' +
        'shell history and transcript:\n\n' +
        '  Monitoring -> Alerting -> Edit notification channels -> Slack -> Add new\n\n' +
        'Then re-run this script.',
    )
    process.exitCode = 1
    return
  }
  if (slack.length > 1) {
    console.error(
      `Found ${slack.length} Slack channels; refusing to guess which one is the\n` +
        'alerting route. Delete the unused ones, or set the intended one aside:\n' +
        slack.map((c) => `  ${c.name}  ${c.displayName}`).join('\n'),
    )
    process.exitCode = 1
    return
  }

  const target = slack[0]
  console.log(`Slack channel: ${target.displayName} (${target.name.split('/').pop()})`)
  console.log(`  channel_name: ${target.labels?.channel_name ?? '(unset)'}`)
  console.log(`  team:         ${target.labels?.team ?? '(unset)'}`)
  if (target.enabled === false) {
    console.error('\n⛔ That channel is DISABLED — it would accept the wiring and deliver nothing.')
    process.exitCode = 1
    return
  }

  const policies =
    (await api(token, `projects/${PROJECT}/alertPolicies?pageSize=100`))
      .alertPolicies ?? []
  const byName = new Map(policies.map((p) => [p.displayName, p]))

  const missing = OUTAGE_POLICIES.filter((name) => !byName.has(name))
  if (missing.length > 0) {
    // A renamed policy would otherwise be skipped in silence, leaving exactly
    // the gap this script exists to close.
    console.error(
      `\n⛔ ${missing.length} policy name(s) in OUTAGE_POLICIES match nothing:\n` +
        missing.map((name) => `  ${name}`).join('\n') +
        '\n\nA policy was renamed or deleted. Fix the list rather than ignoring this.',
    )
    process.exitCode = 1
    return
  }

  let changed = 0
  for (const name of OUTAGE_POLICIES) {
    const policy = byName.get(name)
    const current = policy.notificationChannels ?? []
    if (current.includes(target.name)) {
      console.log(`  = ${name}`)
      continue
    }
    changed += 1
    if (DRY_RUN) {
      console.log(`  + ${name}  (dry run)`)
      continue
    }
    // Read-modify-write: the mask replaces the whole list.
    await api(
      token,
      `${policy.name}?updateMask=notificationChannels`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          notificationChannels: [...current, target.name],
        }),
      },
    )
    console.log(`  + ${name}`)
  }

  if (changed === 0) {
    console.log('\nEvery outage policy already carries the Slack route.')
    return
  }
  if (DRY_RUN) {
    console.log(`\n${changed} policy(ies) would gain the Slack route.`)
    return
  }

  // Read back rather than trusting the PATCH responses: the point of the whole
  // exercise is a route that is actually attached.
  const after =
    (await api(token, `projects/${PROJECT}/alertPolicies?pageSize=100`))
      .alertPolicies ?? []
  const wired = after.filter(
    (p) =>
      OUTAGE_POLICIES.includes(p.displayName) &&
      (p.notificationChannels ?? []).includes(target.name),
  )
  console.log(
    `\nVerified: ${wired.length}/${OUTAGE_POLICIES.length} outage policies now route to Slack as well as email.`,
  )
  if (wired.length !== OUTAGE_POLICIES.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exitCode = 1
})
