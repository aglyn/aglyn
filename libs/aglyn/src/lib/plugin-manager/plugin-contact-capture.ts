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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A person met on a site, handed to whichever plugin keeps people (AGL-3124).
 *
 * Four silos capture the same thing and none of them is the record system: a
 * form submission, a site member signing up, an order, a booking. Each holds
 * an address, a name and the fact that something happened, and each wants the
 * workspace's person record to know. Today each one imports the writer, which
 * makes the highest-fan-in edge in the repo — thirty files in one plugin alone
 * — and makes the record system's plugin something a storefront cannot take a
 * payment without.
 *
 * So the silo stops importing and starts DECLARING: it registers the capture
 * door it owns, and hands a capture to this seam. The plugin that keeps people
 * registers the writer and does every part of the work that is a record
 * system's to do:
 *
 *  - normalizing and keying the address, and deciding whether this is a new
 *    person or a visit from one the workspace already holds;
 *  - the audience band, the erasure rows, and every other refusal — answered,
 *    never thrown, so a capture that is refused never costs the silo the order
 *    or the submission it was recording;
 *  - what a stage, an owner, a company and a tag mean, and what the arrival
 *    of a new person sets off.
 *
 * The silo decides none of that. It reports what it saw.
 *
 * ## Why the profile is opaque
 *
 * `profile` is the owner's own field names with scalar values, not a core
 * type. A person's record shape belongs to the plugin that models it, and a
 * typed core shape would be that model spelled in the platform again — which
 * is the defect this seam exists to retire, not a smaller version of it. A key
 * the owner does not document is the owner's to ignore.
 *
 * `source` is the silo's own word for its door, and it is declared rather than
 * enumerated here for the same reason: core listing `form`, `member`, `order`
 * and `booking` would be core holding the plugin set again. A silo registers
 * its source with {@link registerPluginContactSource}, which is what lets a
 * timeline label an entry and a link point back at the thing that captured the
 * person, without the platform knowing what any of them are.
 *
 * ## One writer; many silos
 *
 * A workspace keeps one set of people, so the writer is a slot: a second
 * plugin's writer is refused naming both, and the incumbent keeps serving. A
 * SOURCE is per silo and there are many, but one source word has one owner —
 * two plugins claiming `order` would make the label and the link ambiguous at
 * the point they are read.
 *
 * ## The caller proves who is asking
 *
 * Like `plugin-record-timeline`, the registry authenticates nobody. A silo has
 * already decided, in its own terms and before it asks, that the capture is
 * the workspace's to record — that the submission was accepted, that the order
 * was paid.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

/** The person, as the capturing silo saw them. */
export interface PluginContactIdentity {
  /**
   * The address they gave. Raw: the owner normalizes and keys on it, and a
   * silo that normalized first would be keeping a second copy of that rule.
   */
  email: unknown
  name?: string | null
}

/** What happened, in the capturing silo's own words. */
export interface PluginContactInteraction {
  /** The silo's declared source word — see {@link registerPluginContactSource}. */
  source: string
  /** When it happened, epoch ms; the owner uses now when absent. */
  atMs?: number
  /**
   * The document it happened on, in the silo's terms
   * (`formSubmissions/{id}`, `orders/{id}`), so a timeline entry can point
   * back at it. Absent where the door leaves nothing to open.
   */
  refId?: string | null
  /** One line a person reads on the timeline. */
  summary?: string | null
}

