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

/**
 * THE PEOPLE A WORKSPACE KEEPS, asked for by the plugins that do not keep
 * them (AGL-3080).
 *
 * `plugin-contact-capture` is how a silo hands somebody it MET to the plugin
 * that keeps people. This is the other half: a plugin that has an address, or
 * a record the owner handed it, and needs the person behind it.
 *
 *  - a flow email asking whether the person agreed to marketing mail;
 *  - a campaign filling in the name a merge tag reads;
 *  - a refund taking money back off what a customer is worth;
 *  - an automation filing somebody under a campaign;
 *  - a sales sequence reading the people a rep enrolls.
 *
 * Each of those used to open the owner's collection itself — its path, its
 * address index, which site may see which document — and broke the day the
 * owner changed one. None of it is visible to `check:lib-boundaries`, because
 * a collection name is not an import.
 *
 * So the plugin that keeps people registers ONE service here, and every rule
 * stays the owner's: how an address is keyed, what an alternate address a
 * merge folded in still answers to, which site may see which record, and what
 * a refund or a filing writes.
 *
 * ## What a record is
 *
 * A {@link PluginPersonRecord} is a kind and an id in the owner's own words —
 * the words `plugin-record-routes` addresses the record by — the person's
 * primary address, and the record as the owner stores it. The fields the
 * PLATFORM defines on a person record (the consent basis
 * `marketing-consent.ts` reads, the `emailState` verdict, the `visibleTo`
 * scope) are read off it with the platform's own readers; anything else is
 * the owner's and is documented with its registration.
 *
 * ## Not registered is an answer
 *
 * Every reader answers `null` when no plugin keeps people in this process,
 * which is a workspace with no record system and is not "nobody found". A
 * caller treats the two differently: a send with no record system has no
 * basis to read, which is not the same as a person who declined.
 *
 * A single-implementation contract: a workspace keeps one set of people, so
 * a second plugin's service is refused naming both and the incumbent keeps
 * serving. Registered from the owner's server declarations, so it is in place
 * in a process that never loaded the owner's API surface.
 *
 * ## The caller proves who is asking
 *
 * Like the capture and timeline seams, the registry authenticates nobody. A
 * caller decides in its own terms, before it asks, that the read or the write
 * is the workspace's to make.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

/** A person record, by the owner's word for its kind and its id. */
export interface PluginPersonRecordRef {
  /** The owner's word for the record — the kind `plugin-record-routes` addresses it by. */
  kind: string
  id: string
}

/** One person record, as the plugin that keeps people shares it. */
export interface PluginPersonRecord extends PluginPersonRecordRef {
  /** The record's primary address, normalized, or `null` when it holds none. */
  email: string | null
  /**
   * The record as the owner stores it. The platform's own fields on it are
   * read with the platform's readers; the rest is the owner's, documented
   * with its registration.
   */
  data: Readonly<Record<string, unknown>>
}

/** Who to find by address, and where. */
export interface PluginPersonFindRequest {
  /**
   * The organization whose people are searched. A caller that knows only the
   * site names `hostId` instead, and the owner reads the organization off it.
   */
  orgId?: string | null
  /** The site asking. Required with {@link onlyVisibleToSite}. */
  hostId?: string | null
  /** Raw: the owner normalizes it, alternate addresses included. */
  email: unknown
  /**
   * Answer only a record `hostId` may see. A record the address names but the
   * site cannot see is `null`, never a reason to look further — one address
   * names one person.
   */
  onlyVisibleToSite?: boolean
  /**
   * Look at every kind of record the owner keeps a person as, in the owner's
   * order, instead of only the one a known person is held as. A send deciding
   * whether it may mail somebody asks for this: a person not yet qualified is
   * still a person whose answer counts.
   */
  anyKind?: boolean
}

/** Records to read, by the refs the owner handed out. */
export interface PluginPersonReadRequest {
  orgId: string
  records: readonly PluginPersonRecordRef[]
}

/**
 * File a person under containers (`plugin-containers.ts`) — the merchant's
 * own act, through an automation step or an enrollment. Filing is not
 * consent.
 */
export interface PluginPersonFileRequest {
  /** The site filing them: the person is filed under the containers as this site holds them. */
  hostId: string
  orgId?: string | null
  record: PluginPersonRecordRef
  /** The container kind, as `plugin-containers.ts` declares it. */
  containerKind: string
  ids: readonly string[]
}

/**
 * Money handed back to a person a silo took it from: a refund, or a dispute
 * lost. The owner records it beside what the person is worth; it never
 * creates a person to hold it.
 */
