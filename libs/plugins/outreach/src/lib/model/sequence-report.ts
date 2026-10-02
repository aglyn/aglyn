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

/*==========================================
 * WHAT A SEQUENCE MEASURED, AND WHAT IT DID NOT (AGL-3239).
 *
 * The rules are `send-report.ts`'s, applied to a channel that can
 * measure less, and the sameness is deliberate: a rate called "click rate"
 * on the Sequences screen and a rate called "click rate" on a campaign's
 * report are taken over comparably named denominators, and each says which
 * one on screen.
 *
 * Three refusals carry over unchanged:
 *
 * 1. **A rate over a zero or unknown denominator is `null`**, never 0%. The
 *    rate helper itself is `sendRate`, imported rather than rewritten,
 *    so the two reports cannot drift into two definitions of a percentage.
 * 2. **An absent counter is "not recorded", not nought.** A sequence that
 *    ran before the counters existed reports nothing rather than zeroes.
 * 3. **A structural zero is withheld with its reason named.** A sequence
 *    that never sent a tracked link could only ever have counted zero
 *    clicks, so its click rate measures our sending code and is not shown.
 *
 * And one is this channel's own:
 *
 * 4. **Opens are not measured unless the sequence asked for them.** A
 *    sequence email is plain text by decision and a pixel needs an HTML
 *    part, so for a sequence with "Count opens" off the report SAYS opens
 *    are not measured, in the place a reader looks for an open rate — nobody
 *    concludes from a missing number that nobody read the mail. A sequence
 *    that counts them (AGL-3395) gets an open rate over the people who were
 *    sent the image, never over everyone it emailed, with the machine
 *    fetches set apart and shown.
 *=========================================*/

import {
  sendLinkReport,
  sendRate,
  type SendLinkReport,
  type SendLinkRollup,
  type SendRate,
} from '@aglyn/shared-ui-email-campaigns/model/send-report'
import type { OutreachSequenceStats } from './outreach.types'

/** Why a number a reader expects is missing, or must not be read the obvious way. */
export interface OutreachReportCaveat {
  /** Stable id, so a spec asserts on the caveat and not on its prose. */
  id:
    | 'opens-not-measured'
    | 'opens-unrecorded'
    | 'opens-counted'
    | 'opens-stopped'
    | 'clicks-not-tracked'
    | 'clicks-unrecorded'
    | 'machine-clicks-excluded'
  message: string
}

/** Everything the sequence's report card renders. */
export interface OutreachSequenceReport {
  /** Email steps that left. One person getting four emails counts four. */
  sent: number
  /** Distinct people who have had at least one, or `null` when unrecorded. */
  people: number | null
  /** Click events judged a person's. */
  clicks: number
  /** Distinct people who clicked — the rate's numerator. */
  uniqueClicks: number
  /** Clicks a scanner made, counted apart and never in the rate. */
  machineClicks: number
  /** When a person last followed a link. */
  lastClickAtMs: number | null
  /** Whether any email of this sequence went out with its links rewritten. */
  clickTracked: boolean
  /** Whether any email of this sequence carried a tracking image (AGL-3395). */
  openTracked: boolean
  /** Distinct people sent at least one email with the image, or `null` when unrecorded. */
  openPeople: number | null
  /** Opens judged a person's. */
  opens: number
  /** Distinct people who opened — the open rate's numerator. */
  uniqueOpens: number
  /** Fetches of the image a machine made, never in the rate. */
  machineOpens: number
  /** Of `machineOpens`, the ones a mail provider's image proxy made. */
  proxyOpens: number
  /** When a person last opened one of the emails. */
  lastOpenAtMs: number | null
  rates: {
    /**
     * Distinct people who clicked, over the people emailed.
     *
     * `null` when the sequence never sent a tracked link, when nobody has
     * been emailed yet, and when the counters predate the feature.
     */
    click: SendRate | null
    /**
     * Distinct people who opened, over the people sent the image.
     *
     * `null` when no email carried the image, and when nobody has been sent
     * one yet.
     */
    open: SendRate | null
  }
  caveats: OutreachReportCaveat[]
}

/** The sentence each caveat is shown as. */
const CAVEATS: Record<OutreachReportCaveat['id'], string> = {
  'opens-not-measured':
    'Opens aren’t measured. A sequence email is plain text, the way a one-to-one email is, and counting an open needs a tracking image in an HTML email. Clicks are measured instead.',
  'opens-unrecorded':
    'Opens are counted for this sequence, and no email with the tracking image has gone out yet. Emails sent from now on carry it.',
  'opens-counted':
    'Opens are counted from a tracking image in an HTML copy of each email, and the open rate is taken over the people sent one. Gmail readers’ opens count. Fetches Apple Mail makes as the email arrives, whether or not anyone reads it, and those by Yahoo’s image proxy and security scanners, are counted separately and left out of the rate.',
  'opens-stopped':
    'Opens were counted while this sequence’s emails carried a tracking image. It’s turned off now, so the figures cover only the emails sent while it was on.',
  'clicks-not-tracked':
    'Clicks aren’t being counted for this sequence. Turn on link tracking in its settings, and the emails sent after that have their links counted.',
  'clicks-unrecorded':
    'No click has been counted for this sequence yet: either its emails carry no links, or they went out before link tracking was turned on. Emails sent from now on are counted.',
  'machine-clicks-excluded':
    'Some clicks came from security scanners that open every link in an email before the recipient sees it. They’re counted separately and left out of the click rate.',
}

