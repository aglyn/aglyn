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
 * THE KINDS OF ENTITY A BESIGNER PICKER LISTS, AS THEIR PLUGINS DECLARE THEM
 * (AGL-3080).
 *
 * An element's attribute can name another record by id — the product a
 * product grid shows, the form a Form element files into, the dataset a
 * repeat walks — and the besigner offers that attribute as a picker of the
 * site's records of that kind (AGL-343/344). Core used to know every kind
 * there was: a closed union over commerce's products, collections and
 * categories, the forms plugin's forms and the data plugin's datasets, with
 * each one's collection, name field, scope, server filter and words spelled
 * out in the console's provider and the besigner's tables. A plugin that
 * kept a record an element could name had no way to be picked.
 *
 * So a plugin DECLARES each kind it supplies, in `plugins.config.json`
 * (`entityPickers`), and the console's provider and the besigner read the
 * declarations: which attribute type lists the kind, where its documents
 * hang (a site's own, or the organization's data shared per site), the field
 * a document is named by, the equality clauses that narrow it on the server,
 * whether it carries the name-search keys, the words a picker says about it,
 * and — for a kind whose documents carry a field model — the attribute type
 * that offers a chosen entity's fields and the record kind whose list source
 * shares them (`plugin-record-lists`).
 *
 * ## What core keeps
 *
 * The machinery every kind shares and none may vary: the bounded browse with
 * its probe, the search past it, the keyed resolution of a stored value, the
 * demand gate, and the platform's visibility rule for the organization's
 * data — an `orgData` kind lists only what the site may use (`visibleTo`
 * against the site's scope tokens, AGL-1044) and resolves anything else as
 * unavailable. A declaration names fields and words; it cannot widen what a
 * site may see.
 *
 * ## Compiled, and deliberately without a runtime registrar
 *
 * The besigner decides whether an attribute IS a picker from these, on the
 * first render of the panel, and a picker that was not yet registered would
 * render as an ordinary field — a bound element shown as an unbound one,
 * which an author repairs by choosing again. So these are compiled from
 * `plugins.config.json` like the org capacities and the switchboard catalog:
 * the declarations are in the manifest before anything runs.
 */

import { PLUGIN_ENTITY_PICKERS_DECLARED } from './first-party-plugins.generated'

/** One equality clause a kind's documents are narrowed by, on the server. */
export interface PluginEntityPickerClause {
  field: string
  equals: string | number | boolean
}

export interface PluginEntityPickerDeclaration {
  /**
   * The kind's key in the picker context — `options[kind]`, `status[kind]`,
   * `resolved[kind]` — and in a repeat source's `entityKind`. Unique.
   */
  kind: string
  /** The attribute type (`FieldComponentType`) whose picker lists this kind. */
  attribute: string
  /**
   * Where the kind's documents hang: `host` — the site's own
   * `hosts/<hostId>/<collection>`; `orgData` — the organization's data, read
   * where the site's data scope resolves and narrowed to what the site may
   * use.
   */
  scope: 'host' | 'orgData'
  /** The collection's name under the scope's root. */
  collection: string
  /** The field holding a document's name; `name` is read when it is empty. */
  nameField: string
  /** Equality clauses applied to the browse AND the search, on the server. */
  where?: readonly PluginEntityPickerClause[]
  /**
   * The documents carry the name-search keys (`nameTokens`, `nameLower`),
   * so a typed query reaches past the browse window.
   */
  searchable?: boolean
  /**
   * An attribute type whose options are the FIELDS of a chosen entity of
   * this kind — a form field's "Maps to schema field" — with `fieldsFrom`,
   * the record kind whose console list source shares each entity's `fields`
   * as `{ id, name }` (`plugin-record-lists`).
   */
  fieldsAttribute?: string
  fieldsFrom?: string
  /** The words a picker says: "No (plural) yet — add one on (page)". */
  singular: string
  plural: string
  page: string
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginEntityPicker = PluginEntityPickerDeclaration & {
  pluginId: string
}

/**
 * The load point a plugin whose console list source shares an entity's
 * fields declares in its `console.slots` (`fieldsFrom`), so the console's
 * picker provider loads it: the declaration is compiled, the fields are read
 * through the source at run time.
 */
export const ENTITY_PICKERS_LOAD_POINT = 'entityPickers'

/** Every declared picker kind, in the order the plugins are configured. */
export function pluginEntityPickers(): readonly ResolvedPluginEntityPicker[] {
  return PLUGIN_ENTITY_PICKERS_DECLARED
}

/** The declared kind with this key, or `null`. */
export function pluginEntityPicker(kind: string): ResolvedPluginEntityPicker | null {
  return PLUGIN_ENTITY_PICKERS_DECLARED.find((one) => one.kind === kind) ?? null
}

/** The kind an attribute type's picker lists, or `null` when it lists none. */
export function entityPickerForAttribute(
  attribute: string | undefined,
): ResolvedPluginEntityPicker | null {
  if (!attribute) return null
  return PLUGIN_ENTITY_PICKERS_DECLARED.find((one) => one.attribute === attribute) ?? null
}

/**
 * The kind whose entity FIELDS an attribute type offers, or `null` — the
 * picker needs that kind's list to resolve the entity its fields are read
 * from, without being a picker of the kind itself.
 */
export function entityFieldsPickerForAttribute(
  attribute: string | undefined,
): ResolvedPluginEntityPicker | null {
  if (!attribute) return null
  return PLUGIN_ENTITY_PICKERS_DECLARED.find((one) => one.fieldsAttribute === attribute) ?? null
}