export interface PluginPersonRefundRequest {
  /** The site the money was taken on. */
  hostId: string
  /** The buyer's address as the sale recorded it. Raw: the owner normalizes it. */
  email: unknown
  /** Cents reversed by THIS refund, never the sale's total. */
  amountCents: number
  /** The silo's own document the money went back on — what a timeline entry points at. */
  refId: string
  /** True only for the refund that moved the sale into fully refunded. */
  closedTheSale: boolean
  /** `chargeback` for a dispute lost; a refund otherwise. */
  reason?: 'refund' | 'chargeback'
}

/**
 * What became of a refund. `recorded`; `no-email` for a sale that never
 * named its buyer; `no-person` for an address the workspace holds nobody at;
 * `gone` for a person removed between the sale and the refund.
 */
export type PluginPersonRefundOutcome = 'recorded' | 'no-email' | 'no-person' | 'gone'

export interface PluginPersonRecords {
  /** The person an address belongs to, or `null`. A read; may throw, and the caller decides which way a failure falls. */
  find(request: PluginPersonFindRequest): Promise<PluginPersonRecord | null>
  /** The records named, in the order asked; `null` for one that is gone. */
  read(request: PluginPersonReadRequest): Promise<Array<PluginPersonRecord | null>>
  /**
   * Files the person under the containers. Optional: an owner that keeps no
   * containers answers nothing. `filed: false` is a record the owner could
   * not find for the site.
   */
  fileUnder?(request: PluginPersonFileRequest): Promise<{ filed: boolean }>
  /** Records money handed back. Optional. Never throws: the money has already moved. */
  recordRefund?(request: PluginPersonRefundRequest): Promise<PluginPersonRefundOutcome>
}

export const PLUGIN_PERSON_RECORDS = definePluginServiceContract<PluginPersonRecords>(
  'core.person-records',
  { multiple: false },
)

/**
 * Registers the plugin that keeps people. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws, and a second plugin's service is refused naming both —
 * the incumbent keeps serving.
 */
export function registerPluginPersonRecords(
  records: PluginPersonRecords,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_PERSON_RECORDS, records, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

export interface ResolvedPluginPersonRecords {
  /** The plugin that keeps people. */
  pluginId: string
  records: PluginPersonRecords
}

/** The service with its owner, or `null` when no plugin keeps people here. */
export function pluginPersonRecords(): ResolvedPluginPersonRecords | null {
  const entry = resolvePluginServices(PLUGIN_PERSON_RECORDS)[0]
  return entry ? { pluginId: entry.pluginId, records: entry.impl } : null
}

/**
 * The person an address belongs to, or `null` — for nobody found, and for a
 * workspace no plugin keeps people for. A failed read is the owner's to
 * throw and the caller's to decide which way it falls.
 */
export async function findPluginPerson(
  request: PluginPersonFindRequest,
): Promise<PluginPersonRecord | null> {
  const resolved = pluginPersonRecords()
  if (!resolved) return null
  return await resolved.records.find(request)
}

/**
 * The records named, in the order asked, `null` for each that is gone — or
 * `null` whole when no plugin keeps people here, which is not "all gone".
 */
export async function readPluginPeople(
  request: PluginPersonReadRequest,
): Promise<Array<PluginPersonRecord | null> | null> {
  const resolved = pluginPersonRecords()
  if (!resolved) return null
  if (!request.records.length) return []
  return await resolved.records.read(request)
}

/**
 * Files the person under the containers through whichever plugin keeps
 * people, or answers `null` when none does or the one that does keeps no
 * containers. A failed write throws, as the caller's own write would have.
 */
export async function filePluginPersonUnder(
  request: PluginPersonFileRequest,
): Promise<{ filed: boolean } | null> {
  const resolved = pluginPersonRecords()
  if (!resolved?.records.fileUnder) return null
  if (!request.ids.length) return { filed: false }
  return await resolved.records.fileUnder(request)
}

/**
 * Hands a refund to whichever plugin keeps people, or answers `null` when
 * none does. Never throws: every caller has already moved the money and
 * recorded it on its own document, and a person's figure is derived from it.
 */
export async function recordPluginPersonRefund(
  request: PluginPersonRefundRequest,
): Promise<PluginPersonRefundOutcome | null> {
  const resolved = pluginPersonRecords()
  if (!resolved?.records.recordRefund) return null
  try {
    return await resolved.records.recordRefund(request)
  } catch (error) {
    console.error('[person-records] the record system could not record a refund', error)
    return null
  }
}
