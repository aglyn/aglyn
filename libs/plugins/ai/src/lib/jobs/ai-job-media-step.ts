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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import { embeddedMetadataIsCurrent } from '@aglyn/aglyn/app-utils/media-embedded-fields'
import {
  MEDIA_FOLDER_MAX_DEPTH,
  MEDIA_FOLDER_NAME_MAX_LENGTH,
  newMediaFolderDoc,
  normalizeFolderName,
} from '@aglyn/aglyn/app-utils/media-folders'
import {
  MEDIA_TAG_MAX_COUNT,
  MEDIA_TAG_MAX_LENGTH,
  mediaFilterKeys,
  mediaNameWords,
  normalizeMediaTags,
} from '@aglyn/aglyn/app-utils/media-metadata'
import type { PluginAiCapabilityArgsSchema } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AiJobOutput } from '../model/ai-jobs.types'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobEditModel } from './ai-job-edit-step'
import { aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `media` step (AGL-3752): organizing files already in a site's own media
 * library — the folder each is filed in, its tags, its alt text and its name —
 * as a first-class build operation, so "put the kiln photos in a Studio
 * folder", "tag these portfolio" or "write the missing alt text" is one item
 * on Assist's plan card.
 *
 * NO MODEL. The planner wrote the values as the item's arguments; this holds
 * each to the rule the media library's own controls hold it to and writes it,
 * so it costs no credits.
 *
 * ── Only the library's own fields ────────────────────────────────────────
 *
 * Exactly what the Details drawer and the grid's bulk actions write on a
 * file's document: `fileName` (200), `alt` (`MEDIA_ALT_MAX_LENGTH`), `tags`
 * (`normalizeMediaTags`: lower case, 20 of 40 characters), and `folderId`
 * with the legacy `folder` name beside it, with the library's filter and
 * search keys re-derived from the document as the write leaves it
 * (`mediaFilterKeys`). A new folder is the New folder button's: a
 * `mediaFolders` document made by `newMediaFolderDoc`, its name held by
 * `normalizeFolderName`, unique among its siblings without case, at most
 * `MEDIA_FOLDER_MAX_DEPTH` deep. Filing a file writes its folder as the
 * drawer's save does; the stored object takes the folder's path the next time
 * that folder is moved or renamed, as after a drawer save. Its address never
 * changes, so no page that uses it breaks.
 *
 * NEVER: uploading, copying, replacing or deleting a file, its bytes or the
 * details inside them, its sharing or privacy, renaming or deleting a folder,
 * or anything in the organization's shared library (every site of the
 * workspace uses it). Those are not arguments.
 *
 * ── Alt text ─────────────────────────────────────────────────────────────
 *
 * Alt text describes ONE image: `alt` is for one image the request says what
 * it shows. `altFromDetails` writes a missing alt from what the library
 * already holds about the image — its description, or the caption, headline
 * or title inside the file — and names the images that hold none. Never the
 * file name, which read aloud is worse than silence (`inheritedMediaAlt`).
 * The library's alt is what a placement takes when the image is placed;
 * placements made before keep their own.
 *
 * ── Who may ──────────────────────────────────────────────────────────────
 *
 * The rules' own for a site library (`canWriteHostContent`,
 * `hostWritesFrozen`): a member with the admin, editor or author role, while
 * no lockdown freezes the site, its org or the platform. Asked at the door,
 * before the write, and the role again inside the transaction that writes.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────
 *
 * One transaction reads the files and folders as they are stored and writes
 * only what differs; a folder of the asked name is found before one is made.
 * A pass asked again writes nothing.
 */

export const AI_MEDIA_KIND = 'media' as const

/** ASSUMED: the site, the org, up to 20 file lookups and one transaction. No model. */
export const AI_JOB_MEDIA_STEP_MINIMUM_MS = 8_000

export const AI_MEDIA_NO_SITE_COPY = 'Open the site whose media library should change.'
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const AI_MEDIA_ROLE_COPY = `Organizing the media library needs the "${orgPermissionLabel('site.edit')}" permission on this site — ask an organization admin.`
export const AI_MEDIA_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_MEDIA_NOTHING_COPY = 'The request named no file in the media library and no change this could make to it.'

