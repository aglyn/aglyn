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
 * Record pages (AGL-3475): one page per dataset record, rendered from one
 * template page.
 *
 * A site marks a page as the RECORD TEMPLATE of a dataset and names a base
 * path, and every record of that dataset with a page address is served at
 * `/{base}/{address}` — a services dataset becomes `/services/kitchen-remodel`,
 * `/services/roofing`, and so on, all drawn by the one design. Inside the
 * template `{{item.field}}` means exactly what it means inside a repeat
 * (`substituteRecordTokens`, one reference hop), so an author who has built a
 * repeated card already knows how to build the page it links to.
 *
 * ## What lives where
 *
 * - The BINDING — which page, which dataset, which base, which fields — is a
 *   document of this plugin's own, `hosts/{hostId}/recordPages/{screenId}`.
 *   It is per site because the base and the page are; the dataset is the
 *   organization's, so one dataset can have a record template on every site
 *   it is shared with, each at its own base.
 * - The ADDRESS is a field on the record: a text field of the "Page address"
 *   custom type ({@link RECORD_PAGE_ADDRESS_FIELD_TYPE}). It is stored rather
 *   than derived at read time for two reasons. A stored address is what a
 *   query can find — `filterValues.<field>` is already indexed on every record
 *   (AGL-3321) — and it is what keeps a live URL where it is when somebody
 *   renames the record. An address field may name a SOURCE field
 *   (`slugFrom`): an empty address fills in from it once, on whichever write
 *   first finds it empty, and never moves afterwards.
 * - The TEMPLATE is an ordinary screen stamped `kind: 'template'`, the stamp a
 *   blog's entry template carries: it renders at no address of its own, it is
 *   not one of the plan's pages, and its raw `{{item.*}}` never ships.
 *
 * Pure and SDK-free: the console's settings, the canvas preview and the
 * tenant's resolver all read it.
 */

import { AUTHOR_ROUTE_SEGMENT } from '@aglyn/aglyn/app-utils/content-authors'
import { reservedScreenRouteSegment } from '@aglyn/aglyn/app-utils/screen-route'
import { urlSlugSegment } from '@aglyn/aglyn/app-utils/url-slug'
import type { RepeatRowsModel } from '@aglyn/aglyn/app-utils/expand-repeatables'
import type { CustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { BUNDLE_ID } from '../constants/bundle-common'
import type { DatasetFieldDefinition, DatasetModel } from '../model/dataset-models'

/** This plugin's host subcollection the bindings live in. Persisted — never rename. */
export const DATASET_RECORD_PAGES_COLLECTION = 'recordPages'

/**
 * The custom field type a record's page address rides (`text` storage).
 * Persisted on field definitions — never rename.
 */
export const RECORD_PAGE_ADDRESS_FIELD_TYPE = 'pageAddress'

/**
 * The longest page address, in characters. It is the length a plain text
 * value's `filterValues` entry is clipped to (`DATASET_FILTER_VALUE_MAX`), so
 * every address a record can hold is one the indexed lookup can find whole.
 */
export const RECORD_PAGE_ADDRESS_MAX = 64

/** The most path segments a base may have: `services/residential/roofing`. */
export const RECORD_PAGE_BASE_MAX_SEGMENTS = 4

/** The longest single base segment. */
export const RECORD_PAGE_BASE_SEGMENT_MAX = 60

/** How many record templates one site may hold. */
export const RECORD_PAGES_MAX_PER_SITE = 50

/** One URL-safe segment: lowercase letters and digits joined by single hyphens. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A site's record template, as `hosts/{hostId}/recordPages/{screenId}` holds
 * it. The document id is the template screen's id, so a page is the template
 * of at most one dataset.
 */
export interface DatasetRecordPageBinding {
  /** The template screen — also the document id. */
  screenId: string
  /** The organization dataset whose records the pages render. */
  datasetId: string
  /**
   * The path the pages are served under, without slashes at either end: one
   * or more segments (`services`, `services/residential`).
   */
  base: string
  /** The record's page-address field. */
  slugField: string
  /**
   * The field that NAMES a record page — the tab title's first half, the
   * breadcrumb, the sitemap's view of it. Absent, the dataset's first text
   * field does.
   */
  titleField?: string
  /** A field whose value is the search title, used verbatim. */
  seoTitleField?: string
  /** A field whose value is the search description. */
  seoDescriptionField?: string
  /** A field holding the sharing image: a media reference or a URL. */
  seoImageField?: string
}

/**
 * A record's page address from any text: the platform's URL segment
 * (`urlSlugSegment`, the rule category and author pages use) of the text with
 * its accents folded first, so `Café` is `cafe` rather than `caf`, and at most
 * {@link RECORD_PAGE_ADDRESS_MAX} characters. Idempotent, so an address that
 * is already one comes back unchanged — `Kitchen Remodeling` →
 * `kitchen-remodeling` → `kitchen-remodeling`. `''` for text with nothing
 * addressable in it.
 */
export function normalizeRecordAddress(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return urlSlugSegment(
    String(value).normalize('NFKD').replace(/[̀-ͯ]/g, ''),
  )
    .slice(0, RECORD_PAGE_ADDRESS_MAX)
    .replace(/-+$/g, '')
}

/**
 * The "Page address" field type, as the custom-field registry holds it: text
 * storage, offered in the schema dialog, and checked on every write path
 * after the address has been normalized (`fillRecordAddresses`), so what it
 * refuses is an address with nothing addressable left in it, never one typed
 * with a capital letter.
 */
export const RECORD_PAGE_ADDRESS_FIELD: CustomFieldType = {
  name: RECORD_PAGE_ADDRESS_FIELD_TYPE,
  pluginId: BUNDLE_ID,
  label: 'Page address',
  baseType: 'text',
  description:
    'The record’s own page under a record template: lowercase words joined by hyphens',
  validate: (value) =>
    isRecordAddress(value)
      ? null
      : `Use lowercase letters, numbers and hyphens, up to ${RECORD_PAGE_ADDRESS_MAX} characters`,
}

/** Whether a value is already a page address, exactly as stored. */
export function isRecordAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= RECORD_PAGE_ADDRESS_MAX &&
    SEGMENT.test(value)
  )
}

