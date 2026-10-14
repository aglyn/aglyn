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
 * The media library step (AGL-3752). Its promises:
 *
 *  - Only fields the library's Details drawer and bulk actions write — the
 *    folder, tags, alt text and file name — each held to that control's rule,
 *    with the filter keys re-derived; a folder made as New folder makes it.
 *  - Files from the site's own library by id or exact name, never a deleted
 *    one, and two of one name refused. Nothing is uploaded, copied or deleted.
 *  - Alt text is specific: one image the request describes, or written from
 *    the caption or description the library already holds; never the file
 *    name or a word like "image".
 *  - Live on confirm, idempotent: only what differs is written, and a folder
 *    of the asked name is found before one is made.
 *  - Only a member who may edit the site, while nothing freezes it. No model
 *    and no credits; offered to a build as an item, Free included.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { MEDIA_EMBEDDED_METADATA_VERSION } from '@aglyn/aglyn/app-utils/media-embedded-fields'
import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES, aiBuildOpLines } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_MEDIA_STEP_MINIMUM_MS,
  AI_MEDIA_LOCKED_COPY,
  AI_MEDIA_NOTHING_COPY,
  AI_MEDIA_ROLE_COPY,
  aiMediaAltFromDetails,
  aiMediaAltProblem,
  aiMediaFileChange,
  aiMediaFileOf,
  aiMediaFolderPathOf,
  aiMediaFolderPlan,
  aiMediaRequestEmpty,
  aiMediaRequestOf,
  createAiJobMediaStep,
  createAiMediaJobAdmission,
  registerAiMediaJob,
  writeAiMediaChanges,
  type AiMediaRequest,
  type AiMediaRow,
} from './ai-job-media-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-13T15:00:00.000Z')
const FREE = { plan: 'free', billingStatus: 'active' }

function photo(id: string, data: Record<string, unknown> = {}): AiMediaRow {
  return { id, data: { fileName: `${id}.jpg`, contentType: 'image/jpeg', tags: [], alt: '', ...data } }
}

const request = (overrides: Partial<AiMediaRequest> = {}): AiMediaRequest => ({
  files: ['kiln.jpg'],
  missingAlt: false,
  addTags: [],
  removeTags: [],
  altFromDetails: false,
  ...overrides,
})

describe('what a media library change may ask (AGL-3752)', () => {
  it('reads files, a folder path, tags, a name and alt text to the library’s own rules', () => {
    const read = aiMediaRequestOf({
      files: ['kiln.jpg'],
      folder: 'Studio /  Kilns ',
      addTags: ['Pottery', ' pottery ', 'Studio'],
      removeTags: ['Draft'],
      rename: 'Wood-fired kiln.jpg',
      alt: 'A brick kiln glowing orange at night',
    })
    expect(read.problems).toEqual([])
    expect(read.request).toEqual({
      files: ['kiln.jpg'],
      missingAlt: false,
      folder: ['Studio', 'Kilns'],
      addTags: ['pottery', 'studio'],
      removeTags: ['draft'],
      rename: 'Wood-fired kiln.jpg',
      alt: 'A brick kiln glowing orange at night',
      altFromDetails: false,
    })
  })

  it('keeps a name and an alt text to exactly one file, and names what it skips', () => {
    const read = aiMediaRequestOf({ files: ['a.jpg', 'b.jpg'], rename: 'x.jpg', alt: 'A mug', addTags: ['mugs'] })
    expect(read.request.rename).toBeUndefined()
    expect(read.request.alt).toBeUndefined()
    expect(read.problems).toEqual(['A new name is for exactly one file.', 'Alt text describes one image; name exactly one.'])
    expect(aiMediaRequestEmpty(read.request)).toBe(false)
  })

  it('refuses a folder deeper than the library nests or with an overlong name', () => {
    expect(aiMediaFolderPathOf('a/b/c/d/e/f')).toEqual({ error: 'Folders can nest at most 5 levels.' })
    expect(aiMediaFolderPathOf('x'.repeat(61))).toEqual({ error: expect.stringContaining('60 characters') })
    expect(aiMediaFolderPathOf(' / ')).toEqual({ error: 'The folder has no name.' })
  })

  it('is empty without a file or without a change', () => {
    expect(aiMediaRequestEmpty(aiMediaRequestOf({ addTags: ['x'] }).request)).toBe(true)
    expect(aiMediaRequestEmpty(aiMediaRequestOf({ files: ['a.jpg'] }).request)).toBe(true)
    expect(aiMediaRequestEmpty(aiMediaRequestOf({ missingAlt: true, altFromDetails: true }).request)).toBe(false)
    // Anything else a request could say is not an argument.
    expect(aiMediaRequestEmpty(aiMediaRequestOf({ files: ['a.jpg'], delete: true, private: true, upload: 'x' }).request)).toBe(true)
  })
})

