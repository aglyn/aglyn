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
 * WHO IS TOLD WHEN THE UPTIME PROBE GOES RED (AGL-2586).
 *
 * The probe has watched thirteen endpoints every fifteen minutes and told
 * nobody. Its own header says *"the run history IS the record"*, and that was
 * the whole defect: `/api/health/crons` answered 503 for FIFTY-ONE HOURS with
 * the right answer, and the record sat in a workflow nobody opened. Main Gate
 * had exactly this shape and it was fixed by sending the red to Slack `#ci`
 * (AGL-2533); this is the same repair for the other half of the board.
 *
 * It matters more now than it did, because AGL-2586 puts JOURNEY checks on
 * that list — can a prospect reach us, can a customer publish. A component
 * red that nobody reads is expensive; a revenue red that nobody reads is the
 * three days of dead signup this issue was written about.
 *
 * ## No dedupe, deliberately, and it is the opposite call from Main Gate's
 *
 * Main Gate grades a SHA, and the same sha is graded repeatedly — by a push
 * run, by the hourly cron, by a re-run — so a second message about it is a
 * duplicate and is suppressed against a commit status. An uptime probe grades
 * a MOMENT. Two consecutive failing runs are two consecutive samples of an
 * outage that is still happening, which is exactly what an on-call reader
 * needs to see and is the opposite of a duplicate. A sustained outage should
 * be loud; silence is what this file exists to end.
 *
 * Pure: the payload and the should-we-send decision live here and are tested;
 * `report-uptime-red.mjs` is the network half.
 */

/**
 * Rows worth alerting on.
 *
 * A `pending` row is a subsystem path that 404s while its target's root is
 * up — `main` naming an endpoint before production is promoted to serve it.
 * `probe-uptime.mjs` already treats that as green, and paging on a fact about
 * the deploy queue is the false alarm that teaches everyone to ignore the
 * channel.
 */
export function downTargets(results) {
  return (results ?? []).filter((row) => row && !row.ok && !row.pending)
}

/** Is there anything to send? */
export function shouldReport(results) {
  return downTargets(results).length > 0
}

/**
 * The endpoints whose failure is a REVENUE or ACCESS failure rather than a
 * component one, and the sentence that says so.
 *
 * Named rather than inferred: a reader woken by this needs to know in the
 * first line whether a subsystem is degraded or whether nobody can buy
 * anything, and the two do not deserve the same sentence. Anything not on
 * this list gets no claim made about it beyond the code the probe reported.
 */
export const JOURNEY_MEANING = {
  'console/journeys': 'creating or publishing may be refused for every customer',
  'tenant/funnel': 'the contact, sales and demo forms may be losing every lead',
  'console/signups': 'org creation is outside its expected volume',
}

/**
 * The Slack message.
 *
 * URLs and probe codes only. The bodies these rows came from are public and
 * carry no customer data by contract, and nothing here adds any.
 */
export function slackPayload({ results, runUrl }) {
  const down = downTargets(results)
  const names = down.map((row) => row.name)
  const journeys = names.filter((name) => JOURNEY_MEANING[name])
  const headline = journeys.length
    ? `Uptime probe: a USER JOURNEY is failing (${names.join(', ')})`
    : `Uptime probe: ${names.join(', ')} DOWN`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|${headline}>*`,
    ...down.map(
      (row) =>
        `• \`${row.name}\` — ${row.detail || 'failed'}${
          JOURNEY_MEANING[row.name] ? ` — ${JOURNEY_MEANING[row.name]}` : ''
        }\n  ${row.url}`,
    ),
    journeys.length
      ? 'A journey check is not a component check: every dependency can be ' +
        'healthy while nobody can sign up, publish, or reach us. Open the ' +
        'endpoint and read which check failed. Runbook: docs/UPTIME_AND_SLA.md.'
      : 'Open the endpoint and read which check failed. A subsystem 404 while ' +
        'the root is up is a pending promotion and is not reported here. ' +
        'Runbook: docs/UPTIME_AND_SLA.md.',
  ].join('\n')
  return {
    text: headline,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: detail } }],
  }
}
