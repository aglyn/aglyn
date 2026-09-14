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
 * Typed plugin service registry (AGL-2940).
 *
 * A plugin that wants OTHER plugins to extend it — a provider behind a
 * contract, a tool a generator can call, a generator kind — declares a
 * contract token here, and any plugin (first-party or marketplace) registers
 * an implementation against the token. The declaring plugin resolves the
 * implementations when it needs them and never imports the plugin that
 * supplied one, so the dependency runs only from an adopter to a contract.
 *
 * `registerBillingWebhookHandler` and `registerSiteRuntime` are the
 * precedent: one registry per extension seam, filled at registration time,
 * read lazily. What those cannot do is carry a TYPE for the thing registered
 * beyond their one shape, and each new seam meant a new module in core. A
 * contract token carries the implementation type with it, so a seam another
 * plugin invents needs no core edit at all.
 *
 * Attribution follows every other registry: the owner is the plugin whose
 * register fn is running (`setRegisteringPluginId`), or the `pluginId` the
 * caller names for a registration made at module scope, where the loader's
 * marker is not yet set. An implementation with no owner is refused —
 * ownership is what lets a duplicate single-service registration name both
 * claimants rather than silently taking the later one.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/**
 * A contract token. `T` is the implementation type and is carried at the
 * type level only; `__type` never holds a value.
 */
export interface PluginServiceContract<T> {
  readonly id: string
  /**
   * Whether more than one plugin may register against the contract. A
   * single-implementation contract (`false`) is a slot — an AI provider
   * routing table, a payment processor — where a second registration from a
   * different plugin is a conflict, not a list. A multiple contract is a set
   * every implementation joins.
   */
  readonly multiple: boolean
  readonly __type?: T
}

export interface PluginServiceRegistration<T> {
  contractId: string
  pluginId: string
  impl: T
  /** Higher resolves first among several implementations; default 0. */
  priority: number
}

const contracts = new Map<string, PluginServiceContract<unknown>>()
const registrations = new Map<string, PluginServiceRegistration<unknown>[]>()

/**
 * Declares a contract. Idempotent by id for the same `multiple` setting, so
 * a hot reload or a second surface re-evaluating the declaring module gets
 * the token back; declaring the same id with a DIFFERENT setting is a
 * programming error and throws, because two plugins would then disagree
 * about whether the seam is a slot or a set.
 */
export function definePluginServiceContract<T>(
  id: string,
  options: { multiple: boolean },
): PluginServiceContract<T> {
  const key = id.trim()
  if (!key) throw new Error('a plugin service contract needs an id')
  const existing = contracts.get(key)
  if (existing) {
    if (existing.multiple !== options.multiple) {
      throw new Error(
        `plugin service contract "${key}" is already defined with ` +
          `multiple=${existing.multiple}; cannot redefine it with ` +
          `multiple=${options.multiple}`,
      )
    }
    return existing as PluginServiceContract<T>
  }
  const contract: PluginServiceContract<T> = { id: key, multiple: options.multiple }
  contracts.set(key, contract)
  return contract
}

function requireContract<T>(contract: PluginServiceContract<T>): PluginServiceContract<T> {
  const known = contracts.get(contract.id)
  if (!known) {
    throw new Error(
      `plugin service contract "${contract.id}" is not defined; call ` +
        'definePluginServiceContract before registering against it',
    )
  }
  return known as PluginServiceContract<T>
}

/**
 * Registers an implementation. The owner is the loader's marker when a
 * register fn is running, else `options.pluginId`; a registration with
 * neither throws.
 *
 * Re-registration by the SAME plugin replaces its previous entry (hot
 * reload, a second surface, a repeated init). On a single-implementation
 * contract a registration from a DIFFERENT plugin throws naming both, and
 * the incumbent keeps serving.
 */
export function registerPluginService<T>(
  contract: PluginServiceContract<T>,
  impl: T,
  options?: { pluginId?: string; priority?: number },
): void {
  const known = requireContract(contract)
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `plugin service "${known.id}" registered with no owner: pass ` +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const list = registrations.get(known.id) ?? []
  const others = list.filter((entry) => entry.pluginId !== pluginId)
  if (!known.multiple && others.length) {
    throw new Error(
      `plugin service "${known.id}" is a single-implementation contract ` +
        `already registered by "${others[0].pluginId}"; refused "${pluginId}"`,
    )
  }
  others.push({
    contractId: known.id,
    pluginId,
    impl,
    priority: options?.priority ?? 0,
  })
  registrations.set(known.id, others)
}

/**
 * Every implementation of a contract, highest priority first and
 * registration order within a priority. Empty when nothing registered.
 */
export function resolvePluginServices<T>(
  contract: PluginServiceContract<T>,
): PluginServiceRegistration<T>[] {
  const known = requireContract(contract)
  const list = (registrations.get(known.id) ?? []) as PluginServiceRegistration<T>[]
  return [...list].sort((a, b) => b.priority - a.priority)
}

/**
 * The one implementation of a single contract — or, on a multiple
 * contract, the highest-priority one — or `undefined`.
 */
export function resolvePluginService<T>(
  contract: PluginServiceContract<T>,
): T | undefined {
  return resolvePluginServices(contract)[0]?.impl
}

/** Whether any plugin has registered against the contract. */
export function hasPluginService<T>(contract: PluginServiceContract<T>): boolean {
  return (registrations.get(requireContract(contract).id) ?? []).length > 0
}

/** Every declared contract id, for diagnostics. */
export function listPluginServiceContracts(): string[] {
  return [...contracts.keys()]
}

/**
 * Drops a plugin's registrations across every contract — what the loader's
 * reverse (a bundle unloading) would call, and what a spec calls to give
 * one fake plugin back its slot.
 */
export function unregisterPluginServices(pluginId: string): void {
  for (const [id, list] of registrations) {
    registrations.set(
      id,
      list.filter((entry) => entry.pluginId !== pluginId),
    )
  }
}

/** Test seam: forget every registration; contracts stay defined. */
export function resetPluginServicesForTests(): void {
  registrations.clear()
}