describe('the files a change names (AGL-3752)', () => {
  it('takes a file by id or exact name, never a deleted one, and refuses two of one name', () => {
    expect(aiMediaFileOf('m-1', [photo('m-1')])).toEqual(photo('m-1'))
    expect(aiMediaFileOf('m-1.jpg', [photo('m-1')])).toEqual(photo('m-1'))
    expect(aiMediaFileOf('m-1', [photo('m-1', { deletedAt: NOW })])).toEqual({ error: expect.stringContaining('no file “m-1”') })
    expect(aiMediaFileOf('same.jpg', [photo('a', { fileName: 'same.jpg' }), photo('b', { fileName: 'same.jpg' })])).toEqual({
      error: expect.stringContaining('more than one file called “same.jpg”'),
    })
  })
})

describe('alt text (AGL-3752)', () => {
  it('refuses alt text that names no image or repeats the file name', () => {
    expect(aiMediaAltProblem('Image', 'IMG_4021.jpg')).toContain('does not say what the image shows')
    expect(aiMediaAltProblem('a photo of', 'x.jpg')).not.toBeNull()
    expect(aiMediaAltProblem('IMG 4021', 'IMG_4021.jpg')).toContain('repeats the file name')
    expect(aiMediaAltProblem('Two hands shaping a bowl on a wheel', 'IMG_4021.jpg')).toBeNull()
  })

  it('writes alt from the library’s description, else a current caption, else nothing', () => {
    expect(aiMediaAltFromDetails(photo('a', { description: 'Glazed mugs drying on a shelf' }))).toBe('Glazed mugs drying on a shelf')
    const embedded = (contentSha256: string) => ({
      version: MEDIA_EMBEDDED_METADATA_VERSION,
      format: 'jpeg',
      fields: [{ key: 'description', label: 'Caption', group: 'description', value: 'Raku firing in the yard', sources: [], editable: true }],
      writable: true,
      contentSha256,
    })
    expect(aiMediaAltFromDetails(photo('b', { contentSha256: 'abc', embeddedMetadata: embedded('abc') }))).toBe('Raku firing in the yard')
    // A record read from other bytes describes another file.
    expect(aiMediaAltFromDetails(photo('c', { contentSha256: 'new', embeddedMetadata: embedded('old') }))).toBeNull()
    // A file name is never alt text.
    expect(aiMediaAltFromDetails(photo('d', { description: 'd' }))).toBeNull()
    expect(aiMediaAltFromDetails(photo('e'))).toBeNull()
  })
})

describe('folders (AGL-3752)', () => {
  const folders = [
    { id: 'f-studio', name: 'Studio', parentId: null },
    { id: 'f-kilns', name: 'Kilns', parentId: 'f-studio' },
  ]
  it('walks the folders there, without case, and makes only what is missing below them', () => {
    expect(aiMediaFolderPlan(['studio', 'KILNS'], folders)).toEqual({ existingId: 'f-kilns', create: [] })
    expect(aiMediaFolderPlan(['Studio', 'Glazes', '2026'], folders)).toEqual({
      existingId: 'f-studio',
      create: [
        { name: 'Glazes', parent: { id: 'f-studio' } },
        { name: '2026', parent: { made: 0 } },
      ],
    })
    expect(aiMediaFolderPlan(['Press'], folders)).toEqual({ existingId: null, create: [{ name: 'Press', parent: { id: null } }] })
  })
})