export interface PluginContactCaptureRequest {
  orgId: string
  /** The site the person was met on: the brand whose form or checkout it was. */
  hostId: string
  identity: PluginContactIdentity
  interaction: PluginContactInteraction
  /**
   * An explicit marketing opt-in the capture surface carried, recorded against
   * `hostId`. Absent is not consent, and filing a capture under a campaign is
   * not consent either.
   */
  marketingConsent?: boolean
  /**
   * The disclosure key the capture surface rendered beside that opt-in
   * (`consentGroupDisclosureKey`, AGL-3320), passed through as the surface
   * sent it. The owner records the opt-in for the site's whole consent group
   * only when this is the group's current key, and for `hostId` alone
   * otherwise — so a silo whose surface shows no disclosure sends none.
   */
  disclosedConsentGroup?: string
  /** Tags the silo puts on this capture; the owner adds, never replaces. */
  tags?: readonly string[]
  /** The campaigns the capture SURFACE is filed under — the merchant's own act. */
  campaignIds?: readonly string[]
  /** Money the capture was worth, in cents, where the silo took some. */
  purchaseCents?: number
  /** The currency {@link purchaseCents} is in, lowercase, when the silo knows. */
  purchaseCurrency?: string
  /**
   * The earliest stage this capture describes, in the OWNER's words. A floor
   * and not a value: the owner fills an empty stage and advances an earlier
   * one, and never moves anybody back, so a repeat customer filling in a
   * contact form is still a customer.
   */
  lifecycleFloor?: string
  /**
   * What kind of door this is, which decides WHICH RECORD the person lands
   * on (AGL-3232) — the owner's rule is Salesforce's: one person is one
   * record, a lead until they are qualified and a contact after.
   *
   * - `lead`: a lead surface — a form whose author routes it to leads, a
   *   booking request. The person is filed as a LEAD and nothing else,
   *   unless the workspace already holds them as a contact, in which case
   *   the capture lands on the contact and no lead is filed.
   * - `relationship`: an act that makes the person a known relationship —
   *   a member account, a purchase. The person is filed as a CONTACT, and
   *   an open lead the site held for them is stamped converted onto it.
   * - `touch`, the default: everything else — a form without lead routing,
   *   a newsletter opt-in. The capture lands on the open lead when the site
   *   holds one for the address, and on the contact otherwise.
   */
  surface?: 'lead' | 'relationship' | 'touch'
  /**
   * Profile fields the silo knows, keyed by the owner's own field names.
   * Only the keys given are written, so a silo that knows the phone number
   * does not blank a title somebody typed.
   */
  profile?: Readonly<Record<string, unknown>>
  /**
   * Facts about THIS CAPTURE that the owner models and the platform does not
   * (AGL-3080) — which form was filled in, which page it was on, where the
   * visitor arrived from.
   *
   * Opaque for the reason {@link profile} is: every one of these is a concept
   * belonging to the plugin that keeps people or to the silo that saw it, and
   * a typed core field for each would be those models spelled out in the
   * platform again. `profile` describes the PERSON and outlives the visit;
   * this describes the visit and does not.
   *
   * A key the owner does not recognize is the owner's to ignore, and a silo
   * that sends nothing here loses nothing: every field is an enrichment of a
   * capture that is already complete without it.
   */
  detail?: Readonly<Record<string, unknown>>
}

/**
 * The owner's answer. `created: false` is a visit by somebody the workspace
 * already held, which is an interaction and not a new person.
 *
 * A refusal is RETURNED. Every one of these silos has already done the thing
 * it was recording, so a throw here would cost an accepted submission or a
 * paid order for a record it could not keep.
 */
export type PluginContactCaptured =
  /** The capture landed on a contact — the record every capture used to make. */
  | { ok: true; record: 'contact'; contactId: string; created: boolean }
  /**
   * The capture landed on a LEAD (AGL-3232): a lead surface met somebody the
   * workspace does not hold as a contact, or a touch reached an open lead.
   * `leadId` is the person key the lead is filed under on `hostId`.
   */
  | { ok: true; record: 'lead'; leadId: string; created: boolean }
  | {
      ok: false
      /**
       * `invalid-email`: nothing usable to key a person on. `band`: the
       * workspace is at the audience it may hold. `erased`: the workspace
       * erased this person and a capture must not quietly rebuild them.
       * `error`: the owner failed, and said so rather than silently.
       */
      reason: 'invalid-email' | 'band' | 'erased' | 'error'
      /** Customer-safe: a caller may show or log it as it stands. */
      error: string
    }

