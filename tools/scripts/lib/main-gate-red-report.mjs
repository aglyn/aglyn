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
// The alert Main Gate sends when it grades `main` RED (AGL-2533), and the
// per-sha bookkeeping that keeps it from sending twice (AGL-2537).
//
// ## WHY THERE IS A NOTIFICATION AT ALL
//
// The gate detected two real breaks on 2026-09-03 and told nobody: it writes a
// COMMIT STATUS, which is correct, precise, and attached to a sha the branch
// has already moved past. Both reds went unread for hours while four
// promotions went out.
//
// ## WHY SLACK IS THE ONLY CHANNEL
//
// The first fix posted every red as a comment on a Linear issue and pinged
// Slack second. Two channels for one fact is one channel too many, and the
// Linear half aged badly by design: an issue that accumulates a comment per
// red becomes a stream people are trained to scroll past, which is how the
// silence of AGL-2533 comes back wearing a different hat. Reds go to Slack
// `#ci` and nowhere else.
//
// ## WHY A DIGEST
//
// A scheduled gate re-grades the same sha repeatedly, and a re-run of a red
// run reports again. Without an idempotency key the channel fills with
// duplicates of one incident and everybody mutes it -- the precise failure
// this exists to prevent. The digest is keyed on the sha AND the set of
// failing jobs, so the same red is never repeated, while a sha that later
// fails DIFFERENTLY is a new fact and does alert.
//
// Slack has no equivalent of "does this message already exist" -- a webhook
// post is unconditional -- so the record of what has been alerted lives on a
// COMMIT STATUS on the graded sha. It is durable, per-sha, free, and needs no
// credential beyond the `GITHUB_TOKEN` the workflow already has.

import { createHash } from 'node:crypto'

/**
 * Jobs whose failure is worth waking somebody for.
 *
 * `sweepDue` is here because `full` DEPENDS on it (AGL-2552). A failed
 * `sweep-due` leaves `full` skipped, and a skipped `full` is not a failure —
 * so without this entry the full sweep would stop running on every push and
 * the reporter would say "nothing to report", which is precisely the silent
 * detector this whole gate exists to prevent. The job that decides whether to
 * gate has to be gated too.
 */
export const REPORTABLE_JOBS = ['fast', 'full', 'sweepDue']

/**
 * Which jobs actually failed, in a stable order.
 *
 * `skipped` and `cancelled` are NOT failures: `full` is skipped on every push
 * by design (it runs on the hourly cron), and treating that as red would alert
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
 * The idempotency key. Same sha + same failing set = same digest = not
 * re-alerted. A different failing set on the same sha IS new information.
 */
export function redDigest({ sha, results }) {
  return createHash('sha256')
    .update(`${sha} ${failedJobs(results).join(',')}`)
    .digest('hex')
    .slice(0, 12)
}

/**
 * The commit-status namespace the dedupe record lives in.
 *
 * ⛔ It deliberately does NOT begin with `main-gate/`. That prefix is the
 * VERDICT namespace, and `gateContexts()` in `main-gate-verdicts.mjs` selects
 * a sha's gate verdicts by matching it. A bookkeeping status filed under it
 * would be counted as a verdict by the `Promotion verdict` check: a sha whose
 * `fast` job skipped and whose only failure was `sweep-due` writes no verdict
 * status at all, so the promotion would read this record as the tip's verdict
 * and grade it OK instead of reporting that the tip was never gated. A
 * neighboring namespace keeps the two sets disjoint by construction rather
 * than by care.
 */
export const REPORTED_CONTEXT_PREFIX = 'main-gate-notify/red-reported-'

/**
 * One context per distinct red, rather than one shared context carrying the
 * digest in its description.
 *
 * GitHub keeps only the LATEST status per context, so a shared context would
 * remember exactly one red per sha. A sha that failed `fast`, then `fast` and
 * `full`, then `fast` alone again on a re-run would have had its first record
 * overwritten and would alert a second time for a red already sent. A distinct
 * context per digest makes every red this sha has ever reported permanently
 * checkable, and the count is bounded at seven — the non-empty subsets of the
 * three reportable jobs.
 */
export function reportedContext({ sha, results }) {
  return `${REPORTED_CONTEXT_PREFIX}${redDigest({ sha, results })}`
}

/**
 * Has this exact red already been alerted on?
 *
 * `statuses` is the `statuses` array of GitHub's combined-status response.
 *
 * FAIL-OPEN in every uncertain case — an absent list, a malformed entry, a
 * state that is not the `success` this writes — because a duplicate alert is
 * visible and merely annoying, while a swallowed red is silent, and silence is
 * the whole subject of AGL-2533.
 */
export function alreadyReported({ statuses, context }) {
  return (Array.isArray(statuses) ? statuses : []).some(
    (s) => s?.context === context && s?.state === 'success',
  )
}

/**
 * What the dedupe status says to a human who finds it on a commit.
 *
 * A bare digest on a commit page is an unexplained mark; someone reading it
 * needs to know it is bookkeeping about an alert rather than a verdict about
 * the code.
 */
export function statusDescription(results) {
  return `alerted #ci: ${failedJobs(results).join(', ') || 'nothing'}`
}

const JOB_MEANING = {
  fast: 'typecheck + guards',
  full: 'tests + production builds',
  sweepDue: 'the full sweep is NOT running on pushes',
}

/**
 * How each job is NAMED in the alert. `fast` and `full` write commit statuses
 * and are named by their context; `sweep-due` writes none, so naming it
 * `main-gate/sweepDue` would send the reader looking for a status that does
 * not exist.
 */
const JOB_LABEL = {
  fast: '`main-gate/fast`',
  full: '`main-gate/full`',
  sweepDue: 'the `is the full sweep due` job',
}

/**
 * The Slack webhook body. Terse on purpose: it is read on a phone, at night.
 *
 * `text` is set as well as `blocks` deliberately: it is what Slack shows in
 * the notification itself and in any client that cannot render blocks, so a
 * blocks-only payload pushes a useless "This content can't be displayed" into
 * exactly the phone alert this exists to send.
 */
export function slackPayload({ sha, results, runUrl, subject }) {
  const jobs = failedJobs(results)
  const short = String(sha).slice(0, 9)
  // A `sweep-due` failure does NOT mean `main` is broken — it means the sweep
  // stopped watching. Saying "main is broken" there would send the reader
  // hunting for a break that does not exist, which is the same overstatement
  // the TEST message made twice (AGL-2550).
  const sweepOnly = jobs.length > 0 && jobs.every((j) => j === 'sweepDue')
  const headline = sweepOnly
    ? `Main Gate: the full sweep stopped covering pushes on ${short}`
    : `Main Gate is RED on ${short}`
  const summary = `${headline} — ${jobs.map((j) => JOB_MEANING[j] ?? j).join(', ')}`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|${headline}>*`,
    ...jobs.map((j) => `• ${JOB_LABEL[j] ?? j} failed — ${JOB_MEANING[j] ?? j}`),
    subject ? `_${subject}_` : null,
    sweepOnly
      ? '`main` is not known to be broken. What failed is the check that decides ' +
        'whether the full sweep runs, so the sweep has stopped covering pushes ' +
        'until this is repaired — the gate is now as blind as the cron made it.'
      : '`main` is broken until this is repaired or shown to be a known flake. ' +
        'A promotion opened while this stands will be told so by the ' +
        '`Promotion verdict` check, which refuses a RED TIP (AGL-2533).',
  ]
    .filter((l) => l !== null)
    .join('\n')
  return {
    text: summary,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: detail } }],
  }
}
