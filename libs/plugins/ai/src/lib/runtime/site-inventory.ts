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

import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import { effectiveDatasetModel } from '@aglyn/aglyn/app-utils/dataset-models'
import { datasetDisplayName } from '@aglyn/aglyn/app-utils/datasets'
import { isFormArchived } from '@aglyn/aglyn/app-utils/forms'
import {
  describeTheme,
  resolveSiteTheme,
  type ThemeHostDocument,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import { SCREEN_KIND_TEMPLATE } from '@aglyn/aglyn/app-utils/screen-route'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  resolveOrgIdForHost,
  scopedToHost,
} from '@aglyn/tenant-data-admin/server/organizations'
import {
  AI_INVENTORY_KINDS,
  AI_SITE_INVENTORY_MAX_PER_KIND,
  AiInventoryScopeError,
  type AiComponentPropTypes,
  type AiInventoryCollection,
  type AiInventoryComponent,
  type AiInventoryDataset,
  type AiInventoryForm,
  type AiInventoryKind,
  type AiInventoryLayout,
  type AiInventoryScreen,
  type AiInventoryTemplate,
  type AiInventoryTheme,
  type AiSiteInventory,
} from '../model/ai-site-inventory'

/**
 * The reader behind the site inventory (AGL-2935): one site's components,
 * layouts, templates, forms, datasets, content collections, screens and
 * theme, read as projections through the Admin SDK and reduced to the
 * compact shape `model/ai-site-inventory.ts` describes.
 *
 * Every kind is a projection (`select`) of the fields the inventory names —
 * never a node map, never a record's content — read one row past the cap so
 * a full page is told apart from a cut one. Retired rows (soft-deleted,
 * archived, a component never published) are filtered after the read, so a
 * site with many retired rows can list fewer than the cap; the kind is still
 * marked truncated when the read was cut, which is the honest answer.
 */

type Firestore = FirebaseFirestore.Firestore
type Data = Record<string, unknown>

export interface ReadSiteInventoryOptions {
  /** The Admin SDK handle; the platform's default app when absent. */
  firestore?: Firestore
  /** Rows read per kind; `AI_SITE_INVENTORY_MAX_PER_KIND` when absent, and never above it. */
  maxPerKind?: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A record's name, or its id when it was saved without one. */
function nameOf(data: Data, id: string, ...fields: string[]): string {
  for (const field of fields) {
    const value = text(data[field])
    if (value) return value
  }
  return id
}

/** The flat `path → color` leaves of one scheme, e.g. `primary.main`. */
function schemeColors(scheme: unknown): Record<string, string> {
  const colors: Record<string, string> = {}
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (path) colors[path] = value
      return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, inner] of Object.entries(value as Data)) {
      visit(inner, path ? `${path}.${key}` : key)
    }
  }
  visit(scheme, '')
  return colors
}

/** The theme a site renders with, reduced to what a plan and an email can act on. */
export function aiInventoryTheme(host: Data | null): AiInventoryTheme | null {
  const theme = resolveSiteTheme(host as ThemeHostDocument | null)
  if (!theme) return null
  const fonts = new Set<string>()
  for (const font of theme.fonts ?? []) {
    if (text(font?.family)) fonts.add(text(font.family))
  }
  return {
    summary: describeTheme(theme),
    colors: schemeColors(theme.colorSchemes?.light),
    fonts: [...fonts],
  }
}

interface Window<T> {
  rows: T[]
  truncated: boolean
}

async function readWindow<T>(
  query: FirebaseFirestore.Query,
  fields: string[],
  cap: number,
  map: (id: string, data: Data) => T | null,
): Promise<Window<T>> {
  const snapshot = await query
    .select(...fields)
    .limit(cap + 1)
    .get()
  const rows: T[] = []
  for (const doc of snapshot.docs.slice(0, cap)) {
    const row = map(doc.id, (doc.data() ?? {}) as Data)
    if (row) rows.push(row)
  }
  return { rows, truncated: snapshot.docs.length > cap }
}

/**
 * Read one site's inventory for a generation.
 *
 * SCOPED before anything is read. The job names a site and an org, and
 * nothing the reader is handed proves the site belongs to the org, so it asks
 * the host index first and refuses a pairing it does not record: another
 * workspace's component names are not this workspace's prompt. Datasets are
 * org-owned and narrowed to what this site may see.
 *
 * Throws `AiInventoryScopeError` for a site outside the org, and lets a
 * Firestore failure propagate: a planner handed an empty inventory by
 * mistake would create everything the site already has.
 */