/** Where a person finds what the op changed. */
export const AI_MEDIA_WHERE = 'the site’s Media library'

/** The output's fixed id: one site's library, whatever changed. */
export const AI_MEDIA_OUTPUT_ID = 'library'

/** The library's own limits, each from the control that edits the field. */
export const AI_MEDIA_LIMITS = {
  /** Files one item may name or select. */
  files: 20,
  /** The Details drawer's file name. */
  fileName: 200,
  alt: MEDIA_ALT_MAX_LENGTH,
  tags: MEDIA_TAG_MAX_COUNT,
  tag: MEDIA_TAG_MAX_LENGTH,
  /** A folder path: five names of 60 and their separators. */
  folder: MEDIA_FOLDER_MAX_DEPTH * (MEDIA_FOLDER_NAME_MAX_LENGTH + 3),
} as const

/** The item's arguments, as the planner fills them in. */
export const AI_MEDIA_ARGS_SCHEMA: PluginAiCapabilityArgsSchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      description: 'Files already in this site’s media library, each by its id or exact file name as the request gives it.',
      items: { type: 'string', maxLength: 200 },
      maxItems: AI_MEDIA_LIMITS.files,
    },
    missingAlt: {
      type: 'boolean',
      description: 'True to also take the site library’s images that have no alt text yet (up to 20), for altFromDetails.',
    },
    folder: {
      type: 'string',
      description: 'The folder to file them in, as a path such as Portfolio / 2026; a folder not there yet is made.',
      maxLength: AI_MEDIA_LIMITS.folder,
    },
    addTags: {
      type: 'array',
      description: 'Tags to add, each a word or two.',
      items: { type: 'string', maxLength: AI_MEDIA_LIMITS.tag },
      maxItems: AI_MEDIA_LIMITS.tags,
    },
    removeTags: {
      type: 'array',
      description: 'Tags to take off.',
      items: { type: 'string', maxLength: AI_MEDIA_LIMITS.tag },
      maxItems: AI_MEDIA_LIMITS.tags,
    },
    rename: {
      type: 'string',
      description: 'A new file name, for exactly one file. Its address does not change.',
      maxLength: AI_MEDIA_LIMITS.fileName,
    },
    alt: {
      type: 'string',
      description:
        'Alt text for exactly one image, saying what it shows in one plain sentence, only from what the request says about it. Never its file name.',
      maxLength: AI_MEDIA_LIMITS.alt,
    },
    altFromDetails: {
      type: 'boolean',
      description: 'True to write each image’s missing alt text from its own description or caption already in the library.',
    },
  },
  additionalProperties: false,
}

/** What an item asks, each value read and held to the library's rule. */
export interface AiMediaRequest {
  files: string[]
  missingAlt: boolean
  /** The folder path's names, root first. */
  folder?: string[]
  addTags: string[]
  removeTags: string[]
  rename?: string
  alt?: string
  altFromDetails: boolean
}

export interface AiMediaRead {
  request: AiMediaRequest
  problems: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).map(text).filter(Boolean)

/** A folder path's names, root first, or a sentence saying why it cannot be one. */
export function aiMediaFolderPathOf(value: string): string[] | { error: string } {
  const names = value.split('/').map((part) => part.trim()).filter(Boolean)
  if (!names.length) return { error: 'The folder has no name.' }
  if (names.length > MEDIA_FOLDER_MAX_DEPTH) return { error: `Folders can nest at most ${MEDIA_FOLDER_MAX_DEPTH} levels.` }
  const normalized: string[] = []
  for (const name of names) {
    const one = normalizeFolderName(name)
    if (!one) return { error: `A folder name is at most ${MEDIA_FOLDER_NAME_MAX_LENGTH} characters.` }
    normalized.push(one)
  }
  return normalized
}

/** Words that name no image: alt text made of them alone describes nothing. */
const EMPTY_ALT = /^(an? |the )?(image|photo|photograph|picture|pic|graphic|img|icon|file|logo|banner|thumbnail)s?( of)?\.?$/i