describe('one file’s change (AGL-3752)', () => {
  it('writes only what differs, with the drawer’s legacy folder name and filter keys', () => {
    const row = photo('m-1', { fileName: 'IMG_1.jpg', tags: ['studio'], folderId: null, width: 1200, height: 800 })
    const change = aiMediaFileChange(
      row,
      request({ rename: 'Kiln at night.jpg', addTags: ['studio', 'kiln'], alt: 'A brick kiln glowing at night' }),
      { id: 'f-1', name: 'Kilns' },
    )
    expect(change.notDone).toEqual([])
    expect(change.update).toEqual(
      expect.objectContaining({
        fileName: 'Kiln at night.jpg',
        tags: ['studio', 'kiln'],
        folderId: 'f-1',
        folder: 'Kilns',
        alt: 'A brick kiln glowing at night',
        hasAlt: true,
        nameLower: expect.any(String),
        nameTokens: expect.arrayContaining(['kiln']),
        kind: 'image',
        orientation: 'landscape',
      }),
    )
    expect(change.said).toHaveLength(4)
  })

  it('writes nothing for a file already as asked', () => {
    const row = photo('m-1', { tags: ['kiln'], folderId: 'f-1', alt: 'A kiln' })
    expect(aiMediaFileChange(row, request({ addTags: ['kiln'], alt: 'A kiln' }), { id: 'f-1', name: 'Kilns' }).update).toEqual({})
  })

  it('removes tags, keeps an image’s own alt under altFromDetails, and refuses alt on a document', () => {
    expect(aiMediaFileChange(photo('m', { tags: ['a', 'b'] }), request({ removeTags: ['a'] }), null).update).toEqual({ tags: ['b'] })
    expect(aiMediaFileChange(photo('m', { alt: 'Mine', description: 'Other' }), request({ altFromDetails: true }), null).update).toEqual({})
    const pdf = aiMediaFileChange(photo('m', { contentType: 'application/pdf' }), request({ alt: 'Price list' }), null)
    expect(pdf.update).toEqual({})
    expect(pdf.notDone[0]).toContain('not an image')
    const none = aiMediaFileChange(photo('m'), request({ altFromDetails: true }), null)
    expect(none.notDone[0]).toContain('no description or caption')
  })

  it('names the tags a full file could not take', () => {
    const full = photo('m', { tags: Array.from({ length: 20 }, (_, index) => `t${index}`) })
    const change = aiMediaFileChange(full, request({ addTags: ['new'] }), null)
    expect(change.update).toEqual({})
    expect(change.notDone[0]).toContain('20 tags at most')
  })
})

/** A transaction over one site's library, as the write sees it. */
function library(input: { roles?: Record<string, string>; media?: AiMediaRow[]; folders?: { id: string; name: string; parentId: string | null }[] }) {
  const state = {
    media: new Map((input.media ?? []).map((row) => [row.id, row.data])),
    folders: input.folders ?? [],
    updates: [] as { id: string; data: Record<string, unknown> }[],
    sets: [] as { id: string; data: Record<string, unknown> }[],
  }
  let uid = 0
  const snap = (id: string, data: Record<string, unknown> | undefined) => ({ id, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] })
  const query = (collection: string, filter?: { field: string; value: unknown }) => ({
    collection,
    filter,
    limit: () => query(collection, filter),
    where: (field: string, _op: string, value: unknown) => query(collection, { field, value }),
  })
  const sub = (collection: string) => ({
    doc: (id?: string) => ({ collection, id: id ?? `new-${(uid += 1)}` }),
    where: (field: string, _op: string, value: unknown) => query(collection, { field, value }),
    limit: () => query(collection),
  })
  const firestore = {
    collection: () => ({ doc: () => ({ kind: 'host', collection: sub }) }),
    runTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        get: async (ref: { kind?: string; collection?: string; id?: string; filter?: { field: string; value: unknown } }) => {
          if (ref.kind === 'host') return snap('host-1', { memberRoles: input.roles ?? { 'uid-1': 'author' } })
          if (ref.collection === 'media' && ref.id) return snap(ref.id, state.media.get(ref.id))
          if (ref.collection === 'media') {
            const docs = [...state.media.entries()]
              .filter(([, data]) => !ref.filter || (data[ref.filter.field] ?? (ref.filter.field === 'hasAlt' ? false : undefined)) === ref.filter.value)
              .map(([id, data]) => ({ id, data: () => data }))
            return { docs }
          }
          return { docs: state.folders.map((folder) => ({ id: folder.id, get: (field: string) => (folder as Record<string, unknown>)[field] })) }
        },
        update: (ref: { id: string }, data: Record<string, unknown>) => state.updates.push({ id: ref.id, data }),
        set: (ref: { id: string }, data: Record<string, unknown>) => state.sets.push({ id: ref.id, data }),
      }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, state }
}

