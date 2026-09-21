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
import { captureHostContact } from '@aglyn/tenant-runtime/capture-host-contact'

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
export async function captureContactForCrm(
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
      },
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
    return { ok: true, contactId: verdict.contactId, created: verdict.created }
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
