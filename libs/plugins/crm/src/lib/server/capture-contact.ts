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

import type {
  PluginContactCaptureRequest,
  PluginContactCaptured,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import {
  CONTACT_SOURCE_LABELS,
  type ContactSource,
} from '@aglyn/aglyn/app-utils/contacts'
import {
  type CrmLeadFields,
  isCrmLeadOpen,
  normalizeContactEmail,
  personKey,
} from '@aglyn/aglyn/server'
import { captureHostContact } from '@aglyn/tenant-runtime/capture-host-contact'
import { convertOpenLeadOntoContact } from '@aglyn/tenant-runtime/convert-lead-on-contact'
import { emitHostEvent } from '@aglyn/tenant-runtime/emit-host-event'
import {
  addHostLead,
  findContactByEmail,
  firebaseAdmin,
  orgDataCollectionForHost,
  type UpsertHostContactOptions,
} from '@aglyn/tenant-data-admin'
import type { ResolvedCampaignTouch } from '@aglyn/tenant-data-admin/server/campaign-conversion-attribution'

/**
 * The CRM answering the platform's contact-capture contract (AGL-3080).
 *
 * Four silos meet the same person — a form submission, a member signing up,
 * an order, a booking — and none of them is the record system. Each holds an
 * address, a name and the fact that something happened, and each wants the
 * workspace's person record to know. Today each imports `captureHostContact`
 * directly, which is the highest fan-in edge in the repo and makes the CRM
 * something a storefront cannot take a payment without.
 *
 * So this is the CRM's side of the seam: the silo reports what it saw, and
 * the plugin that keeps people decides everything a record system decides —
 * keying the address, whether this is somebody new, the audience band, the
 * erasure rows, the company, the owner, and what a new person sets off.
 * `captureHostContact` already does all of that; this translates the
 * contract's vocabulary into its options and its verdict back.
 *
 * ⚠️ IT NEVER THROWS. Every caller has already done the thing it is
 * recording — the submission was accepted, the order was paid — so a refusal
 * is RETURNED and costs the silo nothing. A throw here would lose an order
 * for a contact that could not be filed.
 */
/**
 * WHICH RECORD A CAPTURE LANDS ON (AGL-3232) — the Salesforce rule, decided
 * here because the CRM is the plugin that models both records.
 *
 * One person is one record: a LEAD until somebody qualifies them, a CONTACT
 * after. Every door used to write both — a lead-routed form filed a lead
 * AND a contact at stage Lead — so one person sat in two lists and the Leads
 * queue was never the whole story. Now a door says what kind of surface it
 * is (`request.surface`) and this decides:
 *
 *  - a LEAD surface files a lead, unless the workspace already holds the
 *    address as a contact — a customer who books a demo is a customer's
 *    interaction, not a new lead — in which case the capture lands on the
 *    contact and no lead is filed;
 *  - a RELATIONSHIP (a member account, a purchase) makes the contact, and
 *    an open lead the site held for the address is stamped converted onto
 *    it, so nobody keeps working a lead who already joined or bought;
 *  - a TOUCH (an unrouted form, a newsletter opt-in) lands on the open lead
 *    when the site holds one — its consent and its history stay on the one
 *    record the rep is working — and on the contact otherwise.
 *
 * A lead is filed through `addHostLead`, the one writer of the leads silo,
 * so it is keyed on the person, counted against the ceiling and carries the
 * campaign touch the door resolved. A NEW lead announces itself with the
 * `lead` host event, which is what a "new lead" automation listens for; a
 * repeat capture on a lead the site already held announces nothing, the
 * way a repeat visit by a contact is an interaction and not a creation.
 */
export async function captureContactForCrm(
  request: PluginContactCaptureRequest,
): Promise<PluginContactCaptured> {
  const surface = request.surface ?? 'touch'
  // The one refusal every surface shares, answered before any read: an
  // address nothing can key is a person nothing can record.
  if (!normalizeContactEmail(request.identity.email)) return refusedEmail()
  try {
    if (surface === 'lead') {
      if (!(await heldAsContact(request))) return await fileLead(request)
    } else if (surface === 'touch') {
      if (await openLeadFor(request)) return await fileLead(request)
    }
    const verdict = await captureOnContact(request)
    if (verdict.ok && verdict.record === 'contact' && surface === 'relationship') {
      await convertOpenLeadOntoContact({
        hostId: request.hostId,
        email: request.identity.email,
        contactId: verdict.contactId,
        by: request.interaction.source === 'member' ? 'signup' : 'purchase',
      })
    }
    return verdict
  } catch (error) {
    console.error('crm contact capture failed', error)
    return {
      ok: false,
      reason: 'error',
      error: 'The contact could not be recorded. Nothing else was affected.',
    }
  }
}

/** The refusal every door gets for an address nothing can key. */
function refusedEmail(): PluginContactCaptured {
  return { ok: false, reason: 'invalid-email', error: refusalText('invalid-email') }
}

/**
 * Whether the workspace already holds the address as a contact — the
 * address index first, then the query, the same lookup every dedupe uses.
 * ORG-wide, not scoped to the capturing site: the contact door dedupes
 * across every site in the org, so a person any site holds as a contact
 * is a contact, whichever site met them this time.
 */
async function heldAsContact(request: PluginContactCaptureRequest): Promise<boolean> {
  const contacts = await orgDataCollectionForHost(request.hostId, 'contacts')
  return (await findContactByEmail(contacts, request.identity.email)) !== null
}

/** Whether the site holds an OPEN lead for the address — neither converted nor closed. */
async function openLeadFor(request: PluginContactCaptureRequest): Promise<boolean> {
  const key = personKey(request.identity.email) as string
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(request.hostId)
    .collection('leads')
    .doc(key)
    .get()
  if (!snapshot.exists) return false
  const lead = (snapshot.data() ?? {}) as Record<string, unknown> & CrmLeadFields
  return !lead.convertedContactId && isCrmLeadOpen(lead)
}

/**
 * The capture as a LEAD. The source string is the lead silo's own
 * vocabulary — `form:{formId}` for a form, the door's word otherwise — so
 * a lead's provenance survives the form being renamed, as the submission's
 * does.
 */
async function fileLead(request: PluginContactCaptureRequest): Promise<PluginContactCaptured> {
  const email = normalizeContactEmail(request.identity.email) as string
  const key = personKey(email) as string
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(request.hostId)
  const leadRef = hostRef.collection('leads').doc(key)
  const created = !(await leadRef.get()).exists
  const { formId } = entryPointOf(request.detail)
  const source =
    request.interaction.source === 'form' && formId
      ? `form:${formId}`
      : request.interaction.source
  const stored = await addHostLead({
    hostRef,
    hostId: request.hostId,
    lead: {
      email,
      ...(request.identity.name ? { name: request.identity.name } : {}),
      source,
      ...(request.marketingConsent ? { marketingConsent: true } : {}),
    },
    ...(campaignTouchOf(request.detail).campaignTouch
      ? { touch: campaignTouchOf(request.detail).campaignTouch }
      : {}),
  })
  if (!stored) {
    return {
      ok: false,
      reason: 'band',
      error: 'This site is at the number of leads it may hold, so the lead was not recorded.',
    }
  }
  if (created) {
    await emitHostEvent(request.hostId, 'lead', {
      email,
      source,
      leadId: key,
      ...(request.identity.name ? { name: request.identity.name } : {}),
    })
  }
  return { ok: true, record: 'lead', leadId: key, created }
}

/** The capture as a CONTACT — what every capture was before the rule above. */
async function captureOnContact(
  request: PluginContactCaptureRequest,
): Promise<PluginContactCaptured> {
  try {
    const verdict = await captureHostContact({
      hostId: request.hostId,
      email: request.identity.email,
      ...(request.identity.name ? { name: request.identity.name } : {}),
      source: contactSourceOf(request.interaction.source),
      interaction: {
        ...(request.interaction.atMs === undefined
          ? {}
          : { atMs: request.interaction.atMs }),
        ...(request.interaction.refId ? { refId: request.interaction.refId } : {}),
        ...(request.interaction.summary
          ? { summary: request.interaction.summary }
          : {}),
        ...entryPointOf(request.detail),
      },
      ...campaignTouchOf(request.detail),
      ...(request.marketingConsent === undefined
        ? {}
        : { marketingConsent: request.marketingConsent }),
      ...(request.tags?.length ? { tags: request.tags } : {}),
      ...(request.campaignIds?.length ? { campaignIds: request.campaignIds } : {}),
      ...(request.purchaseCents === undefined
        ? {}
        : { purchaseCents: request.purchaseCents }),
      ...(request.purchaseCurrency
        ? { purchaseCurrency: request.purchaseCurrency }
        : {}),
      ...(request.lifecycleFloor
        ? { initialLifecycleStage: request.lifecycleFloor as never }
        : {}),
      ...(request.profile ? { facet: request.profile as never } : {}),
    })
    if ('refused' in verdict) {
      return { ok: false, reason: verdict.refused, error: refusalText(verdict.refused) }
    }
    return {
      ok: true,
      record: 'contact',
      contactId: verdict.contactId,
      created: verdict.created,
    }
  } catch (error) {
    /*
     * The contract's `error` is the last state, not a channel for a stack:
     * a silo may show or log it as it stands, so it says what happened and
     * names nothing internal. The detail goes to the log, where whoever is
     * debugging a missing contact will look.
     */
    console.error('crm contact capture failed', error)
    return {
      ok: false,
      reason: 'error',
      error: 'The contact could not be recorded. Nothing else was affected.',
    }
  }
}

/**
 * THE ENTRY POINT, off the silo's own `detail` bag (AGL-3080).
 *
 * The contract carries a capture's silo-side facts opaquely, so the two the
 * CRM models are picked out here rather than typed into the platform. Both
 * ride the INTERACTION, which is where `upsertHostContact` already keeps
 * them: which form a person came in through routes the owner-assignment
 * rules and rides the `contactCreated` payload, and the page is what a
 * timeline row says about where they were.
 *
 * Absent, misspelled or the wrong type is the same answer as a door that
 * never had one — a capture without an entry point, which is every capture
 * that did not come through a form. It is never a reason to refuse: the
 * person is the part that matters.
 */
function entryPointOf(
  detail: Readonly<Record<string, unknown>> | undefined,
): { formId?: string; path?: string } {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value : undefined
  const formId = text(detail?.['formId'])
  const path = text(detail?.['path'])
  return {
    ...(formId ? { formId } : {}),
    ...(path ? { path } : {}),
  }
}

/**
 * WHERE THE VISITOR CAME FROM, off the same bag.
 *
 * ⚠️ A different fact from `campaignIds` and the two must never be folded
 * together — `upsert-contact.ts` says so at the field itself. A touch is the
 * ad or the link the visitor arrived by, already resolved through the
 * allowlist by the silo; `campaignIds` is which campaigns the merchant filed
 * the capture SURFACE under, which is true of everybody who fills that form
 * in. Folding them would credit a campaign for a visitor who typed the
 * address.
 *
 * Passed through as the silo resolved it, unread: the touch's shape belongs
 * to whatever resolves it, and re-validating it here would be a second copy
 * of a rule that has already run. Only its presence is decided here, because
 * `null` and absent mean the same thing to the writer and a caller should
 * not have to know which one it sends.
 */
function campaignTouchOf(
  detail: Readonly<Record<string, unknown>> | undefined,
): Pick<UpsertHostContactOptions, 'campaignTouch'> {
  const touch = detail?.['campaignTouch']
  return touch ? { campaignTouch: touch as ResolvedCampaignTouch } : {}
}

/**
 * The silo's word for its door, as a source the CRM stores.
 *
 * ⚠️ `ContactSource` is a CLOSED union and the contract's `source` is an open
 * string, deliberately: a silo declares its door with
 * `registerPluginContactSource` rather than core enumerating every plugin's.
 * The two meet here, and a word outside the union is passed through rather
 * than rejected — refusing it would lose a third-party plugin's capture over
 * a label, and the capture is the part that matters.
 *
 * ⛔ What it costs, until the union is widened: the console's source filter
 * and `SOURCE_LABELS` key on these values, so an undeclared word renders raw
 * and matches no filter. Every first-party silo uses a word in the union, so
 * nothing does that today.
 */
export function contactSourceOf(source: string): ContactSource {
  const word = String(source ?? '').trim()
  if (!Object.hasOwn(CONTACT_SOURCE_LABELS, word)) {
    // Said once, where somebody debugging an unlabelled row will find it.
    // Not a refusal: the capture is worth more than the label.
    console.warn(
      `crm contact capture: source "${word}" has no label, so it will render ` +
        'raw and match no filter in the console.',
    )
  }
  return word as ContactSource
}

/** What a refused caller is told — customer-safe, and never a key. */
function refusalText(reason: 'invalid-email' | 'band' | 'erased' | 'error'): string {
  switch (reason) {
    case 'invalid-email':
      return 'That address could not be read, so no contact was recorded.'
    case 'band':
      return 'This workspace is at the number of contacts its plan holds.'
    case 'erased':
      return 'This person was erased from this workspace and was not recreated.'
    default:
      return 'The contact could not be recorded. Nothing else was affected.'
  }
}
