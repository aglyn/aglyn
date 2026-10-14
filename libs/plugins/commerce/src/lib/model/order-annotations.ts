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

import {
  appendOrderEvent,
  orderLineRefunded,
  type HostOrder,
  type OrderRestockCheck,
  type OrderTimelineEvent,
} from './commerce-orders'

/*
 * What a person writes on an order by hand (AGL-3651, AGL-3652): a note on
 * its timeline and the answer to a restock question. The console's order
 * dialog and the server routes the native apps call both build the write
 * here, so the two cannot disagree about what a note or an answer is.
 */

/** The longest note the timeline keeps. */
export const ORDER_NOTE_MAX_LENGTH = 500

/** What the restock question can be answered with. */
export type RestockResolution = NonNullable<OrderRestockCheck['resolution']>

/** The words a timeline line carries for an answered restock question. */
export const RESTOCK_ANSWER_DETAIL: Readonly<Record<RestockResolution, string>> = {
  restocked: 'answered — restocked',
  dismissed: 'answered — no restock',
}

/** The fields a note updates, or null for a note with nothing in it. */
export function orderNoteUpdate(
  order: Pick<HostOrder, 'timeline'>,
  text: string,
  atMs = Date.now(),
): { timeline: OrderTimelineEvent[] } | null {
  const note = String(text ?? '').trim().slice(0, ORDER_NOTE_MAX_LENGTH)
  if (!note) return null
  return { timeline: appendOrderEvent(order, 'note', note, atMs) }
}

export type RestockAnswer =
  | { verdict: 'recorded'; update: { restockCheck: OrderRestockCheck; timeline: OrderTimelineEvent[] } }
  /** The question was already answered (by the cancel route, or another admin). */
  | { verdict: 'answered' }
  /** A later reversal asked again: the caller answered an older question. */
  | { verdict: 'changed' }

/**
 * Answers the order's open restock question. `askedFlaggedAtMs` names the
 * question the person saw, so an answer never lands on a newer one. The
 * timeline is the stored order's, so a note that landed meanwhile survives.
 */
export function restockAnswer(
  current: Pick<HostOrder, 'restockCheck' | 'timeline'>,
  askedFlaggedAtMs: number,
  resolution: RestockResolution,
  uid: string,
  atMs = Date.now(),
): RestockAnswer {
  const fresh = current.restockCheck
  if (!fresh || fresh.resolution) return { verdict: 'answered' }
  if (fresh.flaggedAtMs !== askedFlaggedAtMs) return { verdict: 'changed' }
  return {
    verdict: 'recorded',
    update: {
      restockCheck: { ...fresh, resolution, resolvedAtMs: atMs, ...(uid ? { resolvedBy: uid } : {}) },
      timeline: appendOrderEvent(current, 'restock-check', RESTOCK_ANSWER_DETAIL[resolution], atMs),
    },
  }
}

/**
 * What the order dialog's restock card says about the open question, word for
 * word: how many units may need restocking after which door, and how far to
 * trust that number. The native apps print this same sentence.
 */
export function describeRestockCheck(
  restock: Pick<OrderRestockCheck, 'units' | 'kind' | 'fullyReversed' | 'lines'>,
  order: Partial<HostOrder>,
): string {
  // On a partial the flagged units are the MOST it could be — UNLESS the
  // refund named its lines (AGL-2325), in which case the question is scoped
  // to exactly those and the merchant is only being asked whether the goods
  // came back.
  const linesNamed = Boolean(
    restock.lines?.length &&
      restock.lines.every((line) => line.lineIndex != null && orderLineRefunded(order, line.lineIndex)),
  )
  return (
    `${restock.units} ${restock.units === 1 ? 'unit' : 'units'} may need restocking after this ${
      restock.kind === 'chargeback' ? 'chargeback' : 'refund'
    }.` +
    // The chargeback default is NO, same as the timeline's wording: the
    // shopper kept the item and took the money.
    (restock.kind === 'chargeback' ? ' The shopper kept the goods unless they actually came back.' : '') +
    (restock.fullyReversed
      ? ''
      : linesNamed
        ? ' Only part of the money came back: these are the lines withdrawn by this refund, so the units are theirs — only you know whether the goods came back.'
        : ' Only part of the money came back, so these units are an upper bound — only you know which goods returned.')
  )
}