export async function readSiteInventory(
  orgId: string,
  hostId: string,
  options: ReadSiteInventoryOptions = {},
): Promise<AiSiteInventory> {
  const owner = await resolveOrgIdForHost(hostId)
  if (!owner || owner !== orgId) throw new AiInventoryScopeError(hostId)
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const cap = Math.min(
    AI_SITE_INVENTORY_MAX_PER_KIND,
    Math.max(1, Math.floor(options.maxPerKind ?? AI_SITE_INVENTORY_MAX_PER_KIND)),
  )
  const host = firestore.collection('hosts').doc(hostId)

  const [components, layouts, templates, forms, datasets, collections, screens, hostDoc] =
    await Promise.all([
      readWindow<AiInventoryComponent>(
        host.collection('components'),
        ['displayName', 'props', 'rootId', 'versionId', 'deletedAt'],
        cap,
        (id, data) => {
          // Soft-deleted, or never published: an instance of either renders nothing.
          if (data['deletedAt'] || !(data['rootId'] || data['versionId'])) return null
          const props: AiComponentPropTypes = {}
          for (const prop of Array.isArray(data['props']) ? (data['props'] as Data[]) : []) {
            const name = text(prop?.['name'])
            if (name) props[name] = text(prop['type']) || 'text'
          }
          return { id, name: nameOf(data, id, 'displayName'), props }
        },
      ),
      readWindow<AiInventoryLayout>(
        host.collection('layouts'),
        ['displayName', 'layoutId', 'deletedAt'],
        cap,
        (id, data) =>
          data['deletedAt']
            ? null
            : {
                id,
                name: nameOf(data, id, 'displayName'),
                parentId: text(data['layoutId']) || null,
              },
      ),
      readWindow<AiInventoryTemplate>(
        host.collection('templates'),
        ['displayName', 'kind', 'deletedAt'],
        cap,
        (id, data) =>
          data['deletedAt']
            ? null
            : { id, name: nameOf(data, id, 'displayName'), kind: text(data['kind']) || 'page' },
      ),
      readWindow<AiInventoryForm>(
        host.collection('forms'),
        ['displayName', 'slug', 'fields', 'archivedAt'],
        cap,
        (id, data) =>
          isFormArchived(data as { archivedAt?: unknown })
            ? null
            : {
                id,
                name: nameOf(data, id, 'displayName', 'slug'),
                fields: (Array.isArray(data['fields']) ? (data['fields'] as Data[]) : [])
                  .map((field) => text(field?.['fieldName']))
                  .filter(Boolean),
              },
      ),
      readWindow<AiInventoryDataset>(
        scopedToHost(firestore.collection('orgs').doc(orgId).collection('datasets'), hostId),
        ['displayName', 'name', 'fields', 'model', 'deletedAt'],
        cap,
        (id, data) => {
          if (data['deletedAt']) return null
          const model = effectiveDatasetModel(
            data as Parameters<typeof effectiveDatasetModel>[0],
          )
          const fields = model.order
            .map((fieldId) => text(model.fields[fieldId]?.name) || fieldId)
            .filter(Boolean)
          return { id, name: datasetDisplayName(data) || id, fields }
        },
      ),
      readWindow<AiInventoryCollection>(
        host.collection('collections'),
        ['displayName', 'name', 'slug', 'kind'],
        cap,
        (id, data) =>
          hostCollectionKind(data) !== 'content'
            ? null
            : {
                id,
                name: nameOf(data, id, 'displayName', 'name', 'slug'),
                slug: text(data['slug']),
              },
      ),
      readWindow<AiInventoryScreen>(
        host.collection('screens'),
        ['displayName', 'slug', 'layoutId', 'kind', 'deletedAt'],
        cap,
        (id, data) => {
          const kind = text(data['kind'])
          // An email design and an error body are not pages a plan links or duplicates.
          if (data['deletedAt'] || (kind && kind !== SCREEN_KIND_TEMPLATE)) return null
          return {
            id,
            name: nameOf(data, id, 'displayName', 'slug'),
            slug: text(data['slug']),
            layoutId: text(data['layoutId']) || null,
            template: kind === SCREEN_KIND_TEMPLATE,
          }
        },
      ),
      host.get(),
    ])

  const windows: Record<AiInventoryKind, Window<unknown>> = {
    components,
    layouts,
    templates,
    forms,
    datasets,
    collections,
    screens,
  }
  return {
    hostId,
    components: components.rows,
    layouts: layouts.rows,
    templates: templates.rows,
    forms: forms.rows,
    datasets: datasets.rows,
    collections: collections.rows,
    screens: screens.rows,
    theme: aiInventoryTheme(hostDoc.exists ? ((hostDoc.data() ?? {}) as Data) : null),
    truncated: AI_INVENTORY_KINDS.filter((kind) => windows[kind].truncated),
  }
}