/** The page address a record holds in its address field, or `''`. */
export function recordAddressOf(
  values: Record<string, unknown> | null | undefined,
  slugField: string,
): string {
  return normalizeRecordAddress(values?.[slugField])
}

/**
 * A base as stored: `/Services/Residential/` → `services/residential`. `null`
 * when it is empty, has more than {@link RECORD_PAGE_BASE_MAX_SEGMENTS}
 * segments, or a segment that is not URL-safe once lowercased — a base is
 * typed by a person and refused rather than rewritten, because a rewritten
 * base is a URL they did not choose.
 */
export function normalizeRecordPageBase(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const segments = input
    .trim()
    .toLowerCase()
    .split('/')
    .filter(Boolean)
  if (!segments.length || segments.length > RECORD_PAGE_BASE_MAX_SEGMENTS) {
    return null
  }
  for (const segment of segments) {
    if (segment.length > RECORD_PAGE_BASE_SEGMENT_MAX || !SEGMENT.test(segment)) {
      return null
    }
  }
  return segments.join('/')
}

/** What a base must not collide with, on the site it is chosen for. */
export interface RecordPageBaseContext {
  /** The site's content collections' slugs, which own `/{slug}/…`. */
  collectionSlugs?: readonly string[]
  /**
   * The first segments other plugins serve pages under on every site —
   * `products` for a store — read off their declared sitemap sections.
   */
  pluginRouteSegments?: readonly string[]
  /** The bases the site's OTHER record templates already use. */
  otherBases?: readonly string[]
}

/**
 * Why a base cannot be used on this site, as one sentence an author reads, or
 * `null` when it can.
 *
 * Record pages are answered after every published page and before content
 * collections, so a base whose first segment is a collection's would take
 * that collection's entry addresses; the platform's reserved addresses and
 * another plugin's routes are refused for the same reason. Two templates may
 * nest — `services` and `services/residential` serve different depths — but
 * never share a base.
 */
export function recordPageBaseRefusal(
  input: unknown,
  context: RecordPageBaseContext = {},
): string | null {
  const base = normalizeRecordPageBase(input)
  if (!base) {
    return (
      `Use one to ${RECORD_PAGE_BASE_MAX_SEGMENTS} path segments of lowercase ` +
      'letters, numbers and hyphens, like services or services/residential'
    )
  }
  const [first] = base.split('/')
  const reserved = reservedScreenRouteSegment(base)
  if (reserved || first === AUTHOR_ROUTE_SEGMENT) {
    return `/${reserved ?? first} is a reserved address on every site — pick another base`
  }
  if (context.pluginRouteSegments?.includes(first)) {
    return `/${first} already serves pages of its own on this site — pick another base`
  }
  if (context.collectionSlugs?.includes(first)) {
    return `/${first} is a content collection on this site — pick another base`
  }
  if (context.otherBases?.includes(base)) {
    return `Another record template already uses /${base}`
  }
  return null
}

