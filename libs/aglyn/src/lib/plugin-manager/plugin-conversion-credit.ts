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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * Credit for an outcome, handed to whichever plugin keeps track of where
 * visitors came from (AGL-3080).
 *
 * Many doors produce an outcome somebody may be credited with: a form
 * submission, a booking, a member sign-up, a newsletter opt-in, the contact
 * and the lead the record system files for them, an order and its refund,
 * and what a plugin's own outbound mail led to. None of those doors is the
 * plugin that decides WHICH arrival earns the credit — the window, the
 * last-touch rule, the channels compared, the rollups a report reads — and
 * each of them used to import that plugin's join from the core, which is
 * how a marketing model came to live in the platform's data layer.
 *
 * So a door stops importing and starts ASKING. The plugin that credits
 * outcomes registers one creditor here; every door hands it what it saw.
 *
 *  - {@link resolveConversionTouch}, once per request, at the door: where
 *    the visitor arrived from, from what their browser carried and the
 *    address they gave. The answer is OPAQUE to the door — it is the
 *    creditor's own shape, handed back unread to every writer beneath the
 *    door, so one visitor action pays for one lookup and its records cannot
 *    disagree about the arrival. A door that hands it to the person capture
 *    puts it under {@link CONVERSION_TOUCH_DETAIL} in the capture's
 *    `detail`, which the plugin that keeps people passes on as it found it.
 *  - {@link creditConversion}: one identify moment (`kind` is the door's own
 *    word — a form, a lead, a contact, a booking), credited to that touch or
 *    to a click a plugin's own mail recorded.
 *  - {@link creditOrderConversion} and {@link reverseOrderConversion}: money
 *    an order brought in, and money a refund or a chargeback took back.
 *  - {@link recordConversionClick}: a person followed a link in mail a
 *    plugin sent them, which a later outcome of theirs may be credited to.
 *  - {@link creditConversionOutcome}: what a plugin's own record produced —
 *    an enrollment enrolled, sent, replied — counted under every container
 *    that record is filed under (`plugin-containers.ts`).
 *  - {@link eraseConversionCredits}: everything the creditor holds about a
 *    person, by the key every suppression list names them by, on every site.
 *    The platform's own address erasure calls it beside the delivery log.
 *  - {@link describeConversion}: the touch a door resolved and the
 *    containers its record is filed under, in words a person reads — what a
 *    door's alert says about where an outcome came from (AGL-3461).
 *
 * ## No creditor is an answer
 *
 * A workspace whose plugins credit nothing has nothing to credit, and every
 * door's outcome is complete without it. So each call answers its empty
 * value — `null`, `false`, `0` — and the door goes on. A boot whose
 * declarations failed looks the same from here, so the first call that finds
 * nobody runs the app's boot step once (`plugin-declarations-repair.ts`) and
 * asks again, as a person capture does.
 *
 * ## Never throws
 *
 * Every door has already done the thing being credited — the submission is
 * stored, the money has moved. A lost credit understates a report; a thrown
 * one loses a lead or a checkout. A creditor that throws anyway is logged
 * and answered as empty.
 *
 * ## The caller proves who is asking
 *
 * The registry authenticates nobody. A door has decided, in its own terms and
 * before it asks, that the outcome happened on that site.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

/**
 * Where a visitor arrived from, as the creditor resolved it. Opaque: no door
 * reads it, and every door hands it back exactly as it was given.
 */
export type PluginConversionTouch = Readonly<Record<string, unknown>>

/**
 * The key a door files a resolved touch under in a person capture's
 * `detail` (`plugin-contact-capture.ts`), so the plugin that keeps people
 * credits the contact or the lead it files to the same arrival.
 */
export const CONVERSION_TOUCH_DETAIL = 'conversionTouch'

/** What a door knows when it asks where its visitor came from. */
export interface PluginConversionTouchRequest {
  hostId: string
  /**
   * What the visitor's browser carried for the purpose, as the request
   * delivered it. Untrusted: the creditor re-parses it.
   */
  wire?: unknown
  /** The address the visitor identified with, raw, when they gave one. */
  email?: unknown
  /** When they identified themselves. Defaults to now. */
  atMs?: number
}

