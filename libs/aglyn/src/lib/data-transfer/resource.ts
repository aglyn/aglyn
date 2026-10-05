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

/*==========================================
 * TRANSFER RESOURCES — what can be imported or exported, and its fields.
 *
 * A resource is one kind of thing a person moves in or out of Aglyn: a
 * collection of records (rows in a file) or a set of site items (a
 * package). The plugin that owns the thing declares it; this module only
 * says what a declaration looks like and what a field may be, so every
 * importer, exporter and wizard reads the same shape.
 *
 * ## A field says what it is, not how it is stored
 *
 * `type` is the field's meaning to a person — an email, a currency amount,
 * a picklist — which is what decides how a cell is read (`derive.ts`), how
 * a header is guessed (`header-match.ts`) and which policies make sense
 * (`policy.ts`: only a list can be appended to). Where the value lives in
 * storage is the owning plugin's business.
 *
 * ## Read-only, derived and system fields export but never import
 *
 * A derived field (a score, a count) is computed from others; a system
 * field (the Aglyn id, created/updated times) is written by the platform.
 * Both are offered on export because a person wants them in the file, and
 * neither is ever written from a file. A `matchKey` field — the Aglyn id
 * above all — may still be MAPPED on import, because it identifies which
 * existing record a row is about; it is read, never written.
 *=========================================*/

/** Where the records of a resource live: the organization, or one site. */
export type TransferScope = 'org' | 'host'

/** Rows in a file, or a set of site items carried as a package. */
export type TransferKind = 'records' | 'package'

/** The file formats a resource can be read from and written to. */
export type TransferFormat = 'csv' | 'json' | 'ndjson'

export const TRANSFER_FORMATS: readonly TransferFormat[] = ['csv', 'json', 'ndjson']

/** The bounds one transfer of a resource is held to. */
export interface TransferLimits {
  /** The most rows (or items) one file may carry. */
  maxRows: number
  /** The most bytes one uploaded file may carry, when the resource bounds it. */
  maxBytes?: number
}

/** One resource as its owning plugin declares it. */
export interface TransferResourceDescriptor {
  /** Stable key, lowercase words joined by `-` or `.` — the URL and storage name. */
  key: string
  /** What a person calls one batch of it ("People", "Pages"). */
  label: string
  /** One record ("Person", "Page"); defaults to `label`. */
  singularLabel?: string
  scope: TransferScope
  kinds: readonly TransferKind[]
  formats: readonly TransferFormat[]
  limits?: TransferLimits
  /** One sentence on what moves, shown on the hub. */
  description?: string
  /**
   * The resource is moved one instance at a time — one dataset's records, not
   * every dataset's — so every key that reaches it names the instance as
   * `<key>:<instance>` ({@link transferResourceInstanceKey}). A job, a
   * person's remembered choices and the one-running-import rule are then kept
   * per instance, and the plugin's hooks read which one from the context's
   * `resource` ({@link transferResourceInstanceOf}).
   */
  instances?: boolean
  /**
   * Any member may EXPORT the records (and open the export dialog), as far
   * as their scope lets them see them — a collaborator only on a site they
   * reach — because the rules let every member read them (a dataset's
   * records). See `data-transfer/access.ts`.
   */
  readableByMembers?: boolean
  /**
   * The permission that admits a member to EXPORT the records, beside
   * `data.manage`, which always does. A resource that declares neither this
   * nor `readableByMembers` exports for `data.manage` alone. Importing needs
   * `data.manage` either way.
   */
  readPermission?: string
  /**
   * The resource is exported and never imported — a record of work done (a
   * CRM's logged activities) or a setup edited on its own page. The upload
   * refuses it, its plugin registers no `apply` or `revert`, and a surface
   * offers only Export (AGL-3528).
   */
  exportOnly?: boolean
}

/** Whether a file may be imported into the resource. */
export function transferResourceImports(descriptor: Pick<TransferResourceDescriptor, 'exportOnly'>): boolean {
  return descriptor.exportOnly !== true
}

/** What a field means, which decides how a cell is read and written. */
export type TransferFieldType =
  | 'text'
  | 'longText'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'integer'
  | 'currency'
  | 'percent'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'picklist'
  | 'multiPicklist'
  | 'tags'
  | 'address'
  | 'lookup'
  | 'json'
  | 'list'

