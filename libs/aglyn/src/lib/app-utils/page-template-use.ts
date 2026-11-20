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

import type { AglynNodeSchema, NodeId, TemplatePlaceholder } from '../foundation'
import {
  AUTHORED_TEMPLATE_SOURCE,
  INSTALLED_TEMPLATE_SOURCE_TYPES,
} from '../plugin-manager/plugin-template-sources'
import { resolveNamedTokens } from './resolve-named-tokens'
import { COMPONENT_PROP_TOKEN_PREFIX } from './reusable-component-keys'
import { decodeStoredNodes } from './stored-nodes'

/*
 * USING A TEMPLATE, THE PURE PART (AGL-4235).
 *
 * What the console's Use dialog and `createPageFromTemplate` do to a stored
 * template before anything is written — which placeholders it asks for, what
 * a placeholder left blank becomes, and the tree with the values put in —
 * lifted here so the public API's page create reads a template exactly as
 * the console does, from one copy.
 */

/**
 * A site's own library, as the gallery's "Your templates" shelf asks for it:
 * saved here or installed, never a starter's pages, which the Starters shelf
 * presents as the bundles they are.
 */
export const LIBRARY_TEMPLATE_SOURCE_TYPES: readonly string[] = [
  AUTHORED_TEMPLATE_SOURCE,
  ...INSTALLED_TEMPLATE_SOURCE_TYPES,
]

/**
 * The placeholders a template asks to be filled in, in its order.
 *
 * A `{{prop.*}}` token binds to a property, never to a placeholder
 * (AGL-2932). Templates saved before that was known list one anyway, and
 * filling it in would erase the binding from what is made.
 */
export function templateFillablePlaceholders(placeholders: unknown): TemplatePlaceholder[] {
  return (Array.isArray(placeholders) ? placeholders : []).filter(
    (entry: { name?: unknown } | null | undefined): entry is TemplatePlaceholder =>
      Boolean(entry) &&
      typeof entry?.name === 'string' &&
      entry.name !== '' &&
      !entry.name.startsWith(COMPONENT_PROP_TOKEN_PREFIX),
  )
}

/**
 * The values a template's tree is filled in with: each placeholder's typed
 * value, else its default, else empty — as the Use dialog starts every field
 * at its default and sends what the field holds. `null` when the template
 * asks for nothing, which leaves its tree untouched.
 */
export function templatePlaceholderValues(
  placeholders: readonly TemplatePlaceholder[],
  typed?: Readonly<Record<string, string>> | null,
): Record<string, string> | null {
  if (!placeholders.length) return null
  return Object.fromEntries(
    placeholders.map((entry) => [entry.name, typed?.[entry.name] ?? entry.defaultValue ?? '']),
  )
}

/**
 * A template's tree with its placeholders filled in, from EITHER stored
 * form (AGL-1151): msgpack for anything written since templates were
 * compressed, a plain map for everything older, or a tree built in memory.
 * Read raw, a `Bytes` matches no token and comes back as it went in, and
 * the page made from it is empty.
 */
export function resolveTemplateNodes<N extends AglynNodeSchema = AglynNodeSchema>(
  stored: unknown,
  values: Record<string, string> | null | undefined,
): Record<NodeId, N> {
  return resolveNamedTokens<N>(decodeStoredNodes<Record<NodeId, N>>(stored) ?? {}, values ?? null)
}