/** A record page's site path: `/services/kitchen-remodel`. */
export function recordPagePath(base: string, address: string): string {
  return `/${base}/${address}`
}

/** The route a record template answers, as the page review names it. */
export function recordPageRoute(base: string): string {
  return `/${base}/:slug`
}

/**
 * The binding a request path is a record page of, with the address it asks
 * for — or `null`. A path matches a binding when it is the base plus exactly
 * one more segment, so nested bases never compete: `/services/residential`
 * asks `services` for `residential`, and `/services/residential/roofing` asks
 * `services/residential` for `roofing`.
 *
 * The address segment is normalized the way a stored one is, so a request
 * spelled `/services/Kitchen-Remodel` finds the record and the head names the
 * one address that is canonical.
 */
export function matchRecordPagePath<B extends Pick<DatasetRecordPageBinding, 'base'>>(
  bindings: readonly B[],
  path: string,
): { binding: B; address: string } | null {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const base = segments.slice(0, -1).join('/').toLowerCase()
  const binding = bindings.find((one) => one.base === base)
  if (!binding) return null
  const address = normalizeRecordAddress(
    safeDecode(segments[segments.length - 1]),
  )
  return address ? { binding, address } : null
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Is this field a page address? */
export function isRecordAddressField(
  field: DatasetFieldDefinition | null | undefined,
): boolean {
  return field?.type === 'text' && field.customType === RECORD_PAGE_ADDRESS_FIELD_TYPE
}

/** The model's page-address fields, in display order. */
export function recordAddressFieldIds(model: DatasetModel): string[] {
  // Tolerant of a partial model, as the filter fields' readers are: a write
  // path must not fail over a model stored without its `order`.
  return (model.order ?? []).filter((fieldId) =>
    isRecordAddressField(model.fields?.[fieldId]),
  )
}

/**
 * Fills each EMPTY page-address field from the field it names as its source
 * (`slugFrom`), and normalizes every address the values already hold.
 *
 * Run on a record's WHOLE values before every write — a create, an import, a
 * form or automation append, and the merged values of an update — which is
 * what makes "the address fills in once and never moves" true: an update that
 * renames the record arrives with the address it already has, so there is
 * nothing empty to fill. Returns the input itself when nothing changes.
 */
export function fillRecordAddresses<V extends Record<string, unknown>>(
  model: DatasetModel,
  values: V,
): V {
  let next: V | null = null
  for (const fieldId of recordAddressFieldIds(model)) {
    const field = model.fields?.[fieldId]
    const held = values[fieldId]
    const normalized =
      held == null || held === ''
        ? field?.slugFrom
          ? normalizeRecordAddress(values[field.slugFrom])
          : ''
        : normalizeRecordAddress(held)
    if ((held ?? '') === normalized) continue
    next ??= { ...values }
    if (normalized) (next as Record<string, unknown>)[fieldId] = normalized
    else delete (next as Record<string, unknown>)[fieldId]
  }
  return next ?? values
}

/**
 * Unique addresses for a set of records being given one for the first time —
 * `kitchen-remodel`, `kitchen-remodel-2` — in the order given, skipping the
 * addresses already `taken`. A record whose source has nothing addressable in
 * it gets none.
 */
export function uniqueRecordAddresses(
  sources: ReadonlyArray<{ id: string; source: unknown }>,
  taken: Iterable<string> = [],
): Map<string, string> {
  const used = new Set(taken)
  const assigned = new Map<string, string>()
  for (const { id, source } of sources) {
    const base = normalizeRecordAddress(source)
    if (!base) continue
    let candidate = base
    for (let suffix = 2; used.has(candidate); suffix += 1) {
      const tail = `-${suffix}`
      candidate = `${base.slice(0, RECORD_PAGE_ADDRESS_MAX - tail.length).replace(/-+$/g, '')}${tail}`
    }
    used.add(candidate)
    assigned.set(id, candidate)
  }
  return assigned
}

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * The field that names a record page: the binding's `titleField`, else the
 * model's first text field that is not a page address.
 */
export function recordPageNameField(
  binding: Pick<DatasetRecordPageBinding, 'titleField' | 'slugField'>,
  model: DatasetModel,
): string | undefined {
  if (binding.titleField && model.fields[binding.titleField]) {
    return binding.titleField
  }
  return model.order.find((fieldId) => {
    const field = model.fields[fieldId]
    return field?.type === 'text' && fieldId !== binding.slugField && !isRecordAddressField(field)
  })
}

/** What a record page says about itself in the head. */
export interface RecordPageHead {
  /** The page's name: the site title is joined after it. */
  name?: string
  /** An authored search title, used verbatim. */
  title?: string
  description?: string
  /** A media reference or URL, resolved by the head like any page image. */
  image?: string
}

/**
 * The head of one record's page, from the fields the binding picked. Each
 * part is absent when its field is unset or empty, and the head then falls
 * back to the template page's own value, then the site's, exactly as it does
 * for every page.
 */
export function recordPageHead(
  binding: DatasetRecordPageBinding,
  model: DatasetModel,
  values: Record<string, unknown>,
): RecordPageHead {
  const pick = (fieldId: string | undefined) =>
    fieldId ? textOf(values[fieldId]) : ''
  const name = pick(recordPageNameField(binding, model))
  const title = pick(binding.seoTitleField)
  const description = pick(binding.seoDescriptionField)
  const image = pick(binding.seoImageField)
  return {
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  }
}

/**
 * A binding document read back, or `null` when it does not describe one: the
 * fields every reader needs, trimmed. Optional fields that are blank are
 * dropped rather than kept as `''`.
 */
export function parseRecordPageBinding(
  screenId: string,
  data: Record<string, unknown> | null | undefined,
): DatasetRecordPageBinding | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const datasetId = text(data?.['datasetId'])
  const base = normalizeRecordPageBase(data?.['base'])
  const slugField = text(data?.['slugField'])
  if (!screenId || !datasetId || !base || !slugField) return null
  const optional = (key: keyof DatasetRecordPageBinding) => {
    const value = text(data?.[key])
    return value ? { [key]: value } : {}
  }
  return {
    screenId,
    datasetId,
    base,
    slugField,
    ...optional('titleField'),
    ...optional('seoTitleField'),
    ...optional('seoDescriptionField'),
    ...optional('seoImageField'),
  }
}