export interface PluginContactCaptureWriter {
  /** Records one capture; a refusal is returned, never thrown. */
  capture(
    request: PluginContactCaptureRequest,
  ): Promise<PluginContactCaptured>
}

/** A capture door a silo owns. */
export interface PluginContactSourceDeclaration {
  /** The silo's word for the door, as its captures carry it. */
  source: string
  /** What a timeline entry from this door says: `Form submission`. */
  label: string
  /**
   * What a link from that entry says when there is something to open —
   * `Open submission`. Absent where the door leaves nothing to open, which
   * is the honest answer for an import or a by-hand add.
   */
  openLabel?: string
  /**
   * The record kind the silo's own document is, for
   * `plugin-record-routes` to address it with. Absent where the door has no
   * record of its own to open.
   */
  recordKind?: string
}

/** A source declaration with the silo that made it. */
export type ResolvedPluginContactSource = PluginContactSourceDeclaration & {
  pluginId: string
}

export const PLUGIN_CONTACT_CAPTURE =
  definePluginServiceContract<PluginContactCaptureWriter>(
    'core.contact-capture',
    { multiple: false },
  )

export const PLUGIN_CONTACT_SOURCES =
  definePluginServiceContract<PluginContactSourceDeclaration>(
    'core.contact-capture-sources',
    { multiple: true },
  )

/**
 * Registers the plugin that keeps people. The owner is the loader's marker
 * when a register fn is running, else `options.pluginId`; with neither the
 * registration throws, and a second plugin's writer is refused naming both —
 * the incumbent keeps serving.
 */
export function registerPluginContactCaptureWriter(
  writer: PluginContactCaptureWriter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_CONTACT_CAPTURE, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Declares a capture door. One source word has one owner. */
export function registerPluginContactSource(
  declaration: PluginContactSourceDeclaration,
  options?: { pluginId?: string },
): void {
  const key = declaration.source?.trim() ?? ''
  if (!key) throw new Error('a contact capture source needs a source word')
  if (!declaration.label?.trim()) {
    throw new Error(`contact capture source "${key}" needs a label`)
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_CONTACT_SOURCES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `contact capture source "${key}" is already declared by ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(
    PLUGIN_CONTACT_SOURCES,
    { ...declaration, source: key },
    {
      ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
      key,
    },
  )
}

export interface ResolvedPluginContactCaptureWriter {
  /** The plugin that keeps people. */
  pluginId: string
  writer: PluginContactCaptureWriter
}

/** The writer with its owner, or `null` when no plugin keeps people here. */
export function pluginContactCaptureWriter(): ResolvedPluginContactCaptureWriter | null {
  const entry = resolvePluginServices(PLUGIN_CONTACT_CAPTURE)[0]
  return entry ? { pluginId: entry.pluginId, writer: entry.impl } : null
}

/**
 * Hands one capture to the plugin that keeps people, or answers `null` when
 * no plugin does.
 *
 * `null` and a refusal are different answers and a silo treats them
 * differently: `null` is a workspace with no record system, where there is
 * nothing to record and nothing has gone wrong; a refusal is a record system
 * that considered this person and declined.
 */
export async function capturePluginContact(
  request: PluginContactCaptureRequest,
): Promise<PluginContactCaptured | null> {
  const found = pluginContactCaptureWriter()
  if (!found) return null
  return found.writer.capture(request)
}

/** Every declared capture door, with its silo, in registration order. */
export function listPluginContactSources(): ResolvedPluginContactSource[] {
  return resolvePluginServices(PLUGIN_CONTACT_SOURCES).map((entry) => ({
    ...entry.impl,
    pluginId: entry.pluginId,
  }))
}

/** One declared capture door by its source word, or `null`. */
export function pluginContactSource(
  source: string,
): ResolvedPluginContactSource | null {
  const key = source.trim()
  const entry = resolvePluginServices(PLUGIN_CONTACT_SOURCES).find(
    (one) => one.key === key,
  )
  return entry ? { ...entry.impl, pluginId: entry.pluginId } : null
}