/** Why this alt text describes nothing, or `null`. */
export function aiMediaAltProblem(alt: string, fileName: string): string | null {
  if (EMPTY_ALT.test(alt.trim())) return `“${alt}” does not say what the image shows.`
  const folded = (value: string) => mediaNameWords(value).toLowerCase().replace(/\s+/g, ' ')
  const base = fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '')
  if (folded(alt) && (folded(alt) === folded(fileName) || folded(alt) === folded(base))) {
    return 'Alt text that repeats the file name does not say what the image shows.'
  }
  return null
}

/** The item's arguments read: what may be written, and a sentence for each that may not. */
export function aiMediaRequestOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiMediaRead {
  const problems: string[] = []
  const files = [...new Set(list(inputs?.['files']).map((one) => one.slice(0, 200)))]
  if (files.length > AI_MEDIA_LIMITS.files) problems.push(`One change takes at most ${AI_MEDIA_LIMITS.files} files; the rest were left.`)
  const request: AiMediaRequest = {
    files: files.slice(0, AI_MEDIA_LIMITS.files),
    missingAlt: inputs?.['missingAlt'] === true,
    addTags: normalizeMediaTags(list(inputs?.['addTags'])),
    removeTags: normalizeMediaTags(list(inputs?.['removeTags'])),
    altFromDetails: inputs?.['altFromDetails'] === true,
  }
  const folder = text(inputs?.['folder'])
  if (folder) {
    const path = aiMediaFolderPathOf(folder)
    if (Array.isArray(path)) request.folder = path
    else problems.push(path.error)
  }
  const rename = text(inputs?.['rename'])
  if (rename) {
    if (rename.length > AI_MEDIA_LIMITS.fileName) problems.push(`A file name is at most ${AI_MEDIA_LIMITS.fileName} characters.`)
    else if (request.files.length !== 1 || request.missingAlt) problems.push('A new name is for exactly one file.')
    else request.rename = rename
  }
  const alt = text(inputs?.['alt'])
  if (alt) {
    if (alt.length > AI_MEDIA_LIMITS.alt) problems.push(`Alt text is at most ${AI_MEDIA_LIMITS.alt} characters.`)
    else if (request.files.length !== 1 || request.missingAlt) problems.push('Alt text describes one image; name exactly one.')
    else request.alt = alt
  }
  return { request, problems }
}

/** Whether a read request names files and a change to make to them. */
export function aiMediaRequestEmpty(request: AiMediaRequest): boolean {
  const selects = request.files.length > 0 || request.missingAlt
  const changes =
    request.folder !== undefined ||
    request.addTags.length > 0 ||
    request.removeTags.length > 0 ||
    request.rename !== undefined ||
    request.alt !== undefined ||
    request.altFromDetails
  return !selects || !changes
}

// ── Files and folders ─────────────────────────────────────────────────────

/** A site library row, as the op reads it. */
export interface AiMediaRow {
  id: string
  /** The document as stored, which the filter keys are derived from. */
  data: Record<string, unknown>
}

/** A media folder, as the op reads it. */
export interface AiMediaFolderRow {
  id: string
  name: string
  parentId: string | null
}

const fileNameOf = (row: AiMediaRow) => String(row.data['fileName'] ?? '') || row.id
const isImage = (row: AiMediaRow) => String(row.data['contentType'] ?? '').startsWith('image/')

/**
 * The file a name or id names among the rows read from the site's library:
 * never a deleted one. Its id wins over a file name; two files of one name
 * are refused in words.
 */
export function aiMediaFileOf(source: string, rows: readonly AiMediaRow[]): AiMediaRow | { error: string } {
  const live = rows.filter((row) => row.data['deletedAt'] == null)
  const byId = live.find((row) => row.id === source)
  if (byId) return byId
  const named = live.filter((row) => row.data['fileName'] === source)
  if (named.length > 1) return { error: `The media library has more than one file called “${source}”; name it by its id.` }
  return named[0] ?? { error: `This site’s media library has no file “${source}”.` }
}

/**
 * Alt text written from what the library already holds about an image: its
 * own description, else the caption, headline or title read from inside the
 * file (only while that record still describes the file's bytes). `null`
 * when it holds none that says what the image shows.
 */
