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
// The comment Main Gate posts when it grades `main` RED (AGL-2533).
//
// ## WHY THERE IS A NOTIFICATION AT ALL
//
// The gate detected two real breaks on 2026-09-03 and told nobody: it writes a
// COMMIT STATUS, which is correct, precise, and attached to a sha the branch
// has already moved past. Both reds went unread for hours while four
// promotions went out. The workflow header used to claim it reported "into ONE
// tracking issue that is opened on red and closed on green" -- that mechanism
// never existed, because `gh api repos/aglyn/aglyn` returns `has_issues:false`
// and `gh issue create` would have died on every red.
//
// Linear has no such limitation, `LINEAR_API_KEY` is already a repo secret,
// and `check-external-facts.mjs` already posts comments through it. So the
// original design is restored on the channel this team actually reads.
//
// ## WHY A MARKER
//
// A scheduled gate re-grades the same sha repeatedly, and a re-run of a red
// run posts again. Without an idempotency key the sink would fill with
// duplicates of one incident and everybody would mute it -- the precise
// failure this exists to prevent. The marker is keyed on the sha AND the set
// of failing jobs, so the same red is never repeated, while a sha that later
// fails DIFFERENTLY is a new fact and does post.

import { createHash } from 'node:crypto'

/** The Linear issue the gate comments on. Read its description before changing. */
export const SINK_ISSUE_ID = 'AGL-2537'

/** Jobs whose failure is worth waking somebody for. */
export const REPORTABLE_JOBS = ['fast', 'full']

/**
 * Which jobs actually failed, in a stable order.
 *
 * `skipped` and `cancelled` are NOT failures: `full` is skipped on every push
 * by design (it runs on the hourly cron), and treating that as red would post
 * on every green push.
 */
export function failedJobs(results) {
  return REPORTABLE_JOBS.filter((job) => results?.[job] === 'failure')
}

/** Nothing to say unless a reportable job actually failed. */
export function shouldReport(results) {
  return failedJobs(results).length > 0
}

/**
 * The idempotency key. Same sha + same failing set = same marker = not
 * reposted. A different failing set on the same sha IS new information.
 */
export function redMarker({ sha, results }) {
  const digest = createHash('sha256')
    .update(`${sha} ${failedJobs(results).join(',')}`)
    .digest('hex')
    .slice(0, 12)
  return `<!-- main-gate-red:${digest} -->`
}

/**
 * Whether to ping Slack, given what happened on the Linear side.
 *
 * Linear is the DEDUPE ORACLE, because Slack has no equivalent of "does this
 * message already exist" — a webhook post is unconditional. The gate can grade
 * one red sha more than once (a push run plus an hourly cron run, or a re-run
 * of a red run), so an unguarded webhook would ping repeatedly for one
 * incident, which is how a channel gets muted in a week.
 *
 * FAIL-OPEN when Linear could not answer: a missed ping on the one channel
 * that is immediate is worse than a duplicate. The duplicate is visible and
 * annoying; the miss is silent, and silence is the whole subject of AGL-2533.
 */
export function shouldPingSlack(linearOutcome) {
  return linearOutcome !== 'duplicate'
}

/**
 * The Slack webhook body.
 *
 * `text` is set as well as `blocks` deliberately: it is what Slack shows in
 * the notification itself and in any client that cannot render blocks, so a
 * blocks-only payload pushes a useless "This content can't be displayed" into
 * exactly the phone alert this exists to send.
 */
export function slackPayload({ sha, results, runUrl, subject }) {
  const jobs = failedJobs(results)
  const short = String(sha).slice(0, 9)
  const summary = `Main Gate is RED on ${short} — ${jobs.map((j) => `main-gate/${j}`).join(', ')}`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|Main Gate is RED on \`${short}\`>*`,
    ...jobs.map((j) => `• \`main-gate/${j}\` failed — ${JOB_MEANING[j] ?? j}`),
    subject ? `_${subject}_` : null,
    '`main` is broken until this is repaired or shown to be a known flake.',
  ]
    .filter((l) => l !== null)
    .join('\n')
  return {
    text: summary,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: detail } }],
  }
}

const JOB_MEANING = {
  fast: 'typecheck + guards',
  full: 'tests + production builds',
}

/** The comment body. Terse on purpose: it is read on a phone, at night. */
export function redCommentBody({ sha, results, runUrl, subject, when = new Date() }) {
  const jobs = failedJobs(results)
  return [
    redMarker({ sha, results }),
    '',
    `**Main Gate is RED on \`${String(sha).slice(0, 9)}\`.**`,
    '',
    ...jobs.map((j) => `- \`main-gate/${j}\` FAILED - ${JOB_MEANING[j] ?? j}`),
    '',
    subject ? `Commit: ${subject}` : null,
    runUrl ? `Run: ${runUrl}` : null,
    `Graded: ${when.toISOString()}`,
    '',
    '`main` is broken until this is repaired or shown to be a known flake.',
    'A promotion opened while this stands will be told so by the',
    '`Promotion verdict` check, which refuses a RED TIP (AGL-2533).',
  ]
    .filter((l) => l !== null)
    .join('\n')
}