describe('the library write (AGL-3752)', () => {
  it('files named files into a folder it makes once, and writes nothing the second time', async () => {
    const media = [photo('m-1', { fileName: 'kiln.jpg' }), photo('m-2', { fileName: 'wheel.jpg' })]
    const first = library({ media })
    const written = await writeAiMediaChanges(first.firestore, {
      hostId: 'host-1',
      uid: 'uid-1',
      request: request({ files: ['kiln.jpg', 'm-2'], folder: ['Studio'], addTags: ['studio'] }),
      now: NOW,
    })
    expect(written).toEqual(expect.objectContaining({ ok: true, changedFiles: 2, madeFolders: ['Studio'], notDone: [] }))
    expect(first.state.sets).toEqual([{ id: expect.any(String), data: expect.objectContaining({ name: 'Studio', parentId: null }) }])
    expect(first.state.sets[0].data).not.toHaveProperty('visibleTo')
    const folderId = first.state.sets[0].id
    expect(first.state.updates).toEqual([
      { id: 'm-1', data: { tags: ['studio'], folderId, folder: 'Studio', updatedAt: NOW } },
      { id: 'm-2', data: { tags: ['studio'], folderId, folder: 'Studio', updatedAt: NOW } },
    ])

    const filed = media.map((row) => ({ ...row, data: { ...row.data, tags: ['studio'], folderId } }))
    const again = library({ media: filed, folders: [{ id: folderId, name: 'Studio', parentId: null }] })
    expect(
      await writeAiMediaChanges(again.firestore, { hostId: 'host-1', uid: 'uid-1', request: request({ files: ['kiln.jpg', 'm-2'], folder: ['studio'], addTags: ['studio'] }), now: NOW }),
    ).toEqual(expect.objectContaining({ ok: true, changedFiles: 0, madeFolders: [], done: [] }))
    expect(again.state.sets).toEqual([])
    expect(again.state.updates).toEqual([])
  })

  it('writes missing alt from the library’s details and names the images it could not', async () => {
    const { firestore, state } = library({
      media: [
        photo('m-1', { description: 'Glazed mugs drying on a shelf', hasAlt: false }),
        photo('m-2', { hasAlt: false }),
        photo('m-3', { contentType: 'application/pdf', hasAlt: false }),
        photo('m-4', { alt: 'Kept', hasAlt: true }),
      ],
    })
    const written = await writeAiMediaChanges(firestore, { hostId: 'host-1', uid: 'uid-1', request: request({ files: [], missingAlt: true, altFromDetails: true }), now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changedFiles: 1, altChanged: true, notDone: [expect.stringContaining('“m-2.jpg” has no description')] }))
    expect(state.updates).toEqual([{ id: 'm-1', data: expect.objectContaining({ alt: 'Glazed mugs drying on a shelf', hasAlt: true }) }])
  })

  it('names a file the library does not have and still changes the rest', async () => {
    const { firestore, state } = library({ media: [photo('m-1', { fileName: 'kiln.jpg' })] })
    const written = await writeAiMediaChanges(firestore, { hostId: 'host-1', uid: 'uid-1', request: request({ files: ['kiln.jpg', 'gone.jpg'], addTags: ['kiln'] }), now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changedFiles: 1, notDone: ['This site’s media library has no file “gone.jpg”.'] }))
    expect(state.updates).toHaveLength(1)
  })

  it('refuses a member who lost the write role by the time it writes', async () => {
    const { firestore, state } = library({ roles: { 'uid-1': 'viewer' }, media: [photo('m-1')] })
    expect(await writeAiMediaChanges(firestore, { hostId: 'host-1', uid: 'uid-1', request: request({ files: ['m-1'], addTags: ['x'] }), now: NOW })).toEqual({ ok: false, error: AI_MEDIA_ROLE_COPY })
    expect(state.updates).toEqual([])
  })
})