export function aiMediaAltFromDetails(row: AiMediaRow): string | null {
  const candidates: unknown[] = [row.data['description']]
  const embedded = row.data['embeddedMetadata']
  if (embeddedMetadataIsCurrent(embedded, row.data['contentSha256'])) {
    const byKey = new Map(embedded.fields.map((field) => [field.key, field.value]))
    candidates.push(byKey.get('description'), byKey.get('headline'), byKey.get('title'))
  }
  for (const candidate of candidates) {
    const value = text(candidate)
    if (!value) continue
    const alt = value.length > AI_MEDIA_LIMITS.alt ? `${value.slice(0, AI_MEDIA_LIMITS.alt - 1).replace(/\s+\S*$/, '')}…` : value
    if (!aiMediaAltProblem(alt, fileNameOf(row))) return alt
  }
  return null
}

/** A folder to make: its name, and its parent's id or its index among those made before it. */
export interface AiMediaFolderCreate {
  name: string
  parent: { id: string | null } | { made: number }
}

/**
 * Where a folder path lands: the existing folders it walks, matched without
 * case among siblings as the library's sibling rule matches them, and the
 * folders left to make below the last one found.
 */
export function aiMediaFolderPlan(
  path: readonly string[],
  folders: readonly AiMediaFolderRow[],
): { existingId: string | null; create: AiMediaFolderCreate[] } {
  let parentId: string | null = null
  let index = 0
  for (; index < path.length; index += 1) {
    const name = path[index].toLowerCase()
    const found = folders.find((folder) => folder.parentId === parentId && folder.name.trim().toLowerCase() === name)
    if (!found) break
    parentId = found.id
  }
  const create: AiMediaFolderCreate[] = path.slice(index).map((name, offset) => ({
    name,
    parent: offset === 0 ? { id: parentId } : { made: offset - 1 },
  }))
  return { existingId: parentId, create }
}

/** One file's change: the fields to write and the sentences that say it. */
export interface AiMediaFileChange {
  update: Record<string, unknown>
  said: string[]
  notDone: string[]
}

/**
 * What the request changes on one file, compared with what is stored: only
 * the fields that differ, with the filter keys re-derived from the document
 * as the change leaves it, exactly as the Details drawer derives them.
 */
export function aiMediaFileChange(
  row: AiMediaRow,
  request: AiMediaRequest,
  folder: { id: string; name: string } | null,
): AiMediaFileChange {
  const name = fileNameOf(row)
  const update: Record<string, unknown> = {}
  const said: string[] = []
  const notDone: string[] = []
  if (request.rename && request.rename !== row.data['fileName']) {
    update['fileName'] = request.rename
    said.push(`“${name}” is now called “${request.rename}”.`)
  }
  const tags = Array.isArray(row.data['tags']) ? (row.data['tags'] as unknown[]).map(String) : []
  if (request.addTags.length || request.removeTags.length) {
    const removed = new Set(request.removeTags)
    const next = normalizeMediaTags([...tags, ...request.addTags]).filter((tag) => !removed.has(tag))
    const dropped = request.addTags.filter((tag) => !removed.has(tag) && !next.includes(tag))
    if (dropped.length) notDone.push(`“${name}” holds ${AI_MEDIA_LIMITS.tags} tags at most, so ${dropped.join(', ')} was not added.`)
    if (JSON.stringify(next) !== JSON.stringify(tags)) {
      update['tags'] = next
      said.push(`“${name}” is tagged ${next.length ? next.join(', ') : 'with nothing'}.`)
    }
  }
  if (folder && (row.data['folderId'] ?? null) !== folder.id) {
    update['folderId'] = folder.id
    // The legacy name beside it, as the drawer keeps it until every reader is on folderId.
    update['folder'] = folder.name
    said.push(`“${name}” is in ${folder.name}.`)
  }
  const storedAlt = text(row.data['alt'])
  let alt: string | null = null
  if (request.alt) {
    if (!isImage(row)) notDone.push(`“${name}” is not an image, so it takes no alt text.`)
    else {
      const problem = aiMediaAltProblem(request.alt, name)
      if (problem) notDone.push(problem)
      else alt = request.alt
    }
  } else if (request.altFromDetails && isImage(row) && !storedAlt) {
    alt = aiMediaAltFromDetails(row)
    if (!alt) notDone.push(`“${name}” has no description or caption in the library to write its alt text from; say what it shows.`)
  }
  if (alt && alt !== storedAlt) {
    update['alt'] = alt
    said.push(`“${name}” has alt text.`)
  }
  if (update['fileName'] !== undefined || update['alt'] !== undefined) {
    Object.assign(update, mediaFilterKeys({ ...row.data, ...update }))
  }
  return { update, said, notDone }
}

