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
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A zone a plugin declares, and the props it hands each widget (AGL-3124).
 *
 * `CONSOLE_WIDGET_SLOTS` is the catalog of zones the console SHELL draws, and
 * a slot id has always been an open string, so a plugin could already host a
 * zone of its own. What it could not do is say what that zone HANDS a widget.
 * The props had to be a type, the type had to be somewhere both sides import,
 * and "somewhere both sides import" was read as the core — which is how
 * `plugin-manager/commerce-zone-props.ts` and `plugin-manager/record-zone-props.ts`
 * came to spell out the commerce catalog and the record vocabulary of two
 * named plugins inside the platform.
 *
 * So the declaration moves to the plugin. A plugin defines a token for its
 * zone with {@link definePluginZone}, carrying the props type on the token,
 * and registers it here with a label and the surface it is drawn on. A widget
 * author takes the props type off the token — `PluginZoneProps<typeof ZONE>`
 * — without the core ever naming a product, a deal or a lead.
 *
 * ## Nothing here reaches a published page
 *
 * A zone token is `{ id }` and nothing else: `__props` is a phantom field that
 * never holds a value, so the props type is carried at the type level and
 * erased. That is the same trick the two type-only modules above use, and it
 * is load-bearing rather than tidy — AGL-3082 measured the zone catalog on the
 * published page's static graph, and a declaration that put a plugin's prop
 * SHAPES there would have made every published page carry the console's
 * vocabulary. `plugin-zones.spec.ts` pins the token's own key set so a field
 * added to it later has to be a decision.
 *
 * This module is reached by its own subpath and is deliberately absent from
 * `plugin-manager/index.ts`, for the reason that barrel already states about
 * `plugin-figures`: what a published page does not need, it must not import.
 *
 * ## One zone id, one owner
 *
 * A zone is a position on a page somebody draws. Two plugins declaring the
 * same id would each believe they set what a widget there receives, and the
 * widget author would have no way to tell whose props arrived — so a second
 * plugin's declaration is refused naming both, and the incumbent keeps its
 * zone. The same plugin declaring again — a second surface, a hot reload —
 * replaces its own.
 */

/**
 * A zone's identity, with the props it hands a widget carried at the type
 * level. `__props` never holds a value.
 */
export interface PluginZone<Props> {
  readonly id: string
  readonly __props?: Props
}

/** The props a zone hands each widget, read off its token. */
export type PluginZoneProps<Zone> = Zone extends PluginZone<infer Props>
  ? Props
  : never

/**
 * A zone token. Pure: it allocates no registration and reads no registry, so
 * a plugin may define one at module scope and register it from its register
 * fn, where the loader's owner marker is set.
 */
export function definePluginZone<Props>(id: string): PluginZone<Props> {
  const zoneId = id.trim()
  if (!zoneId) throw new Error('a plugin zone needs an id')
  return { id: zoneId }
}

/** Where a zone is drawn, which is what decides the gates around it. */
export type PluginZoneSurface = 'console' | 'besigner' | 'site'

export interface PluginZoneDeclaration<Props = unknown> {
  zone: PluginZone<Props>
  /** What the plugin's own manifest and the widget picker call the zone. */
  label: string
  /** The surface the zone is drawn on. */
  surface: PluginZoneSurface
  /**
   * What a widget here may do, and what it may not — the sentence a widget
   * author reads before writing one. Every zone in the core catalog carries
   * the same distinction (a widget proposes, the host writes), and a plugin's
   * zone owes its widgets the same statement.
   */
  description?: string
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginZone = PluginZoneDeclaration<unknown> & {
  pluginId: string
}

export const PLUGIN_ZONES = definePluginServiceContract<
  PluginZoneDeclaration<never>
>('core.zones', { multiple: true })

/**
 * Declares a zone the registering plugin hosts. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with neither
 * the registration throws. A zone id another plugin declared throws naming
 * both.
 */
export function registerPluginZone<Props>(
  declaration: PluginZoneDeclaration<Props>,
  options?: { pluginId?: string },
): void {
  const key = declaration.zone?.id?.trim() ?? ''
  if (!key) throw new Error('a plugin zone needs an id')
  if (!declaration.label?.trim()) {
    throw new Error(`plugin zone "${key}" needs a label`)
  }
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_ZONES).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `zone "${key}" is already declared by "${incumbent.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  registerPluginService(
    PLUGIN_ZONES,
    declaration as unknown as PluginZoneDeclaration<never>,
    {
      ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
      key,
    },
  )
}

/** Every declared zone, with its owner, in registration order. */
export function listPluginZones(): ResolvedPluginZone[] {
  return resolvePluginServices(PLUGIN_ZONES).map((entry) => ({
    ...(entry.impl as unknown as PluginZoneDeclaration<unknown>),
    pluginId: entry.pluginId,
  }))
}

/** One declared zone by id, with its owner, or `null` when nobody declares it. */
export function pluginZone(zoneId: string): ResolvedPluginZone | null {
  const key = zoneId.trim()
  const entry = resolvePluginServices(PLUGIN_ZONES).find(
    (one) => one.key === key,
  )
  return entry
    ? {
        ...(entry.impl as unknown as PluginZoneDeclaration<unknown>),
        pluginId: entry.pluginId,
      }
    : null
}

/** The plugin that declared a zone, for attribution, or `undefined`. */
export function pluginIdForZone(zoneId: string): string | undefined {
  return pluginZone(zoneId)?.pluginId
}