describe('the media step (AGL-3752)', () => {
  const hosts = new Map<string, Record<string, unknown>>()
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === 'hosts' ? hosts.get(id) : undefined
          return { id, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
        },
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
  const job = (inputs: Record<string, unknown>): AiJob =>
    ({
      $id: 'job-media-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'media',
      status: 'running',
      brief: 'Put the kiln photos in a Studio folder.',
      inputs,
      steps: [],
      outputs: [],
      creditsReserved: 0,
      creditsSpent: 0,
      createdBy: 'uid-1',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW,
    }) as unknown as AiJob
  const lockdownOpen = jest.fn(async () => null)
  const write = jest.fn(async (..._args: unknown[]) => ({
    ok: true as const,
    done: ['Made the folder Studio.', '“kiln.jpg” is in Studio.'],
    notDone: [] as string[],
    changedFiles: 1,
    madeFolders: ['Studio'],
    altChanged: false,
  }))
  const run = (inputs: Record<string, unknown>, lockdown = lockdownOpen) =>
    createAiJobMediaStep({ write: write as never, lockdown: lockdown as never })({ job: job(inputs), stepIndex: 0, now: NOW, firestore, org: FREE as never })

  beforeEach(() => {
    hosts.clear()
    hosts.set('host-1', { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': 'author', 'uid-2': 'viewer' } })
    for (const mock of [write, lockdownOpen]) mock.mockClear()
  })

  it('saves live at no cost and says what it did', async () => {
    const outcome = await run({ files: ['kiln.jpg'], folder: 'Studio' })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    expect(write).toHaveBeenCalledWith(firestore, { hostId: 'host-1', uid: 'uid-1', request: expect.objectContaining({ files: ['kiln.jpg'], folder: ['Studio'] }), now: NOW })
    expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'media', id: 'library', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Media library' })])
    expect(outcome.outputs[0].note).toBe('Made the folder Studio. “kiln.jpg” is in Studio. Live now, in the site’s Media library.')
    expect(lockdownOpen).toHaveBeenCalledWith(expect.objectContaining({ staff: false, uid: 'uid-1', intent: 'write' }))
  })

  it('says placed images keep their alt, and fails in words when nothing could be done', async () => {
    write.mockResolvedValueOnce({ ok: true, done: ['“kiln.jpg” has alt text.'], notDone: [], changedFiles: 1, madeFolders: [], altChanged: true })
    expect((await run({ files: ['kiln.jpg'], alt: 'A kiln at night' })).outputs[0].note).toContain('ones already on a page keep their own')
    write.mockResolvedValueOnce({ ok: true, done: [], notDone: ['This site’s media library has no file “x.jpg”.'], changedFiles: 0, madeFolders: [], altChanged: false })
    expect((await run({ files: ['x.jpg'], addTags: ['a'] })).failure).toBe('This site’s media library has no file “x.jpg”.')
    expect((await run({ files: ['x.jpg'], delete: true })).failure).toBe(AI_MEDIA_NOTHING_COPY)
  })

  it('refuses a member who may not edit the site and a frozen site, writing nothing', async () => {
    expect((await run({ files: ['a.jpg'], addTags: ['x'] }, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(AI_MEDIA_LOCKED_COPY)
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
    expect((await run({ files: ['a.jpg'], addTags: ['x'] })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_MEDIA_ROLE_COPY }))
    expect(write).not.toHaveBeenCalled()
  })

  const admission = createAiMediaJobAdmission({ ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'), lockdown: lockdownOpen as never })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { files: ['a.jpg'], addTags: ['x'] }, org: FREE, uid: 'uid-1', ...overrides })

  it('admits an author naming a file and a change, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_MEDIA_ROLE_COPY })
    expect(await ask({ inputs: { files: ['a.jpg'] } })).toEqual({ status: 400, error: AI_MEDIA_NOTHING_COPY })
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiMediaJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('media', expect.any(Function), { minimumMs: AI_JOB_MEDIA_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('media')).toBeTruthy()
  })
})

describe('the media operation a build plans (AGL-3752)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'media')

  it('is a live item, Free included, at no cost, offering only the library’s organizing fields', () => {
    expect(capability).toMatchObject({ runnerKind: 'media', maxPerPlan: 4, freeAllowed: true, degrade: 'omit', live: true, where: 'the site’s Media library' })
    expect(capability?.feature).toBeUndefined()
    expect(capability?.estimateCredits({ files: ['a.jpg'] })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(Object.keys(schema.properties).sort()).toEqual(['addTags', 'alt', 'altFromDetails', 'files', 'folder', 'missingAlt', 'removeTags', 'rename'])
    for (const never of ['upload', 'url', 'delete', 'replace', 'private', 'visibleTo', 'description', 'customMetadata', 'orgLibrary']) {
      expect([never, never in schema.properties]).toEqual([never, false])
    }
    expect(pluginAiCapabilityArgsProblems(schema, { files: ['kiln.jpg'], folder: 'Studio', addTags: ['kiln'] })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { files: ['kiln.jpg'], delete: true })).not.toEqual([])
  })

  it('is listed to the planner as an item operation, saved live, never uploading', () => {
    const lines = aiBuildOpLines(new Map([['media', capability as NonNullable<typeof capability>]]), [])
    const line = lines.find((one) => one.startsWith('- media:')) as string
    expect(line).toContain('saved live when the plan is confirmed')
    expect(line).toContain('never uploading, copying or deleting a file')
    expect(line).toContain('folder: string (optional)')
  })
})