export type AiMediaWrite =
  | { ok: true; done: string[]; notDone: string[]; changedFiles: number; madeFolders: string[]; altChanged: boolean }
  | { ok: false; error: string }

const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The library change, written in one transaction that reads the site, its
 * folders and the named files as they are stored NOW: the member still holds
 * a write role, a folder of the asked name is used before one is made, and
 * only fields that differ are written.
 */
export async function writeAiMediaChanges(
  firestore: Firestore,
  input: { hostId: string; uid: string; request: AiMediaRequest; now: Date },
): Promise<AiMediaWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const mediaRef = hostRef.collection('media')
  const foldersRef = hostRef.collection('mediaFolders')
  const { request } = input
  return firestore.runTransaction(async (tx): Promise<AiMediaWrite> => {
    // Every read first: a transaction writes nothing until its reads are done.
    const host = await tx.get(hostRef)
    if (!host.exists) return { ok: false, error: 'Unknown site' }
    if (!holdsSiteKey(host, input.uid, 'site.edit')) return { ok: false, error: AI_MEDIA_ROLE_COPY }
    const notDone: string[] = []
    const rows = new Map<string, AiMediaRow>()
    for (const source of request.files) {
      const read: AiMediaRow[] = []
      if (ID_SHAPE.test(source)) {
        const byId = await tx.get(mediaRef.doc(source))
        if (byId.exists) read.push({ id: byId.id, data: byId.data() ?? {} })
      }
      const byName = await tx.get(mediaRef.where('fileName', '==', source).limit(5))
      for (const doc of byName.docs) if (!read.some((row) => row.id === doc.id)) read.push({ id: doc.id, data: doc.data() })
      const found = aiMediaFileOf(source, read)
      if ('error' in found) notDone.push(found.error)
      else rows.set(found.id, found)
    }
    if (request.missingAlt) {
      // The library's own "Alt text is missing" filter: `hasAlt`, which every writer derives.
      const missing = await tx.get(mediaRef.where('hasAlt', '==', false).limit(AI_MEDIA_LIMITS.files * 2))
      for (const doc of missing.docs) {
        const row = { id: doc.id, data: doc.data() }
        if (rows.size >= AI_MEDIA_LIMITS.files) break
        if (row.data['deletedAt'] == null && isImage(row)) rows.set(row.id, row)
      }
      if (!missing.docs.length && !request.files.length) notDone.push('Every image in this site’s media library has alt text.')
    }
    const folders: AiMediaFolderRow[] = []
    if (request.folder && rows.size) {
      const stored = await tx.get(foldersRef.limit(500))
      for (const doc of stored.docs) {
        folders.push({ id: doc.id, name: String(doc.get('name') ?? ''), parentId: (doc.get('parentId') as string | null) ?? null })
      }
    }

    let folder: { id: string; name: string } | null = null
    const madeFolders: string[] = []
    if (request.folder && rows.size) {
      const plan = aiMediaFolderPlan(request.folder, folders)
      const made: string[] = []
      for (const one of plan.create) {
        const ref = foldersRef.doc(createResourceUid())
        const parentId = 'id' in one.parent ? one.parent.id : made[one.parent.made]
        // The New folder button's document: a site library's folder stores no scope.
        tx.set(ref, newMediaFolderDoc({ name: one.name, parentId, createdAt: FieldValue.serverTimestamp(), visibleTo: null }))
        made.push(ref.id)
        madeFolders.push(one.name)
      }
      const id = made[made.length - 1] ?? plan.existingId
      if (id) folder = { id, name: request.folder[request.folder.length - 1] }
    }

    const done: string[] = madeFolders.map((name) => `Made the folder ${name}.`)
    let changedFiles = 0
    let altChanged = false
    for (const row of rows.values()) {
      const change = aiMediaFileChange(row, request, folder)
      notDone.push(...change.notDone)
      if (!Object.keys(change.update).length) continue
      tx.update(mediaRef.doc(row.id), { ...change.update, updatedAt: input.now })
      done.push(...change.said)
      changedFiles += 1
      if (change.update['alt'] !== undefined) altChanged = true
    }
    return { ok: true, done, notDone, changedFiles, madeFolders, altChanged }
  })
}

