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

import {
  AUTHORED_TEMPLATE_SOURCE,
  INSTALLED_TEMPLATE_SOURCE_TYPES,
  PLUGIN_TEMPLATE_SOURCES,
  STARTER_TEMPLATE_SOURCE,
  installedTemplateSource,
  isInstalledTemplateSource,
} from '@aglyn/aglyn/plugin-manager/plugin-template-sources'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/** A template's provenance badge: its text, its hint, and how loudly it reads. */
export interface TemplateSourceBadge {
  label: string
  title: string
  color: 'primary' | 'default'
}

/**
 * The provenance badge (AGL-666), qualified once the copy has been edited
 * locally (AGL-681), in the words the installing plugin declared (AGL-3080).
 *
 * `source` is server-managed, so an installer's name on a template cannot be
 * forged. But once someone edits an installed template, the installer's name
 * alone starts vouching for content its publisher never wrote — so an edited
 * copy says so. `editedAt` is client-written on purpose: it is a claim nobody
 * gains anything by faking about their own copy.
 *
 * `withVersion` adds the version an installed template came in at, which the
 * template's own page shows and the library's rows leave out.
 */
export function templateSourceBadge(
  source: { type?: string; version?: unknown } | undefined,
  options: { editedAt?: unknown; withVersion?: boolean } = {},
): TemplateSourceBadge {
  const edited = options.editedAt ? ' · edited' : ''
  const type = source?.type
  if (isInstalledTemplateSource(type)) {
    const declared = installedTemplateSource(type)
    const version =
      options.withVersion && source?.version != null && source.version !== ''
        ? ` · v${source.version}`
        : ''
    return {
      label: `${declared?.label ?? 'Installed'}${version}${edited}`,
      title: declared?.description ?? 'Installed by a plugin',
      color: 'primary',
    }
  }
  if (type === STARTER_TEMPLATE_SOURCE) {
    return {
      label: `Starter${edited}`,
      title: 'A first-party starter, copied in when you used or edited it',
      color: 'default',
    }
  }
  return { label: 'Saved here', title: 'Saved from this site', color: 'default' }
}

/**
 * The Source filter's values: every stored `source.type` a template in this
 * build can carry — each installer's, then the platform's two — labeled as
 * the badge labels them.
 */
export const TEMPLATE_SOURCE_OPTIONS: readonly ListFilterOption[] = [
  ...PLUGIN_TEMPLATE_SOURCES.map((source) => ({
    value: source.type,
    label: source.label,
  })),
  { value: STARTER_TEMPLATE_SOURCE, label: 'Starter' },
  { value: AUTHORED_TEMPLATE_SOURCE, label: 'Saved here' },
]

/**
 * A site's own library, as the gallery's "Your templates" shelf asks for it:
 * saved here or installed, never a starter's pages, which the Starters shelf
 * presents as the bundles they are.
 */
export const LIBRARY_TEMPLATE_SOURCE_TYPES: readonly string[] = [
  AUTHORED_TEMPLATE_SOURCE,
  ...INSTALLED_TEMPLATE_SOURCE_TYPES,
]
