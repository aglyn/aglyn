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

/**
 * The TYPE half of a plugin's billing and access keys (AGL-3124).
 *
 * AGL-2940 built `registerPluginEntitlements`, and the registration migrated:
 * a plugin declares its seat add-ons, its feature flags, its lockdown levers
 * and its permissions, and the catalogs that used to be edited per key read
 * the declarations. What did not migrate is the TYPE. `OrgEntitlements` and
 * `OrgFeatureFlags` still spell out keys named after seven plugin domains, so
 * a plugin can register a key the platform's own types have never heard of,
 * and a key it cannot register is one the platform still has to be edited
 * for.
 *
 * This module closes that half. The two interfaces below are EMPTY and are
 * meant to be augmented: a plugin declares the type of each key it owns with
 * `declare module`, and the core shapes compose from them rather than listing
 * them. The registry beside them is the runtime twin — what a staff page, a
 * migration or a support answer reads to say which plugin a key came from, and
 * what refuses two plugins claiming one key before either can resolve it.
 *
 * ```ts
 * // libs/plugins/cellar — the plugin's own module
 * declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
 *   interface PluginEntitlementQuotas {
 *     bottlesPerHost?: number
 *   }
 *   interface PluginEntitlementFeatures {
 *     cellarTastings?: boolean
 *   }
 * }
 * ```
 *
 * From then on `entitlements.bottlesPerHost` type-checks everywhere
 * `OrgEntitlements` is read, and nothing in the core names a bottle.
 *
 * ## Why the interfaces are declared here and not beside the shapes
 *
 * The augmentation target has to be a module a plugin may import, and a plugin
 * imports the plugin-manager seams by design. The billing types are on the
 * package's public surface and are read through the foundation barrel, which a
 * published page must never reach; the composition is a type-only edge in that
 * direction, which TypeScript erases, so the shapes gain the plugin half
 * without the graph gaining an edge.
 *
 * ## The NUMBERS stay where they are checked
 *
 * A key's price is not here and must not come here. A seat add-on's price is a
 * row in `PLAN_PRICING`, read by the Stripe wiring and reconciled by
 * `check-pricing-drift`; a declaration names the key and what the key MEANS,
 * and nothing here restates a price. That is the same line
 * `plugin-entitlements` draws, for the same reason: two places that both hold
 * a number are two places that can disagree about what a customer is charged.
 *
 * ## One key, one owner
 *
 * A key is stored under an organization's entitlements and resolved into what
 * that organization may do. Two plugins declaring one key would be two meanings for
 * one stored value, so a key another plugin declared is refused naming both,
 * and the whole registration is refused with it — half a plugin's keys landing
 * would be worse than none.
 */

/**
 * Quota and limit keys plugins add to `OrgEntitlements`. Augment with
 * `declare module`, declaring each key OPTIONAL — an entitlement is resolved
 * and may be absent, exactly like every key the core declares.
 */
export interface PluginEntitlementQuotas {}

/** Feature flags plugins add to `OrgFeatureFlags`, on the same terms. */
export interface PluginEntitlementFeatures {}

/**
 * The two halves above as MAPPED types, for composing into a type alias
 * rather than into an interface.
 *
 * Not a style choice. TypeScript hands an implicit string index signature to a
 * mapped type and withholds it from an interface, and several readers pass a
 * resolved entitlements or features object where a `Record<string, boolean>`
 * or `Record<string, unknown>` is wanted — a quota line reading every number,
 * a digest reading every gate. Intersecting `Required<CoreOrgFeatureFlags>`
 * with the raw interface loses that index signature and those readers stop
 * compiling, for a plugin half that is empty. Mapping it keeps them.
 *
 * An interface is still what a plugin AUGMENTS: `declare module` merges into
 * an interface and not into a type alias, so the pair is the augmentation
 * target and its composable form, and the mapping follows whatever is
 * declared.
 */
export type PluginOrgQuotas = {
  [Key in keyof PluginEntitlementQuotas]: PluginEntitlementQuotas[Key]
}
/** See {@link PluginOrgQuotas}. */
export type PluginOrgFeatures = {
  [Key in keyof PluginEntitlementFeatures]: PluginEntitlementFeatures[Key]
}