export const TRANSFER_FIELD_TYPES: readonly TransferFieldType[] = [
  'text',
  'longText',
  'email',
  'phone',
  'url',
  'number',
  'integer',
  'currency',
  'percent',
  'boolean',
  'date',
  'datetime',
  'picklist',
  'multiPicklist',
  'tags',
  'address',
  'lookup',
  'json',
  'list',
]

/**
 * The types whose value is a list, and so the only ones a file can append to:
 * picklist values, tags (kept lower-case), and a `list` of free text items
 * kept as typed.
 */
export const TRANSFER_LIST_FIELD_TYPES: readonly TransferFieldType[] = ['multiPicklist', 'tags', 'list']

/**
 * What a lookup field points at: another resource, found by one of its
 * match keys (a company by domain, an owner by email).
 */
export interface TransferLookupTarget {
  /** The resource key of the target. */
  resource: string
  /** The target's field ids a cell may name it by, in the order they are tried. */
  by: readonly string[]
  /** Whether an unresolved value may be offered "create it" in the wizard. */
  creatable?: boolean
}

/** One field of a resource. */
export interface TransferField {
  /** Stable id; a custom field's id is `custom:<key>`. */
  id: string
  label: string
  /** The group id the field is listed under in a picker. */
  group?: string
  type: TransferFieldType
  /** A new record cannot be created without it. */
  required?: boolean
  /** Exported, never written from a file. */
  readOnly?: boolean
  /** Computed from other fields; exported, never written from a file. */
  derived?: boolean
  /** Written by the platform (id, created, updated); exported, never written. */
  system?: boolean
  /** Defined by the organization rather than the resource. */
  custom?: boolean
  /** May be mapped on import to identify an existing record even when it is never written. */
  matchKey?: boolean
  /** Header spellings that mean this field, beside its label and id. */
  aliases?: readonly string[]
  /** The picklist whose values a `picklist` or `multiPicklist` field holds. */
  picklistId?: string
  /** What a `lookup` field resolves to. */
  lookup?: TransferLookupTarget
  /** The longest text the field stores. */
  maxLength?: number
  /** One sentence shown beside the field in a picker. */
  description?: string
}

/** The field id every resource uses for the record's Aglyn id. */
export const TRANSFER_ID_FIELD = 'id'

/** Whether values of `type` are lists. */
export function isTransferListType(type: TransferFieldType): boolean {
  return TRANSFER_LIST_FIELD_TYPES.includes(type)
}

/** Whether a file's cell may be WRITTEN to `field`. */
export function isTransferFieldWritable(field: TransferField): boolean {
  return !field.readOnly && !field.derived && !field.system
}

/** Whether a file's column may be MAPPED to `field` on import — written, or read to match. */
export function isTransferFieldImportable(field: TransferField): boolean {
  return isTransferFieldWritable(field) || Boolean(field.matchKey)
}

const RESOURCE_KEY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

/** Whether `key` is a well-formed resource key. */
export function isTransferResourceKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 64 && RESOURCE_KEY.test(key)
}

/**
 * What is wrong with a declaration, as sentences; empty when nothing is.
 * Checked when a plugin registers, so a malformed one fails loudly at
 * startup rather than in a person's wizard.
 */