// ── The step ──────────────────────────────────────────────────────────────

/** Why this member may not organize this site's library now, or `null`. */
export async function aiMediaAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!input.host.exists) return 'Unknown site'
  if (!holdsSiteKey(input.host, input.uid, 'site.edit')) return AI_MEDIA_ROLE_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_MEDIA_LOCKED_COPY : null
}

/** The output's note: what changed, that it is live, and what was not done. */
export function aiMediaOutputNote(done: readonly string[], notDone: readonly string[], altChanged: boolean): string {
  // The build's own wording for an item with no draft state (AGL-3745).
  const did = done.length ? `${done.join(' ')} Live now, in ${AI_MEDIA_WHERE}.` : 'Nothing needed changing.'
  const placed = altChanged ? ' Images placed from now on take the new alt text; ones already on a page keep their own.' : ''
  const not = notDone.length ? ` Not done: ${notDone.join(' ')}` : ''
  return `${did}${placed}${not}`.slice(0, 1_000)
}

export interface AiJobMediaStepDeps {
  write?: typeof writeAiMediaChanges
  lockdown?: typeof getLockdownVerdict
}

export function createAiJobMediaStep(deps: AiJobMediaStepDeps = {}): AiJobStepRunner {
  const write = deps.write ?? writeAiMediaChanges
  return async ({ job, now, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_MEDIA_NO_SITE_COPY)
    const read = aiMediaRequestOf(job.inputs)
    if (aiMediaRequestEmpty(read.request)) return unspent([AI_MEDIA_NOTHING_COPY, ...read.problems].join(' '))
    const orgData = (org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)) as Record<string, unknown> | null
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiMediaAccessRefusal({ host, uid: job.createdBy, org: orgData }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const written = await write(firestore, { hostId, uid: job.createdBy, request: read.request, now })
    if (written.ok === false) return unspent(written.error)
    const notDone = [...read.problems, ...written.notDone]
    if (!written.done.length && notDone.length) return unspent(notDone.join(' '))
    const output: AiJobOutput = {
      resource: 'media',
      id: AI_MEDIA_OUTPUT_ID,
      hostId,
      hostSubdomain: (typeof host.get('subdomain') === 'string' && host.get('subdomain')) || null,
      label: 'Media library',
      note: aiMediaOutputNote(written.done, notDone, written.altChanged),
    }
    return aiUnspentOutcome(model, { outputs: [output] })
  }
}

export const runAiJobMediaStep = createAiJobMediaStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiMediaJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  lockdown?: typeof getLockdownVerdict
}

/**
 * A library change is admitted on a site of the job's own org, for a member
 * who may write its library now, where the request names files and a change
 * this can make. Refused in those words before anything is written.
 */
export function createAiMediaJobAdmission(deps: AiMediaJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_MEDIA_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiMediaAccessRefusal({ host, uid: context.uid ?? '', org: context.org }, { lockdown: deps.lockdown })
    if (refused) return { status: 403, error: refused }
    const read = aiMediaRequestOf(context.inputs as Record<string, unknown>)
    return aiMediaRequestEmpty(read.request) ? { status: 400, error: [AI_MEDIA_NOTHING_COPY, ...read.problems].join(' ') } : null
  }
}

export const aiMediaJobAdmission = createAiMediaJobAdmission()

/** Registers the media library step and its door (AGL-3752). */
export function registerAiMediaJob(): void {
  registerAiJobStep(AI_MEDIA_KIND, runAiJobMediaStep, { minimumMs: AI_JOB_MEDIA_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_MEDIA_KIND, aiMediaJobAdmission)
}
