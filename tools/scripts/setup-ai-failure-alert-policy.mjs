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
 * PAGE EMAIL AND SLACK WHEN AGLYN AI FAILS (AGL-3683)
 *
 * The console raises `ai.jobFailed` and `ai.buildPartlyFailed` (and the
 * older `ai.providerUnavailable`) as operator alerts, and every operator alert
 * that fires is written to the `operator-alerts` log in this project
 * (`writeOperatorAlertLog`). This creates the Cloud Monitoring policy that
 * pages on the AI ones, routed exactly as the outage policies are: it copies
 * the notification channels of `Server errors: uncaught 5xx (AGL-1921)`,
 * which `setup-alert-slack-channel.mjs` gave email AND Slack. When that
 * routing changes, rerun this and the AI policy follows it.
 *
 * Idempotent: a policy with the same display name is updated in place, never
 * duplicated.
 *
 *   node tools/scripts/setup-ai-failure-alert-policy.mjs --dry-run
 *   node tools/scripts/setup-ai-failure-alert-policy.mjs
 *
 * A log-match condition, as the sibling server-error policies use: an alert
 * is already deduped per job kind per hour before it is written, so the log
 * holds a handful of entries on a bad day and needs no rate threshold.
 * Production only — a developer serving the console against platform
 * credentials writes to the same log.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT = process.env.GCP_PROJECT ?? 'aglyn-main'
const DRY_RUN = process.argv.includes('--dry-run')
const API = 'https://monitoring.googleapis.com/v3'

const DISPLAY_NAME = 'Aglyn AI failing (AGL-3683)'
const ROUTING_FROM = 'Server errors: uncaught 5xx (AGL-1921)'
const FILTER = [
  `logName="projects/${PROJECT}/logs/operator-alerts"`,
  'jsonPayload.type=~"^ai\\."',
  'jsonPayload.environment="production"',
].join(' AND ')

async function accessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    const path = join(homedir(), '.config/gcloud/application_default_credentials.json')
    const creds = JSON.parse(readFileSync(path, 'utf8'))
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) {
      throw new Error(
        `gcloud could not mint a token and refreshing ADC returned ${res.status}. ` +
          'Run `gcloud auth login` (or `gcloud auth application-default login`) and try again.',
      )
    }
    return (await res.json()).access_token
  }
}

async function api(token, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function listPolicies(token) {
  const policies = []
  let pageToken = ''
  do {
    const page = await api(
      token,
      `projects/${PROJECT}/alertPolicies?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
    )
    policies.push(...(page.alertPolicies ?? []))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return policies
}

function policyBody(notificationChannels) {
  return {
    displayName: DISPLAY_NAME,
    combiner: 'OR',
    enabled: true,
    severity: 'ERROR',
    documentation: {
      mimeType: 'text/markdown',
      subject: 'Aglyn AI: ${log.extracted_label.title}',
      content: [
        'An AI operator alert fired: **${log.extracted_label.type}**.',
        '',
        'The full alert (body, workspace, link) is in the Staff console bell and the operator-alert email.',
        'Logs: `logName="projects/' + PROJECT + '/logs/operator-alerts"`.',
        'Runbook: docs/UPTIME_AND_SLA.md → "Aglyn AI failing".',
      ].join('\n'),
    },
    conditions: [
      {
        displayName: 'An AI operator alert was written',
        conditionMatchedLog: {
          filter: FILTER,
          labelExtractors: {
            type: 'EXTRACT(jsonPayload.type)',
            title: 'EXTRACT(jsonPayload.title)',
          },
        },
      },
    ],
    alertStrategy: {
      notificationRateLimit: { period: '300s' },
      autoClose: '1800s',
    },
    notificationChannels,
  }
}

async function main() {
  const token = await accessToken()
  const policies = await listPolicies(token)
  const routing = policies.find((policy) => policy.displayName === ROUTING_FROM)
  if (!routing?.notificationChannels?.length) {
    throw new Error(`"${ROUTING_FROM}" was not found or has no channels, so there is no routing to copy.`)
  }
  const body = policyBody(routing.notificationChannels)
  const existing = policies.find((policy) => policy.displayName === DISPLAY_NAME)

  console.log(`${existing ? 'Update' : 'Create'} "${DISPLAY_NAME}"`)
  console.log(`  filter:   ${FILTER}`)
  console.log(`  channels: ${body.notificationChannels.join(', ')}`)
  if (DRY_RUN) {
    console.log('\n--dry-run: nothing written.')
    return
  }
  const written = existing
    ? await api(token, `${existing.name}?updateMask=${Object.keys(body).join(',')}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    : await api(token, `projects/${PROJECT}/alertPolicies`, { method: 'POST', body: JSON.stringify(body) })
  console.log(`\n${written.name}`)
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exitCode = 1
})
