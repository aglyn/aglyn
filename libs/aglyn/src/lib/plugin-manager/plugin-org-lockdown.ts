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
 * WHAT A WORKSPACE LOCK REACHES IN A PLUGIN (AGL-3365).
 *
 * The lockdown is core; what a workspace owns inside a plugin is the
 * plugin's. Two seams, beside `core.recurring-charge-sources` (AGL-3364):
 *
 * - `core.payout-account-sources` — the connected accounts a plugin pays a
 *   workspace through, beyond the storefront account core already knows
 *   (the owner's profile). A lock that pauses payouts pauses every one, and
 *   saves and restores each one's schedule on its own. The marketplace
 *   declares its publisher account here.
 * - `core.org-lockdown-participants` — told when a workspace is locked or
 *   lifted, whatever the reason, after the lock is durable. The marketplace
 *   takes the workspace's listings out of browse and puts back exactly the
 *   ones it took.
 *
 * Neither may undo a lock: a participant that throws is reported as an
 * unconfirmed step beside a lock that stands.
 *=========================================*/

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Where a lock records each payout schedule it paused (Admin SDK only; no
 * client rule opens it). Named here, in core, so a plugin that manages a
 * schedule of its own can tell that a lock holds the account and leave it be.
 */
export const LOCKDOWN_BILLING_PAUSES_COLLECTION = 'lockdownBillingPauses'

/** The pause record's id for one connected account. */
export function lockdownPayoutPauseRecordId(accountId: string): string {
  return `payout_${accountId}`
}

/** One connected account a plugin pays a workspace through. */
export interface PayoutAccountRecord {
  /** The payment provider's account id (Stripe `acct_…`). */
  accountId: string
  /** How staff read it: `marketplace publisher`. */
  label: string
}

export interface PayoutAccountSource {
  /** The connected accounts this plugin pays `orgId` through. */
  listPayoutAccounts(input: { orgId: string }): Promise<PayoutAccountRecord[]>
}

export const PLUGIN_PAYOUT_ACCOUNT_SOURCES =
  definePluginServiceContract<PayoutAccountSource>('core.payout-account-sources', {
    multiple: true,
  })

/** Declares the connected accounts a plugin pays workspaces through. */
export function registerPayoutAccountSource(
  source: PayoutAccountSource,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_PAYOUT_ACCOUNT_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Every declared payout-account source, with the plugin that declared it. */
export function listPayoutAccountSources(): Array<{
  pluginId: string
  source: PayoutAccountSource
}> {
  return resolvePluginServices(PLUGIN_PAYOUT_ACCOUNT_SOURCES).map((entry) => ({
    pluginId: entry.pluginId,
    source: entry.impl,
  }))
}

/** What a participant reports back for the staff log. */
export interface OrgLockdownParticipantResult {
  /** One line a staff member reads: "Hid 3 marketplace listings". */
  summary: string
  confirmed: boolean
}

export interface OrgLockdownParticipant {
  /** The workspace was locked (any reason), or lifted. */
  onOrgLockChange(input: {
    orgId: string
    locked: boolean
    reason: string | null
  }): Promise<OrgLockdownParticipantResult>
}

export const PLUGIN_ORG_LOCKDOWN_PARTICIPANTS =
  definePluginServiceContract<OrgLockdownParticipant>('core.org-lockdown-participants', {
    multiple: true,
  })

/** Declares a plugin's part in a workspace lock. */
export function registerOrgLockdownParticipant(
  participant: OrgLockdownParticipant,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_ORG_LOCKDOWN_PARTICIPANTS, participant, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * Tell every participant, one by one. Never throws: a participant that fails
 * comes back as an unconfirmed line with its error.
 */
export async function runOrgLockdownParticipants(input: {
  orgId: string
  locked: boolean
  reason: string | null
}): Promise<Array<{ pluginId: string } & OrgLockdownParticipantResult>> {
  const results: Array<{ pluginId: string } & OrgLockdownParticipantResult> = []
  for (const entry of resolvePluginServices(PLUGIN_ORG_LOCKDOWN_PARTICIPANTS)) {
    try {
      results.push({ pluginId: entry.pluginId, ...(await entry.impl.onOrgLockChange(input)) })
    } catch (error) {
      results.push({
        pluginId: entry.pluginId,
        summary: `Did not run: ${(error as Error)?.message ?? String(error)}`,
        confirmed: false,
      })
    }
  }
  return results
}