/**
 * What a declared key is, which is what decides where it is read.
 *
 * There is deliberately no third kind for a plugin's SETTINGS block on the
 * organization document. `org-write-deny-coverage.spec.ts` enumerates that
 * document's fields by reading `org-billing.types.ts`'s source and checks each
 * one against the Firestore write-deny rules, so a field declared from a
 * plugin's own file would be a hole in a rules-coverage guard. A plugin's
 * settings already have a home that is not a hole:
 * `registerPluginConfigSchema` stores them at `pluginSettings/{pluginId}`,
 * which is its own document under its own rule.
 */
export type PluginEntitlementKeyKind =
  /** A number in `OrgEntitlements`: a limit, a band, an allowance. */
  | 'quota'
  /** A boolean in `OrgFeatureFlags`. */
  | 'feature'

export interface PluginEntitlementKeyDeclaration {
  /** The stored key, exactly as the org document spells it. */
  key: string
  kind: PluginEntitlementKeyKind
  /** What a staff page and a support answer call it. */
  label: string
  /**
   * What the key means — for a quota, what it counts and what it does not.
   * The confusions this platform has already had (a catalog cap read as a
   * traffic cap, a daily pace read as a monthly band) all came from a key
   * whose name said something narrower or wider than it meant.
   */
  description?: string
}

export interface PluginEntitlementKeyRegistration {
  pluginId: string
  keys: readonly PluginEntitlementKeyDeclaration[]
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginEntitlementKey = PluginEntitlementKeyDeclaration & {
  pluginId: string
}

const registrations = new Map<string, PluginEntitlementKeyRegistration>()

function ownerOf(key: string): string | undefined {
  for (const entry of registrations.values()) {
    if (entry.keys.some((one) => one.key === key)) return entry.pluginId
  }
  return undefined
}

/**
 * Declares the entitlement keys a plugin owns. The owner is the loader's
 * marker when a register fn is running, else `registration.pluginId`; with
 * neither the registration throws. Idempotent per plugin — re-registering
 * replaces that plugin's declarations. A key another plugin declared refuses
 * the whole registration, naming both.
 */
export function registerPluginEntitlementKeys(
  registration: PluginEntitlementKeyRegistration,
): void {
  const pluginId = (
    getRegisteringPluginId() ??
    registration.pluginId ??
    ''
  ).trim()
  if (!pluginId) {
    throw new Error(
      'plugin entitlement keys registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const keys = registration.keys.map((declaration) => {
    const key = declaration.key?.trim() ?? ''
    if (!key) throw new Error('a plugin entitlement key needs a key')
    if (!declaration.label?.trim()) {
      throw new Error(`plugin entitlement key "${key}" needs a label`)
    }
    const owner = ownerOf(key)
    if (owner && owner !== pluginId) {
      throw new Error(
        `entitlement key "${key}" is already declared by "${owner}"; ` +
          `refused "${pluginId}"`,
      )
    }
    return { ...declaration, key }
  })
  registrations.set(pluginId, { pluginId, keys })
}

/** Every declared key, with its owner, in registration order. */
export function listPluginEntitlementKeys(): ResolvedPluginEntitlementKey[] {
  return [...registrations.values()].flatMap((entry) =>
    entry.keys.map((one) => ({ ...one, pluginId: entry.pluginId })),
  )
}

/** One declared key, with its owner, or `null` when no plugin declares it. */
export function pluginEntitlementKey(
  key: string,
): ResolvedPluginEntitlementKey | null {
  const wanted = key.trim()
  return (
    listPluginEntitlementKeys().find((one) => one.key === wanted) ?? null
  )
}

/** The plugin that declared a key, for attribution, or `undefined`. */
export function pluginIdForEntitlementKey(key: string): string | undefined {
  return pluginEntitlementKey(key)?.pluginId
}

/** The declared keys of one kind, with their owners, in registration order. */
export function listPluginEntitlementKeysOfKind(
  kind: PluginEntitlementKeyKind,
): ResolvedPluginEntitlementKey[] {
  return listPluginEntitlementKeys().filter((one) => one.kind === kind)
}

/** Drops a plugin's declarations — what a bundle unloading calls. */
export function unregisterPluginEntitlementKeys(pluginId: string): void {
  registrations.delete(pluginId.trim())
}

/** Test seam: forget every declaration. */
export function resetPluginEntitlementKeysForTests(): void {
  registrations.clear()
}