/**
 * A link in mail a plugin sent, followed by the person it was sent to.
 *
 * `creditTo` is what the mail was sent under, in the creditor's terms: the
 * send, or the container the sending record is filed under. `via` is the
 * sending plugin's own facts about the message (its sequence, its
 * enrollment), passed through for the creditor's record and unread here.
 */
export interface PluginConversionClick {
  hostId: string
  creditTo: string
  /** When the link was followed, epoch ms. */
  atMs: number
  via?: Readonly<Record<string, string>>
}

/** One identify moment, credited to how the visitor arrived. */
export interface PluginConversionRequest {
  hostId: string
  /** The door's word for the moment: `form`, `lead`, `contact`, `booking`. */
  kind: string
  /** The record the moment produced, in the door's terms. */
  refId: string
  /** The touch {@link resolveConversionTouch} answered; `null` credits nobody. */
  touch?: PluginConversionTouch | null
  /** A click the door's own mail recorded, credited in place of a touch. */
  click?: PluginConversionClick | null
  /** When the visitor became identifiable. Defaults to now. */
  convertedAtMs?: number
}

/** Money an order brought in, credited to the buyer's last arrival. */
export interface PluginOrderConversionRequest {
  hostId: string
  /** The order, booking or invoice the money came in on. */
  orderId: string
  /** The buyer as the sale recorded them, raw. */
  email: unknown
  /** Gross minor units the buyer was charged. */
  amountCents: number
  /** Lowercase currency code, when the door knows one. */
  currency?: string
  /** When the order was placed. Defaults to now. */
  orderedAtMs?: number
}

/** Money taken back off an order: a refund, or a lost dispute. */
export interface PluginOrderReversalRequest {
  hostId: string
  orderId: string
  /** Minor units reversed by THIS attempt, never the order total. */
  amountCents: number
  /** True only for the write that moved the order into fully refunded. */
  closedTheOrder: boolean
  kind?: 'refund' | 'chargeback'
}

/** What a plugin's own record produced, counted under its containers. */
export interface PluginConversionOutcomeRequest {
  /** The site the record acts for; the creditor resolves the org from it. */
  hostId: string
  /** The org, when the caller holds it. */
  orgId?: string | null
  /** The containers the record is filed under (`plugin-containers.ts`). */
  containerIds: readonly string[]
  /** The sending plugin's word for the outcome: `enrolled`, `replied`. */
  outcome: string
  atMs?: number
}

export interface PluginConversionCreditor {
  resolveTouch(request: PluginConversionTouchRequest): Promise<PluginConversionTouch | null>
  /** Answers whether a credit was written; once per (`kind`, `refId`). */
  creditConversion(request: PluginConversionRequest): Promise<boolean>
  creditOrder(request: PluginOrderConversionRequest): Promise<boolean>
  reverseOrder(request: PluginOrderReversalRequest): Promise<boolean>
  /** Answers whether the person's last click on that site moved forward. */
  recordClick(click: PluginConversionClick & { email: unknown }): Promise<boolean>
  /** Answers how many containers were credited. */
  creditOutcome(request: PluginConversionOutcomeRequest): Promise<number>
  /**
   * Erases what the creditor holds about one person, on every site, by
   * `personKey`/`emailSuppressionKey` — the same hash. Answers how many
   * records went.
   */
  erasePerson(key: string): Promise<number>
  /**
   * Names a touch and a record's containers for a person to read. Optional:
   * a creditor that does not answer leaves a door's alert saying what it
   * knows itself.
   */
  describeConversion?(
    request: PluginConversionDescribeRequest,
  ): Promise<PluginConversionDescription | null>
}

/** What a door asks to have named (AGL-3461). */
export interface PluginConversionDescribeRequest {
  hostId: string
  /** The touch {@link resolveConversionTouch} answered, handed back unread. */
  touch?: PluginConversionTouch | null
  /** The containers the door's record is filed under (`plugin-containers.ts`). */
  containerIds?: readonly string[]
}

