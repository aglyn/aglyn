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

/**
 * WHO MAY WAIVE A PURCHASE GATE, ONCE (AGL-3955).
 *
 * A plugin that sells something can hold a purchase behind a gate the
 * workspace has to earn: the domains plugin refuses to register a name until
 * the workspace has a paid platform invoice at least 72 hours old. Core owns
 * the one thing that can stand in for that history: a staff member who met
 * the owner in person and minted a single-use bundle link for that one
 * workspace, accountable for it in `adminAudit`.
 *
 * The plugin cannot read core's bundle-link records (a plugin never imports
 * core's storage, and never another plugin), so the waiver is a contract
 * here. The plugin asks `check` while deciding whether the gate refuses, and
 * calls `consume` after it has taken its own hold and before it charges: a
 * `false` from `consume` refuses the purchase, so one preclearance buys
 * exactly one thing.
 *
 * Only the named gate is waived. Every other refusal the plugin makes (a
 * brand lookalike, its per-workspace caps) stands, and an implementation has
 * no say in them.
 *
 * ## FAILS CLOSED
 *
 * {@link checkPurchaseGatePreclearance} answers null on any error and when
 * nothing is registered, and {@link consumePurchaseGatePreclearance} answers
 * false: a waiver that cannot be confirmed is no waiver, and the gate keeps
 * refusing.
 */

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** The gates a preclearance may waive. One today. */
export type PurchaseGate = 'domain-payment-history'

export interface PurchaseGatePreclearanceInput {
  /** The workspace the purchase is for. */
  orgId: string
  gate: PurchaseGate
}

export interface PurchaseGatePreclearance {
  /**
   * A live, unused waiver for this workspace and gate, or null. Reads only:
   * asking does not spend it.
   */
  check(input: PurchaseGatePreclearanceInput): Promise<{ preclearanceId: string } | null>
  /**
   * Spend the waiver: true exactly once per id, in a transaction that marks it
   * used only if nothing has. False for an id this implementation does not
   * hold, one already spent, or one that expired.
   */
  consume(preclearanceId: string): Promise<boolean>
}

/**
 * A set: more than one surface may mint a waiver (a bundle link today), and
 * the gate asks each in turn.
 */
export const PURCHASE_GATE_PRECLEARANCE =
  definePluginServiceContract<PurchaseGatePreclearance>('core.purchase-gate-preclearance', {
    multiple: true,
  })

/** Installs an implementation. The console registers the bundle links at boot. */
export function registerPurchaseGatePreclearance(
  impl: PurchaseGatePreclearance,
  options?: { pluginId?: string; key?: string },
): void {
  if (typeof impl?.check !== 'function' || typeof impl?.consume !== 'function') {
    throw new Error('a purchase gate preclearance needs check and consume functions')
  }
  registerPluginService(PURCHASE_GATE_PRECLEARANCE, impl, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    ...(options?.key ? { key: options.key } : {}),
  })
}

/**
 * The first live waiver any implementation holds for the workspace and gate,
 * or null. Never throws; an implementation that throws is skipped and
 * logged, so it can only ever cost a waiver, never grant one.
 */
export async function checkPurchaseGatePreclearance(
  input: PurchaseGatePreclearanceInput,
): Promise<{ preclearanceId: string } | null> {
  const orgId = String(input?.orgId ?? '').trim()
  if (!orgId || input?.gate !== 'domain-payment-history') return null
  for (const registration of resolvePluginServices(PURCHASE_GATE_PRECLEARANCE)) {
    try {
      const found = await registration.impl.check({ orgId, gate: input.gate })
      const preclearanceId = String(found?.preclearanceId ?? '').trim()
      if (preclearanceId) return { preclearanceId }
    } catch (error) {
      console.error(
        `[purchase-gate-preclearance] check failed in "${registration.pluginId}"`,
        error,
      )
    }
  }
  return null
}

/**
 * Spend a waiver. True only when an implementation marked it used just now.
 * Never throws: a failure answers false, which refuses the purchase.
 */
export async function consumePurchaseGatePreclearance(
  preclearanceId: string,
): Promise<boolean> {
  const id = String(preclearanceId ?? '').trim()
  if (!id) return false
  for (const registration of resolvePluginServices(PURCHASE_GATE_PRECLEARANCE)) {
    try {
      if ((await registration.impl.consume(id)) === true) return true
    } catch (error) {
      console.error(
        `[purchase-gate-preclearance] consume failed in "${registration.pluginId}"`,
        error,
      )
    }
  }
  return false
}
