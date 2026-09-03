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
// Posts Main Gate's RED verdict into Linear (AGL-2533). The body, the marker
// and the should-we-report decision live in `lib/main-gate-red-report.mjs`;
// this file is the network half.
//
//   node tools/scripts/report-main-gate-red.mjs --fast=success --full=failure \
//     --sha=<sha> --run-url=<url> --subject='...'
//
// ALWAYS EXITS 0. A gate that went red because it could not report would be
// strictly worse than the silence this replaces, so every failure here is
// announced on stderr and swallowed.
import {
  SINK_ISSUE_ID,
  failedJobs,
  redCommentBody,
  redMarker,
  shouldReport,
} from './lib/main-gate-red-report.mjs'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
// Matching `check-external-facts.mjs`, the proven caller of this API in this
// repo. Without it a hung request stalls the report job for the whole job
// timeout, which is a worse outcome than a missed notification.
const TIMEOUT_MS = 15_000

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const results = { fast: flag('fast'), full: flag('full') }
const sha = flag('sha')
const runUrl = flag('run-url')
const subject = flag('subject')

const say = (msg) => process.stderr.write(`main-gate-red: ${msg}\n`)
/**
 * A notification that failed is itself a signal nobody saw, which is the whole
 * subject of AGL-2533 — so it gets an Actions annotation rather than a stderr
 * line in a passing step.
 */
const warn = (msg) => {
  say(msg)
  process.stdout.write(`::warning::main-gate-red: ${msg}\n`)
}

if (!shouldReport(results)) {
  say(`nothing to report (fast=${results.fast || 'n/a'} full=${results.full || 'n/a'})`)
  process.exit(0)
}
say(`RED on ${sha.slice(0, 9)} - ${failedJobs(results).join(', ')}`)

const key = (process.env['LINEAR_API_KEY'] ?? '').trim()
if (!key) {
  // Loud, because this is the notification path failing silently - the exact
  // shape AGL-2533 is about.
  warn('LINEAR_API_KEY is not set, so this red reaches NOBODY. Set the secret.')
  process.exit(0)
}

async function linear(query, variables) {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Linear returned ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'Linear error')
  return body.data
}

try {
  const marker = redMarker({ sha, results })
  const found = await linear(
    `query Sink($id: String!) {
       issue(id: $id) { id identifier comments(first: 50) { nodes { body } } }
     }`,
    { id: SINK_ISSUE_ID },
  )
  const issue = found?.issue
  if (!issue) {
    warn(`sink issue ${SINK_ISSUE_ID} not found - has it been deleted? This red reaches nobody.`)
    process.exit(0)
  }
  const already = (issue.comments?.nodes ?? []).some((c) => (c.body ?? '').includes(marker))
  if (already) {
    say(`${SINK_ISSUE_ID} already carries this exact red; not repeating it`)
    process.exit(0)
  }
  await linear(
    `mutation Comment($issueId: String!, $body: String!) {
       commentCreate(input: { issueId: $issueId, body: $body }) { success }
     }`,
    { issueId: issue.id, body: redCommentBody({ sha, results, runUrl, subject }) },
  )
  say(`posted to ${SINK_ISSUE_ID}`)
} catch (error) {
  warn(`could NOT post (${String(error).slice(0, 160)}) - this red reaches nobody`)
}
process.exit(0)
