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

import { PLUGIN_CONTAINER_KINDS_DECLARED } from './plugin-containers.generated'

/**
 * CONTAINER KINDS: the documents other records are FILED UNDER, declared by
 * the plugin that keeps them.
 *
 * A container is a document other records join by naming its id in a
 * membership array on their OWN documents — a form, a screen, a lead or a
 * contact filed under a campaign. `app-utils/container-membership.ts` says
 * why the edge lives on the member, and holds the helpers every member's
 * writer and reader share.
 *
 * The plugin that keeps a kind declares it in the `containers` block of
 * `plugins.config.json`, compiled into `plugin-containers.generated.ts`, so
 * no surface that files a record has to know which plugin that is or where
 * the containers are stored:
 *
 *  - `kind` names the membership field: a member holds its containers in
 *    `<kind>Ids` (`containerMembershipField`). The name is the contract,
 *    which is what lets a record page in one plugin file itself under a kind
 *    another plugin keeps without importing it.
 *  - `orgCollection` is where the containers are stored, under the
 *    organization (`orgs/{orgId}/{orgCollection}`), one of the owner's own
 *    declared org collections. A container is placed on sites by the core's
 *    scope field (`visibleTo`) and retired by `deletedAt`, like every other
 *    org record a site hub lists.
 *  - `label` / `pluralLabel` / `ownerLabel` are what a picker calls one, several,
 *    and the plugin a merchant creates one in.
 *
 * Compiled rather than registered: the readers include a form submission
 * that loads no plugin, and a registry that request had not filled would
 * read every record as filed under nothing.
 */

/** One container kind, as its plugin declares it. */
export interface PluginContainerKind {
  /** The plugin that keeps the containers. */
  pluginId: string
  /** The kind, lowerCamelCase; its members hold it in `<kind>Ids`. */
  kind: string
  /** What one container is called. */
  label: string
  /** What several are called. */
  pluralLabel: string
  /** The owner's catalog label: where a merchant creates one. */
  ownerLabel: string
  /** The org collection the containers are stored in. */
  orgCollection: string
  /** The field a container's name is stored in. */
  nameField: string
}

/** Every declared container kind, in catalog order. */
export function listPluginContainerKinds(): PluginContainerKind[] {
  return PLUGIN_CONTAINER_KINDS_DECLARED.map((row) => ({ ...row }))
}

/** One declared kind, or `null` when no plugin keeps it. */
export function pluginContainerKind(kind: string): PluginContainerKind | null {
  const key = String(kind ?? '').trim()
  const row = PLUGIN_CONTAINER_KINDS_DECLARED.find((one) => one.kind === key)
  return row ? { ...row } : null
}
