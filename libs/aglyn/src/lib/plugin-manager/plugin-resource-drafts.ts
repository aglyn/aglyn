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

import type { ReusableComponentTree } from '../app-utils/compose-reusable-components'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Drafts one plugin writes for another (AGL-2912).
 *
 * A resource belongs to the plugin that models it: the document's shape, the
 * allowance a create counts against, who may create one, and what makes one
 * well-formed. A different plugin that produces such a resource — an importer
 * turning a file into pages, a generator turning a brief into an email, a
 * migration bringing campaigns over from another tool — must not write the
 * document itself, because it would restate the owner's rules and drift from
 * them the day the owner changes one. Nor may it import the owner, which the
 * package map forbids.
 *
 * So the owner registers a WRITER for the resource from its server surfaces,
 * and a caller asks for one by resource name. Every rule stays the owner's:
 *
 *  - `refusal` answers, before the caller spends anything, whether this
 *    member may create one on this site now: their role, the site's room;
 *  - `check` answers, synchronously and without I/O, whether content is
 *    well-formed, so a caller can hold what it produces to the owner's rules
 *    before it keeps it;
 *  - `read` reports the draft already written under an id, so a caller that
 *    runs again finds its draft rather than making a second;
 *  - `write` makes the draft, meets the allowance inside its own write, and
 *    never publishes, schedules or sends anything.
 *
 * Built on the typed service registry (`plugin-services`): one contract, every
 * writer registered under its resource name as the service's key.
 *
 * ## The registry carries no authorization of the CALLER
 *
 * Like `order-fulfilment`, a writer is a pre-authorized operation. It applies
 * the owner's rules to the member the draft is for, and knows nothing about
 * whether the caller may act for that member. A caller establishes, in its
 * own terms and before it asks: who is asking, that the org owns the site,
 * and that the owning plugin is switched on for that site.
 *
 * ## One writer per resource
 *
 * A resource has one owner. A second plugin registering a writer for a
 * resource another plugin already writes is refused, naming both, and the
 * incumbent keeps serving; the same plugin registering again — from its second
 * server surface, or on a hot reload — replaces its own.
 */

/** Who a draft is for, on which site, and when. */
export interface PluginDraftContext {
  orgId: string
  hostId: string
  /** The member the draft is made for: the owner applies its rules to them and records them as the author. */
  uid: string
  /** The org document the caller already read, for the owner's entitlement and allowance reads. */
  org: Readonly<Record<string, unknown>> | null
  now: Date
}

/** Why a draft cannot be made. */
export interface PluginDraftRefusal {
  status: 400 | 403 | 404 | 409
  /** Customer-safe: a caller shows it as it stands. */
  error: string
}

/** A draft that exists. */
export interface PluginDraftRecord {
  id: string
  name: string
  /** The version the draft opens on, where the resource has versions. */
  versionId: string | null
  /** What the owner reports about the draft beyond its identity, in the shape its writer documents. */
  facts: Readonly<Record<string, unknown>>
}

export interface PluginDraftRequest extends PluginDraftContext {
  /** The draft's id, chosen by the caller: one per act, so a write asked again finds its draft. */
  id: string
  /** The name asked for; the owner may number it to keep it unique. */
  name: string
  /** The resource's content, in the shape the owner's writer documents and validates. */
  content: Readonly<Record<string, unknown>>
}

export type PluginDraftCheck =
  | { ok: true; facts: Readonly<Record<string, unknown>> }
  | { ok: false; problems: string[] }

/** What a check is told beside the content. */
export interface PluginDraftCheckContext {
  hostId: string
  /**
   * The site's published reusable components the content places, keyed by id
   * — what `loadReferencedComponents` reads (AGL-3287).
   *
   * `check` does no I/O, so a caller whose content may place a component loads
   * the definitions first and hands them in; a writer whose resource renders
   * placed components composes them before judging, so what passes is what
   * would render. Absent means none were loaded, and the content is judged as
   * written.
   */
  components?: Readonly<Record<string, ReusableComponentTree | undefined>>
}

export type PluginDraftWrite =
  | (PluginDraftRecord & { ok: true; replayed: boolean })
  | (PluginDraftRefusal & { ok: false })

export interface PluginResourceDraftWriter {
  /** Whether this member may create one on this site now; `null` admits. */
  refusal(context: PluginDraftContext): Promise<PluginDraftRefusal | null>
  /** Whether content is well-formed, with what the owner derived from it. Pure. */
  check(
    content: Readonly<Record<string, unknown>>,
    context: PluginDraftCheckContext,
  ): PluginDraftCheck
  /** The draft written under `id`, or `null`. */
  read(context: { hostId: string; id: string }): Promise<PluginDraftRecord | null>
  /** Makes the draft; a refusal is returned, never thrown. */
  write(request: PluginDraftRequest): Promise<PluginDraftWrite>
}

export const PLUGIN_RESOURCE_DRAFTS =
  definePluginServiceContract<PluginResourceDraftWriter>('core.resource-drafts', {
    multiple: true,
  })

/**
 * Registers the writer for a resource. The owner is the loader's marker when
 * a register fn is running, else `options.pluginId`; with neither the
 * registration throws. A writer for a resource another plugin writes throws
 * naming both.
 */
export function registerPluginResourceDraftWriter(
  resource: string,
  writer: PluginResourceDraftWriter,
  options?: { pluginId?: string },
): void {
  const key = resource.trim()
  if (!key) throw new Error('a resource draft writer needs a resource name')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_RESOURCE_DRAFTS).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `resource "${key}" already has a draft writer from "${incumbent.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RESOURCE_DRAFTS, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

export interface ResolvedPluginDraftWriter {
  /** The plugin that owns the resource. */
  pluginId: string
  writer: PluginResourceDraftWriter
}

/** The writer for a resource, with its owner, or `null` when no plugin writes it. */
export function pluginResourceDraftWriter(resource: string): ResolvedPluginDraftWriter | null {
  const key = resource.trim()
  const entry = resolvePluginServices(PLUGIN_RESOURCE_DRAFTS).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, writer: entry.impl } : null
}