/**
 * The records a row's reference fields point at, by the dataset each lives in:
 * what a one-hop `{{item.author.name}}` on a record page has to read. A
 * multiple reference contributes every id it holds.
 */
export function referencedRecordIds(
  model: RepeatRowsModel,
  record: Record<string, unknown>,
): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>()
  for (const [fieldId, datasetId] of Object.entries(model.references ?? {})) {
    if (!datasetId || datasetId.includes('/')) continue
    const value = record[fieldId]
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id !== 'string' || !id || id.includes('/')) continue
      const ids = wanted.get(datasetId) ?? new Set<string>()
      ids.add(id)
      wanted.set(datasetId, ids)
    }
  }
  return wanted
}

/**
 * The row key `{{item.url}}` reads: a record's page on this site.
 * Persisted in nothing — it is computed on every read — but bound by authors,
 * so never rename.
 */
export const RECORD_PAGE_URL_KEY = 'url'

/**
 * A dataset's repeated rows, each carrying its page as `url` when this site
 * has a record template for the dataset (AGL-3475) — so a listing card links
 * to the record's page with `{{item.url}}`, and the canvas previews the same
 * link the page renders.
 *
 * A model that declares a field of its own called `url` keeps it: the token
 * always means the dataset's field first. A row with no address has no page,
 * and so no `url`, and its token stays as written. Returns the rows
 * themselves when there is nothing to add.
 */
export function withRecordPageUrls<R extends Record<string, unknown>>(
  rows: R[],
  binding: Pick<DatasetRecordPageBinding, 'base' | 'slugField'> | null | undefined,
  model: DatasetModel,
): R[] {
  if (!binding || model.fields?.[RECORD_PAGE_URL_KEY]) return rows
  return rows.map((row) => {
    const address = recordAddressOf(row, binding.slugField)
    return address
      ? { ...row, [RECORD_PAGE_URL_KEY]: recordPagePath(binding.base, address) }
      : row
  })
}