export function transferResourceProblems(descriptor: TransferResourceDescriptor): string[] {
  const problems: string[] = []
  if (!isTransferResourceKey(descriptor.key)) {
    problems.push(`"${String(descriptor.key)}" is not a resource key (lowercase words joined by - or .).`)
  }
  if (!String(descriptor.label ?? '').trim()) problems.push(`${descriptor.key} has no label.`)
  if (descriptor.scope !== 'org' && descriptor.scope !== 'host') {
    problems.push(`${descriptor.key} has scope "${String(descriptor.scope)}"; it must be org or host.`)
  }
  if (!descriptor.kinds?.length) problems.push(`${descriptor.key} declares no kind.`)
  for (const kind of descriptor.kinds ?? []) {
    if (kind !== 'records' && kind !== 'package') problems.push(`${descriptor.key} has unknown kind "${String(kind)}".`)
  }
  if (!descriptor.formats?.length) problems.push(`${descriptor.key} declares no format.`)
  for (const format of descriptor.formats ?? []) {
    if (!TRANSFER_FORMATS.includes(format)) problems.push(`${descriptor.key} has unknown format "${String(format)}".`)
  }
  const limits = descriptor.limits
  if (limits && !(Number.isInteger(limits.maxRows) && limits.maxRows > 0)) {
    problems.push(`${descriptor.key} has a row limit that is not a positive whole number.`)
  }
  if (limits?.maxBytes !== undefined && !(Number.isInteger(limits.maxBytes) && limits.maxBytes > 0)) {
    problems.push(`${descriptor.key} has a byte limit that is not a positive whole number.`)
  }
  if (descriptor.instances !== undefined && typeof descriptor.instances !== 'boolean') {
    problems.push(`${descriptor.key} says "instances" with something other than true or false.`)
  }
  if (descriptor.readPermission !== undefined && !String(descriptor.readPermission).trim()) {
    problems.push(`${descriptor.key} names an empty read permission.`)
  }
  if (descriptor.readableByMembers !== undefined && typeof descriptor.readableByMembers !== 'boolean') {
    problems.push(`${descriptor.key} says "readableByMembers" with something other than true or false.`)
  }
  if (descriptor.readableByMembers === true && descriptor.readPermission !== undefined) {
    problems.push(`${descriptor.key} is readable by every member and names a read permission; say one.`)
  }
  if (descriptor.exportOnly !== undefined && typeof descriptor.exportOnly !== 'boolean') {
    problems.push(`${descriptor.key} says "exportOnly" with something other than true or false.`)
  }
  return problems
}

/** What separates a resource's key from the instance it names: `data.dataset:<datasetId>`. */
export const TRANSFER_INSTANCE_SEPARATOR = ':'

const INSTANCE_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Whether `instance` can be named in a key: letters, digits, `_` and `-`, at most 128. */
export function isTransferResourceInstance(instance: unknown): instance is string {
  return typeof instance === 'string' && INSTANCE_ID.test(instance)
}

/**
 * The key that names one instance of a resource declared with `instances`:
 * `data.dataset` and `abc123` make `data.dataset:abc123`. Throws for an
 * instance a key cannot carry, so a malformed id never becomes a job's key.
 */
export function transferResourceInstanceKey(key: string, instance: string): string {
  if (!isTransferResourceInstance(instance)) {
    throw new Error(`"${String(instance)}" cannot name an instance of ${key}.`)
  }
  return `${key}${TRANSFER_INSTANCE_SEPARATOR}${instance}`
}

/**
 * A key read as the declared resource and the instance it names, if any:
 * `data.dataset:abc123` is `{ key: 'data.dataset', instance: 'abc123' }`, and
 * `people` is `{ key: 'people', instance: null }`. A suffix that is not a
 * well-formed instance is left in `key`, which then names no declaration.
 */
export function parseTransferResourceKey(key: string): { key: string; instance: string | null } {
  const text = String(key ?? '').trim()
  const at = text.indexOf(TRANSFER_INSTANCE_SEPARATOR)
  if (at < 0) return { key: text, instance: null }
  const instance = text.slice(at + 1)
  return isTransferResourceInstance(instance) ? { key: text.slice(0, at), instance } : { key: text, instance: null }
}

/** The instance a hook's context names (`ctx.resource`), or `null` for a resource without instances. */
export function transferResourceInstanceOf(context: { resource: string }): string | null {
  return parseTransferResourceKey(context.resource).instance
}

/** What is wrong with a field list, as sentences; empty when nothing is. */
export function transferFieldProblems(fields: readonly TransferField[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const field of fields) {
    const id = String(field.id ?? '')
    if (!id.trim()) {
      problems.push(`A field labeled "${field.label}" has no id.`)
      continue
    }
    if (seen.has(id)) problems.push(`Field "${id}" is declared twice.`)
    seen.add(id)
    if (!TRANSFER_FIELD_TYPES.includes(field.type)) problems.push(`Field "${id}" has unknown type "${String(field.type)}".`)
    if ((field.type === 'picklist' || field.type === 'multiPicklist') && !field.picklistId) {
      problems.push(`Field "${id}" is a picklist with no picklistId.`)
    }
    if (field.type === 'lookup' && !field.lookup?.by?.length) {
      problems.push(`Field "${id}" is a lookup that names no target field.`)
    }
    if (field.required && !isTransferFieldWritable(field)) {
      problems.push(`Field "${id}" is required but can never be written.`)
    }
  }
  return problems
}