/** A touch and a record's containers, in a person's words. */
export interface PluginConversionDescription {
  /**
   * What the outcome was credited to: a campaign's name, or the label a link
   * carried when no campaign declares it. Absent when the touch credits
   * nothing the creditor can name.
   */
  credited?: {
    /** The campaign's name, or the link's labels joined. */
    label: string
    /** How the visitor was touched, in a phrase: `viewed a page filed under it`. */
    how: string
    /** The container credited, when the touch names one. */
    containerId?: string
  }
  /** The containers named, in the order asked, each still standing. */
  filedUnder: Array<{ id: string; label: string }>
}

export const PLUGIN_CONVERSION_CREDIT = definePluginServiceContract<PluginConversionCreditor>(
  'core.conversion-credit',
  { multiple: false },
)

/**
 * Registers the plugin that credits outcomes. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; a second
 * plugin's creditor is refused naming both, and the incumbent keeps serving.
 */
export function registerPluginConversionCreditor(
  creditor: PluginConversionCreditor,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_CONVERSION_CREDIT, creditor, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The creditor with its owner, or `null` when no plugin credits outcomes here. */
export function pluginConversionCreditor(): { pluginId: string; creditor: PluginConversionCreditor } | null {
  const entry = resolvePluginServices(PLUGIN_CONVERSION_CREDIT)[0]
  return entry ? { pluginId: entry.pluginId, creditor: entry.impl } : null
}

/**
 * The creditor, running the app's boot step once when nobody answers. The
 * step memoizes its own promise, so this is one attempt per process.
 */
async function creditor(): Promise<PluginConversionCreditor | null> {
  const found = pluginConversionCreditor()
  if (found) return found.creditor
  try {
    await runPluginDeclarationsRepair()
  } catch (error) {
    console.error('[conversion-credit] plugin declarations failed', error)
  }
  return pluginConversionCreditor()?.creditor ?? null
}

/** One call, with the empty answer for nobody and for a throw. */
async function ask<T>(
  what: string,
  empty: T,
  call: (found: PluginConversionCreditor) => Promise<T>,
): Promise<T> {
  try {
    const found = await creditor()
    return found ? await call(found) : empty
  } catch (error) {
    console.error(`[conversion-credit] ${what} failed`, error)
    return empty
  }
}

/** Where the visitor arrived from, or `null`: direct, or nobody credits. */
export function resolveConversionTouch(
  request: PluginConversionTouchRequest,
): Promise<PluginConversionTouch | null> {
  return ask('resolveTouch', null, (found) => found.resolveTouch(request))
}

/** Credits one identify moment. A request with no touch and no click credits nobody. */
export function creditConversion(request: PluginConversionRequest): Promise<boolean> {
  if (!request.touch && !request.click) return Promise.resolve(false)
  return ask('creditConversion', false, (found) => found.creditConversion(request))
}

/** Credits an order's money to the buyer's last arrival. */
export function creditOrderConversion(request: PluginOrderConversionRequest): Promise<boolean> {
  return ask('creditOrder', false, (found) => found.creditOrder(request))
}

/** Takes money back off an order's credit. */
export function reverseOrderConversion(request: PluginOrderReversalRequest): Promise<boolean> {
  return ask('reverseOrder', false, (found) => found.reverseOrder(request))
}

/** Records that a person followed a link in mail a plugin sent them. */
export function recordConversionClick(
  click: PluginConversionClick & { email: unknown },
): Promise<boolean> {
  return ask('recordClick', false, (found) => found.recordClick(click))
}

/** Counts what a plugin's own record produced under each of its containers. */
export function creditConversionOutcome(request: PluginConversionOutcomeRequest): Promise<number> {
  return ask('creditOutcome', 0, (found) => found.creditOutcome(request))
}

/** Erases what the creditor holds about one person, by key. */
export function eraseConversionCredits(key: string): Promise<number> {
  if (!key) return Promise.resolve(0)
  return ask('erasePerson', 0, (found) => found.erasePerson(key))
}

/**
 * A touch and a record's containers, named — or `null` when nobody credits
 * outcomes here or the creditor does not describe them.
 */
export function describeConversion(
  request: PluginConversionDescribeRequest,
): Promise<PluginConversionDescription | null> {
  return ask('describeConversion', null, async (found) =>
    found.describeConversion ? found.describeConversion(request) : null,
  )
}
