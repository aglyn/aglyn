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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import type {
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  applyStoreSetupChange,
  readStoreSetupChange,
  storeSetupFacts,
  type StoreSetupLocation,
} from '../model/store-setup-content'

/*==========================================
 * THE STORE'S SHIPPING AND TAX SETUP AN AI BUILD CHANGES (AGL-3749)
 *
 * The writer commerce registers for the `store-settings` resource on core's
 * resource-drafts seam, which the `store-shipping`, `store-pickup`,
 * `store-delivery` and `store-tax` build operations execute
 * (`store-setup-ai-capability.ts`). It writes exactly what the console's
 * Shipping, Local delivery, Taxes and Inventory locations cards write:
 *
 *  - who: an admin or an editor on the site (`hostRoleCanPublish`), the
 *    plan's `commerce` feature, and no lockdown refusing a write to the site, its workspace or
 *    the member (`hostWritesFrozen`). The role is stricter than the cards,
 *    which the Firestore rules let an author save too (`canWriteHostContent`):
 *    these settings change what checkout charges, and an AI change of them
 *    is live at once, so it takes the publishing role (Zach, 2026-10-12);
 *  - what: the change is read and applied by `store-setup-content.ts`,
 *    through the cards' own normalizers and checks — the zone-coverage
 *    summary, the pickup and delivery normalizers, delivery's "can't offer
 *    it yet" problems, and the manual-tax-without-an-origin refusal;
 *  - how: one map of `settings/store` replaced whole (`mergeFields`, as the
 *    Local delivery card saves), or one location's `pickup` (as the
 *    Inventory locations card saves), inside a transaction, so two items of
 *    one plan changing the same map never lose each other's change.
 *
 * Store settings have no draft state: the cards save them live, and so does
 * this. The plan card is where the person agrees to the change.
 *
 * Asked again for the same change, it writes nothing: a zone, a rate, a
 * delivery zone and a tax rate are found by name or region before anything
 * is added, a new one takes an id derived from the request, and a change the
 * settings already hold is reported as done (`replayed`).
 *
 * Nothing here connects an account or stores a credential: carrier rates and
 * outside tax services are set up by a person in their own cards.
 *=========================================*/

type Firestore = FirebaseFirestore.Firestore
type Stored = Record<string, unknown>

/** The refusal for a member without the publishing role (admin or editor). */
/** Names "Publish site content" (`site.publish`, AGL-4047): store settings are live the moment they change. */
export const STORE_SETUP_ROLE_REFUSAL = siteKeyRefusal('site.publish')
/** The refusal for a plan without commerce. */
export const STORE_SETUP_PLAN_REFUSAL = 'Selling online is not included in your plan — see Billing'
/** What a member is told while a lockdown refuses writes to the site. */
export const STORE_SETUP_LOCKED_REFUSAL = 'This site is not accepting changes right now.'

/** Whether a lockdown refuses this member's write to this site; `true` refuses. */
export type StoreSetupLockdownCheck = (input: {
  uid: string
  org: PluginDraftContext['org']
  host: Stored
}) => Promise<boolean>

export interface StoreSetupAiWriterDeps {
  firestore: () => Firestore
  lockdown: StoreSetupLockdownCheck
}

const SECTION_NAMES: Record<string, string> = {
  shipping: 'Shipping',
  pickup: 'Local pickup',
  'local-delivery': 'Local delivery',
  tax: 'Taxes',
}

function locationOf(id: string, data: Stored): StoreSetupLocation {
  const postal = (data['postalAddress'] ?? {}) as Stored
  return {
    id,
    name: typeof data['name'] === 'string' ? data['name'] : undefined,
    address: typeof data['address'] === 'string' ? data['address'] : undefined,
    city: typeof postal['city'] === 'string' ? (postal['city'] as string) : undefined,
    pickup: data['pickup'],
  }
}

export function createStoreSetupAiWriter(deps: StoreSetupAiWriterDeps): PluginResourceDraftWriter {
  const hostRef = (hostId: string) => deps.firestore().collection('hosts').doc(hostId)
  const settingsRef = (hostId: string) => hostRef(hostId).collection('settings').doc('store')

  async function refusalFor(
    host: FirebaseFirestore.DocumentSnapshot,
    context: Pick<PluginDraftContext, 'uid' | 'org'>,
  ): Promise<PluginDraftRefusal | null> {
    if (!host.exists) return { status: 404, error: 'Unknown site' }
    const data = (host.data() ?? {}) as Stored
    if (!holdsSiteKey(data, context.uid, 'site.publish')) return { status: 403, error: STORE_SETUP_ROLE_REFUSAL }
    if (!checkEntitlement((context.org ?? {}) as never, 'commerce')) {
      return { status: 403, error: STORE_SETUP_PLAN_REFUSAL }
    }
    if (await deps.lockdown({ uid: context.uid, org: context.org, host: data })) {
      return { status: 403, error: STORE_SETUP_LOCKED_REFUSAL }
    }
    return null
  }

  return {
    refusal: async (context) => refusalFor(await hostRef(context.hostId).get(), context),

    check: (content) => {
      const read = readStoreSetupChange(content)
      if (read.ok === false) return { ok: false, problems: read.problems }
      return { ok: true, facts: { section: read.value.section, live: true } }
    },

    // The settings are one document, not one per change: whatever id is
    // asked, the store's setup as it stands.
    read: async ({ hostId, id }): Promise<PluginDraftRecord | null> => {
      const snapshot = await settingsRef(hostId).get()
      if (!snapshot.exists) return null
      return { id, name: 'Store settings', versionId: null, facts: storeSetupFacts((snapshot.data() ?? {}) as Stored) }
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readStoreSetupChange(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] as string }
      const change = read.value
      const refusal = await refusalFor(await hostRef(request.hostId).get(), request)
      if (refusal) return { ok: false, ...refusal }
      const needsLocations = 'location' in change && Boolean(change.location)
      const db = deps.firestore()
      const ref = settingsRef(request.hostId)
      const locations = hostRef(request.hostId).collection('locations')
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [settings, places] = await Promise.all([
          tx.get(ref),
          needsLocations ? tx.get(locations) : Promise.resolve(null),
        ])
        const applied = applyStoreSetupChange(
          {
            settings: (settings.data() ?? {}) as Stored,
            locations: (places?.docs ?? []).map((doc) => locationOf(doc.id, (doc.data() ?? {}) as Stored)),
          },
          change,
          { zoneId: `${request.id}-zone`, rateId: `${request.id}-rate` },
        )
        if (applied.ok === false) return { ok: false, status: applied.status, error: applied.error }
        const write = applied.write
        if (write?.target === 'settings') {
          tx.set(ref, { [write.field]: write.value }, { mergeFields: [write.field] })
        } else if (write?.target === 'location') {
          // The card's `updateDoc`: the map replaced whole, so a cleared field is cleared.
          tx.update(locations.doc(write.locationId), { pickup: write.value })
        }
        return {
          ok: true,
          replayed: write === null,
          // One per item: the settings are one document, so the item names the change.
          id: request.id,
          name: request.name.trim() || SECTION_NAMES[change.section] || 'Store settings',
          versionId: null,
          facts: { section: change.section, summary: applied.summary, warnings: applied.warnings, live: true },
        }
      })
    },
  }
}
