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
  type HostContactCreated,
  upsertHostContact,
  type UpsertHostContactOptions,
  type UpsertHostContactVerdict,
} from '@aglyn/tenant-data-admin'
import { associateCompanyByDomain } from './associate-company-by-domain'
import { emitHostEvent } from './emit-host-event'
import type { HostEventPayload } from './run-event-workflows'

/**
 * THE contact capture door for a server path (AGL-2605).
 *
 * `upsertHostContact` writes the contact and reports, through its
 * `onCreated` hook, when the write made a NEW person. This wrapper is the
 * one place that hook is bound to `contactCreated`, and it is the function
 * every server door calls — the forms route, the membership and newsletter
 * handlers, the order and booking webhooks. A door that calls
 * `upsertHostContact` directly still captures the contact and fires nothing,
 * which is a contact no automation can welcome; `capture-host-contact.spec`
 * scans for exactly that call.
 *
 * ## Why the binding lives here and not in the data library
 *
 * The event fan-out — `runEventActions`, `runEventWorkflows` — imports the
 * data library for its Firestore handle, its org helpers and its senders.
 * The data library emitting an event would import the fan-out back, which
 * is a cycle, and the module boundaries (`scope:data` depends on data and
 * util only) refuse it in any case. So the lower layer reports a fact and
 * this layer, which already knows how to announce one, announces it. The
 * alternative — a process-global sink the runtime registers into on
 * import — would fire only in a process that happened to have loaded the
 * runtime, and a Stripe webhook that created a contact in a process that
 * had not would announce nothing with no error anywhere.
 *
 * Fire-and-forget in the same sense the capture itself is: the hook's
 * failure is caught inside `upsertHostContact`, so a runner that throws
 * costs the door nothing, and this function never rejects.
 *
 * ## The company, before the announcement (AGL-2613)
 *
 * A new person with a work email address is linked to the company at that
 * domain here, in the same hook, BEFORE `contactCreated` goes out — so an
 * automation that reads the new contact finds them already filed, rather
 * than racing a link that lands a moment later. Only when the door did not
 * name a company itself: the console's drawer and an import row that
 * carried one have written it into the facet, and the capture must not
 * second-guess a person's choice with a domain match. The association never
 * rejects, and its own catch keeps a failed lookup from costing the event.
 */
export async function captureHostContact(
  options: Omit<UpsertHostContactOptions, 'onCreated'>,
): Promise<UpsertHostContactVerdict> {
  return upsertHostContact({
    ...options,
    onCreated: async (created) => {
      if (!options.facet?.companyId) {
        await associateCompanyByDomain(created).catch((error: unknown) => {
          console.error('captureHostContact company association failed', error)
        })
      }
      await emitHostEvent(
        created.hostId,
        'contactCreated',
        contactCreatedPayload(created),
      )
    },
  })
}

/**
 * The `contactCreated` payload, as the scalars an event may carry.
 *
 * `HostEventPayload` holds strings, numbers and booleans and nothing
 * nested, because the payload seeds an expression scope and a condition
 * editor whose operators compare strings. So `campaignIds` rides as one
 * comma-joined string — `contains` still finds a campaign in it — and is
 * present only when the capture had campaigns, so `notEmpty` on it reads
 * as "came in through a campaign form". `name` is always present, empty
 * when the door had none, so a condition on it never sees a missing key.
 */
export function contactCreatedPayload(
  created: HostContactCreated,
): HostEventPayload {
  return {
    contactId: created.contactId,
    email: created.email,
    name: created.name ?? '',
    source: created.source,
    hostId: created.hostId,
    ...(created.campaignIds.length
      ? { campaignIds: created.campaignIds.join(',') }
      : {}),
  }
}

export default captureHostContact
