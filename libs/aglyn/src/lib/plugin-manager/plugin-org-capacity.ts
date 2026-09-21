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
 * AN ORG CAPACITY A PLUGIN BACKS (AGL-3080).
 *
 * An org holds a fixed number of some things, its plan includes a number of
 * them, and it can buy more on top. Three of those existed and core named all
 * three: sites, team seats and DATASETS. The first two are the platform's own
 * — every workspace has sites and people, plugin or no plugin. A dataset is
 * the data plugin's, and core knew its collection path, its noun, its plural,
 * the words a refusal says about it and which entitlement field to measure it
 * against.
 *
 * That mattered because the same three names were spelled out in three places
 * with two different vocabularies — `OverLimitKind` calls it `datasets` and
 * `CapacityAddonKind` calls it `datasets` but calls a site `hosts` — and each
 * had its own noun table. A fourth capacity would have meant editing all of
 * them, and a plugin that shipped one could not add it at all.
 *
 * So the plugin declares the capacity, once, and core's two gates read it.
 *
 * ## What core keeps
 *
 * The MONEY. Which add-on kinds exist, what they cost, what a plan includes,
 * whether a reduction is refused and what the refusal says structurally are
 * all core's, and none of them move. A declaration names the collection to
 * count, the entitlement field that holds the included figure, the add-on kind
 * it stacks on, and the words for one and many. It decides nothing about
 * whether the customer may do the thing.
 *
 * ## Compiled, and deliberately without a runtime registrar
 *
 * The readers are a downgrade REFUSAL (`/api/billing/subscription`) and the
 * warning the customer reads before choosing, and both must list the same
 * capacities or the refusal contradicts the warning that preceded it. A
 * registry that one of those processes had not filled would drop a capacity
 * from the comparison, and the plan change that strands it would be allowed
 * with nothing red — the AGL-3025 shape, on money. So these are compiled from
 * `plugins.config.json` like the switchboard catalog, and there is no
 * `registerPluginOrgCapacity`: a registrar nothing can safely call is worse
 * than no registrar, because the next reader assumes it works.
 */

import { PLUGIN_ORG_CAPACITIES_DECLARED } from './first-party-plugins.generated'

/** What one and many of the thing are called, and what the money buys. */
export interface PluginOrgCapacityNouns {
  /** "dataset" — used when the quantity is exactly one. */
  one: string
  /** "datasets" — used for every other quantity, and as the held noun. */
  many: string
  /**
   * "extra datasets" — what the PURCHASE is called. An org holds "team
   * members" and buys "extra team seats", and a refusal that used one word
   * for both would be telling somebody to delete a seat.
   */
  addon: string
}

export interface PluginOrgCapacityDeclaration {
  /** The capacity's id, as both gates and any stored row spell it. */
  kind: string
  /** Where it sorts among the capacities; core's own are 10 and 20. */
  order: number
  /** The subcollection under `orgs/{orgId}` whose documents are counted. */
  collection: string
  /** The `AddonKind` this capacity is sold as. */
  addonKind: string
  /**
   * The `PLAN_ENTITLEMENTS` field holding what a plan INCLUDES — never the
   * purchase ceiling. The two are far apart (Starter includes 3 datasets and
   * sells up to 10) and measuring against the ceiling prints a number the
   * word "includes" makes false while clearing an org a plan change strands.
   */
  includedEntitlement: string
  nouns: PluginOrgCapacityNouns
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginOrgCapacity = PluginOrgCapacityDeclaration & {
  pluginId: string
}

/** Every declared org capacity, in declared order. */
export function pluginOrgCapacities(): readonly ResolvedPluginOrgCapacity[] {
  return PLUGIN_ORG_CAPACITIES_DECLARED
}

/** One declared capacity by kind, or `null`. */
export function pluginOrgCapacity(
  kind: string,
): ResolvedPluginOrgCapacity | null {
  return PLUGIN_ORG_CAPACITIES_DECLARED.find((one) => one.kind === kind) ?? null
}

/** One declared capacity by the add-on kind it is sold as, or `null`. */
export function pluginOrgCapacityForAddon(
  addonKind: string,
): ResolvedPluginOrgCapacity | null {
  return (
    PLUGIN_ORG_CAPACITIES_DECLARED.find((one) => one.addonKind === addonKind) ??
    null
  )
}
