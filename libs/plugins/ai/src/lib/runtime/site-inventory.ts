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
import { isFormArchived } from '@aglyn/aglyn/app-utils/forms'
import {
  describeTheme,
  resolveSiteTheme,
  type ThemeHostDocument,
} from '@aglyn/aglyn/app-utils/site-theme'
import {
  REUSABLE_COMPONENT_KIND_EMAIL,
  reusableComponentKindOf,
} from '@aglyn/aglyn/app-utils/reusable-component-kind'
import { SCREEN_KIND_TEMPLATE, SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
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
import { aiBracketedFacts } from './ai-doctrine-validators'

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
 *
 * The window is WIDER than the prompt lists (AGL-2937). The prompt block
 * lists `AI_SITE_INVENTORY_LISTED_PER_KIND` records of a kind because every
 * character of it is billed on every attempt; the rest of the window is what
 * the lookup tool searches, and a record never read cannot be found. The
 * difference is paid in document reads rather than tokens — a projection of
 * a few fields, once per job step — which is the cheaper of the two by some
 * orders of magnitude.
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
 * The screen a site's starter home may be (AGL-3594, AGL-3408): the one
 * `host.defaultHomeScreenId` names, while it still answers `/` in the routing
 * map and is listed as a page. `null` on every site whose owner published a
 * home page of their own, which clears the marker (AGL-3478), and on every
 * site created before the marker existed, whose home page is the owner's.
 */
export function aiStarterHomeCandidate(
  host: Readonly<Record<string, unknown>> | null,
  screens: ReadonlyArray<Pick<AiInventoryScreen, 'id' | 'template'>>,
): string | null {
  const id = text(host?.['defaultHomeScreenId'])
  if (!id) return null
  const routing = host?.['screens']
  const path =
    routing && typeof routing === 'object' ? (routing as Record<string, unknown>)[id] : undefined
  if (path !== SCREEN_ROOT_PATH) return null
  return screens.some((screen) => screen.id === id && !screen.template) ? id : null
}

/**
 * Whether the starter home is as the platform wrote it: its one version is
 * the one it was provisioned and published with. A version saved in the
 * editor is an edit, published or not, and an edited starter is the owner's
 * page — a plan keeps it.
 */
export function aiStarterHomeUntouched(
  publishedVersionId: string,
  versionIds: readonly string[],
): boolean {
  return Boolean(publishedVersionId) && versionIds.length === 1 && versionIds[0] === publishedVersionId
}

/**
 * The org's datasets shared with the site, through the `dataset` index the
 * data plugin publishes (AGL-3080) rather than its collection: their names
 * and their fields' names, in the dataset page's order. None where no plugin
 * keeps datasets here.
 */
async function readIndexedDatasets(
  orgId: string,
  hostId: string,
  cap: number,
): Promise<Window<AiInventoryDataset>> {
  const datasets = pluginRecordIndex('dataset')
  if (!datasets) return { rows: [], truncated: false }
  const { records, truncated } = await datasets.index.list({ orgId, hostId, limit: cap })
  return {
    rows: records.map((record) => {
      const fields = (Array.isArray(record.facts['fields']) ? (record.facts['fields'] as Data[]) : [])
        .map((field) => ({ id: text(field?.['id']), name: text(field?.['name']) || text(field?.['id']) }))
        .filter((field) => field.name)
      return {
        id: record.id,
        name: record.name,
        fields: fields.map((field) => field.name),
        fieldIds: fields.map((field) => field.id || field.name),
      }
    }),
    truncated,
  }
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
  // Each listed screen's published version, read in the same window, for the
  // starter home's untouched test below.
  const screenVersions = new Map<string, string>()

  const [components, layouts, templates, forms, datasets, collections, screens, hostDoc] =
    await Promise.all([
      readWindow<AiInventoryComponent>(
        host.collection('components'),
        ['displayName', 'props', 'rootId', 'versionId', 'deletedAt', 'kind'],
        cap,
        (id, data) => {
          // Soft-deleted, or never published: an instance of either renders nothing.
          if (data['deletedAt'] || !(data['rootId'] || data['versionId'])) return null
          // An email block (AGL-3287) is built from email elements and placed
          // in emails alone: no page, layout or component a job builds can
          // render one, and the email a job builds places no instances.
          if (reusableComponentKindOf(data) === REUSABLE_COMPONENT_KIND_EMAIL) return null
          const props: AiComponentPropTypes = {}
          const bracketedDefaults: Record<string, string[]> = {}
          for (const prop of Array.isArray(data['props']) ? (data['props'] as Data[]) : []) {
            const name = text(prop?.['name'])
            if (!name) continue
            props[name] = text(prop['type']) || 'text'
            const facts = aiBracketedFacts([text(prop['defaultValue'])])
            if (facts.length) bracketedDefaults[name] = facts
          }
          return {
            id,
            name: nameOf(data, id, 'displayName'),
            props,
            ...(Object.keys(bracketedDefaults).length ? { bracketedDefaults } : {}),
          }
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
      readIndexedDatasets(orgId, hostId, cap),
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
        ['displayName', 'slug', 'layoutId', 'kind', 'deletedAt', 'versionId'],
        cap,
        (id, data) => {
          const kind = text(data['kind'])
          // An email design and an error body are not pages a plan links or duplicates.
          if (data['deletedAt'] || (kind && kind !== SCREEN_KIND_TEMPLATE)) return null
          screenVersions.set(id, text(data['versionId']))
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

  const hostData = hostDoc.exists ? ((hostDoc.data() ?? {}) as Data) : null
  const starter = aiStarterHomeCandidate(hostData, screens.rows)
  if (starter) {
    // One more read, and only on a site that still carries the marker: the
    // starter's versions, of which an untouched one has exactly the one it
    // was provisioned with.
    const versions = await host
      .collection('screens')
      .doc(starter)
      .collection('versions')
      .select()
      .limit(2)
      .get()
    if (aiStarterHomeUntouched(screenVersions.get(starter) ?? '', versions.docs.map((doc) => doc.id))) {
      const row = screens.rows.find((screen) => screen.id === starter)
      if (row) row.replaceable = true
    }
  }

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
    theme: aiInventoryTheme(hostData),
    truncated: AI_INVENTORY_KINDS.filter((kind) => windows[kind].truncated),
  }
}