const caveat = (id: OutreachReportCaveat['id']): OutreachReportCaveat => ({
  id,
  message: CAVEATS[id],
})

/**
 * Turns a sequence's stored counters into its report.
 *
 * @param stats The sequence's `stats`, or `undefined` for one that has none.
 * @param trackClicks Whether the sequence is SET to track clicks now — which
 *   is a different question from whether it ever has, and the two together
 *   are what separate "nothing to report yet" from "this will never report".
 * @param countOpens Whether the sequence is SET to count opens now
 *   (AGL-3395), read beside `stats.openTracked` the same way.
 */
export function outreachSequenceReport(
  stats: OutreachSequenceStats | undefined,
  trackClicks: boolean,
  countOpens = false,
): OutreachSequenceReport {
  const source = stats ?? {}
  const count = (value: unknown): number => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const sent = count(source.sent)
  /*
   * ABSENT, not zero — the distinction `send-report.ts` makes about
   * `delivered` and for the same reason. `people` is the denominator of the
   * click rate, and `?? 0` here would turn "we never counted" into "nobody
   * was emailed" and render that beside a non-zero send count.
   */
  const people = source.people === undefined ? null : count(source.people)
  const clicks = count(source.clicks)
  const uniqueClicks = count(source.uniqueClicks)
  const machineClicks = count(source.machineClicks)
  const clickTracked = source.clickTracked === true
  const openTracked = source.openTracked === true
  const openPeople = source.openPeople === undefined ? null : count(source.openPeople)
  const uniqueOpens = count(source.uniqueOpens)
  const machineOpens = count(source.machineOpens)

  /*
   * Opens (AGL-3395). A sequence that never carried the image says opens
   * are not measured — the sentence every sequence showed before the
   * setting existed, and still true of every one with it off. One that has
   * carried it explains what the rate counts, and one that stopped says
   * the figures stop where the setting did.
   */
  const caveats: OutreachReportCaveat[] = []
  if (!openTracked) caveats.push(caveat(countOpens ? 'opens-unrecorded' : 'opens-not-measured'))
  else caveats.push(caveat(countOpens ? 'opens-counted' : 'opens-stopped'))
  if (!clickTracked) {
    /*
     * Two ways to have no click figures, and they are not the same
     * situation: one is a setting nobody turned on, the other is a sequence
     * that finished its sending before the counters existed. The first has
     * something to do about it and the second does not, so they are named
     * apart — and a sequence that has sent NOTHING yet gets neither, because
     * there is nothing missing about a report for a sequence that has not
     * run.
     */
    if (sent > 0) caveats.push(caveat(trackClicks ? 'clicks-unrecorded' : 'clicks-not-tracked'))
    else if (!trackClicks) caveats.push(caveat('clicks-not-tracked'))
  }
  if (machineClicks > 0) caveats.push(caveat('machine-clicks-excluded'))

  return {
    sent,
    people,
    clicks,
    uniqueClicks,
    machineClicks,
    lastClickAtMs:
      typeof source.lastClickAtMs === 'number' && Number.isFinite(source.lastClickAtMs)
        ? source.lastClickAtMs
        : null,
    clickTracked,
    openTracked,
    openPeople,
    opens: count(source.opens),
    uniqueOpens,
    machineOpens,
    proxyOpens: Math.min(count(source.proxyOpens), machineOpens),
    lastOpenAtMs:
      typeof source.lastOpenAtMs === 'number' && Number.isFinite(source.lastOpenAtMs)
        ? source.lastOpenAtMs
        : null,
    rates: {
      click: clickTracked
        ? sendRate(uniqueClicks, people ?? undefined, 'people emailed')
        : null,
      open: openTracked
        ? sendRate(uniqueOpens, openPeople ?? undefined, 'people sent a tracked email')
        : null,
    },
    caveats,
  }
}

/**
 * The sequence's link table, on the campaign rollup's own reader.
 *
 * Re-exported rather than wrapped: the stored shape is the campaign one, the
 * key derivation is the campaign one, and the table a rep reads should be
 * the same table a marketer reads.
 */
export function outreachSequenceLinkReport(
  rollup: SendLinkRollup | undefined,
): SendLinkReport {
  return sendLinkReport(rollup)
}
