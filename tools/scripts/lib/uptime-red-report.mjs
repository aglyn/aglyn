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
 * THE OTHER HALF OF THE ALERT: WHAT CAME BACK (AGL-3690).
 *
 * This reporter only ever spoke on a red. When the 2026-10-08 journey alert
 * cleared a few minutes later, nobody was told, and the channel's last word
 * was still "creating or publishing may be refused for every customer".
 * Leaving an alert standing after it clears is as misleading as never raising
 * it.
 *
 * Graded per target, against the PREVIOUS run's own results rather than a
 * workflow conclusion. A run can recover one target while another stays down,
 * and "everything is fine" would then be false. A target counts as recovered
 * only when the last run had it down and this run has it up. A target that is
 * missing from this run, or now pending, makes no claim.
 */
export function recoveredTargets(previous, results) {
  const wasDown = new Set(downTargets(previous).map((row) => row.name))
  return (results ?? []).filter(
    (row) => row && row.ok && !row.pending && wasDown.has(row.name),
  )
}

/** Is there a recovery to announce? */
export function shouldReportRecovery(previous, results) {
  return recoveredTargets(previous, results).length > 0
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
  // The two front doors (AGL-2709). Not a journey in the sense the rest of
  // this list means it — this is the plainest failure there is, a visitor
  // asking for a page and not getting one — but it belongs on the list for
  // the same reason: it must not read as one more component row. Every other
  // check on the board was green through ten minutes of exactly this.
  'front-door/site':
    'a visitor asking for a published site is NOT getting a page',
  'front-door/marketing':
    'a visitor asking for the marketing home is NOT getting a page',
  'console/auth-doors':
    'a way IN may be shut — password recovery, the verification link, Google, SSO or passkeys',
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
  /**
   * A CHALLENGED row is red and makes no claim about the site (AGL-2709).
   * Bot protection answered instead of the app, so the probe learned nothing —
   * and `JOURNEY_MEANING` for a front door reads "a visitor is NOT getting a
   * page", which would be a fabricated outage in the one place a reader is
   * least able to check it. The row still appears, with the verdict the probe
   * actually produced; only the claim is withheld.
   */
  const claim = (row) => (row.challenged ? null : JOURNEY_MEANING[row.name])
  const journeys = down.filter((row) => claim(row))
  const headline = journeys.length
    ? `Uptime probe: a USER JOURNEY is failing (${names.join(', ')})`
    : `Uptime probe: ${names.join(', ')} DOWN`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|${headline}>*`,
    ...down.map(
      (row) =>
        `• \`${row.name}\` — ${row.detail || 'failed'}${
          claim(row) ? ` — ${claim(row)}` : ''
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

/**
 * The recovery message: what is back, and what is still down if anything is,
 * so one message never reads as "all clear" while a red stands.
 */
export function recoveryPayload({ previous, results, runUrl }) {
  const back = recoveredTargets(previous, results)
  const still = downTargets(results)
  const names = back.map((row) => row.name)
  const headline = `Uptime probe: RECOVERED (${names.join(', ')})`
  const detail = [
    `*<${runUrl || 'https://github.com/aglyn/aglyn/actions'}|✅ ${headline}>*`,
    ...back.map(
      (row) =>
        `• \`${row.name}\` — back up${row.detail ? ` · ${row.detail}` : ''}\n  ${row.url}`,
    ),
    still.length
      ? `Still down: ${still.map((row) => `\`${row.name}\``).join(', ')}. ` +
        'Its own alert is posted alongside this one.'
      : 'Nothing else on the probe is down.',
  ].join('\n')
  return {
    text: headline,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: detail } }],
  }
}
