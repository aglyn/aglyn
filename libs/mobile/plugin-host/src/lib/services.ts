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
 * Mobile plugin services (AGL-3618): the mobile twin of the web plugin
 * manager's `registerPluginService` (`libs/aglyn` plugin-services.ts).
 *
 * The registry's contribution kinds are things the shell DRAWS (a screen, a
 * tab, a widget). A service is something the shell or another screen CALLS: a
 * plugin implements a contract the foundation declares, and the caller
 * resolves the contract, never the plugin. That is how an app's device code
 * reaches a server route a plugin owns (the card reader's connection token)
 * without the shell naming the plugin.
 *
 * A contract is a single slot: a second plugin registering against it is a
 * conflict, refused naming both, and the incumbent keeps serving. The owner
 * is the plugin whose registrar is running; a registration made outside one
 * names its `pluginId`.
 */

import { currentRegisteringPlugin } from './registry'

/** A contract token. `T` rides at the type level only. */
export interface MobileServiceContract<T> {
  readonly id: string
  readonly __type?: T
}

interface Registration {
  pluginId: string
  impl: unknown
}

const contracts = new Map<string, MobileServiceContract<unknown>>()
const registrations = new Map<string, Registration>()

/** Declares a contract; idempotent by id, so a re-evaluated module gets its token back. */
export function defineMobileServiceContract<T>(id: string): MobileServiceContract<T> {
  const key = id.trim()
  if (!key) throw new Error('a mobile service contract needs an id')
  const existing = contracts.get(key)
  if (existing) return existing as MobileServiceContract<T>
  const contract: MobileServiceContract<T> = { id: key }
  contracts.set(key, contract)
  return contract
}

export function registerMobileService<T>(
  contract: MobileServiceContract<T>,
  impl: T,
  options?: { pluginId?: string },
): void {
  if (contracts.get(contract.id) !== contract) {
    throw new Error(`mobile service contract "${contract.id}" was not made by defineMobileServiceContract`)
  }
  const pluginId = (currentRegisteringPlugin() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(`mobile service "${contract.id}" registered with no owner: pass { pluginId } outside a registrar`)
  }
  const incumbent = registrations.get(contract.id)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `mobile service "${contract.id}" is already provided by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registrations.set(contract.id, { pluginId, impl })
}

/** The implementation, or undefined when no loaded plugin provides it. */
export function resolveMobileService<T>(contract: MobileServiceContract<T>): T | undefined {
  return registrations.get(contract.id)?.impl as T | undefined
}

/** @internal The loader's hook: a plugin that failed to load provides nothing. */
export function unregisterMobileServices(pluginId: string): void {
  for (const [id, registration] of registrations) {
    if (registration.pluginId === pluginId) registrations.delete(id)
  }
}

/** Test seam. */
export function resetMobileServices(): void {
  registrations.clear()
}
