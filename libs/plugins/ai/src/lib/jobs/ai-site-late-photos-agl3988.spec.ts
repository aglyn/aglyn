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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { PluginDraftRecordsRevision } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { stockPhotoSourceKey, type StockPhoto, type StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  AI_LAYOUT_STARTER_PHOTOS,
  aiResolveLayoutPictures,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { aiSiteMergePhotos, aiSitePhotosOwed, type AiSitePhotos, type AiSiteStarterList, type AiSiteStarterSlot } from '../model/ai-site-photos'
import { AI_JOB_STEP_MAX_MINIMUM_MS } from './ai-job-budget'
import { AI_SITE_DATASET_RESOURCE, aiSiteDatasetRecordPhotos, aiSiteDatasetStarterList } from './ai-job-site-datasets'
import { aiStockForgetJobPhotos, aiLayoutStockPhotoSource } from './ai-layout-stock-photos'
import { aiSiteShareImageOpen, aiSiteShareImageUpdates, aiSiteSharePhoto } from './ai-site-publish'
import {
  AI_SITE_LATE_PHOTOS_COPY_MS,
  AI_SITE_LATE_PHOTOS_MINIMUM_MS,
  AI_SITE_LATE_PHOTOS_WAIT_MS,
  AI_SITE_LATE_PHOTOS_WRITES_MS,
  aiSiteLatePhotos,
  aiSitePageImages,
} from './ai-site-late-photos'
import { WEDDING_COUPLE_MOUNTAINS } from './fixtures/ai-stock-photo-agl3942-recordings'
import { COUPLE_MOUNTAINS_0919, FAMILY_MOUNTAINS_0919, WEDDING_HERO } from './fixtures/ai-stock-photo-agl3988-recordings'
import {
  LAUREL_FORK_COVERS,
  LAUREL_FORK_PAGES,
  LAUREL_FORK_PHOTOS,
  LAUREL_FORK_REFUSALS,
  LAUREL_FORK_SHARE_IMAGE,
} from './fixtures/ai-site-late-photos-laurel-fork'

/*
 * The v1.0.0-beta.271 Laurel Fork Photography guided start (2026-10-19
 * 23:05Z, workspace jWmGooWE3L, host zVfToa7iIQ, job yZUqIPmjIZ), which
 * already carried #1831, replayed from what production left
 * (fixtures/ai-site-late-photos-laurel-fork.ts) and from Pixabay's answers
 * the same 24-hour cache gave the beta.270 Sugar Hollow start four hours
 * earlier, for the same business type (fixtures/ai-stock-photo-agl3988-
 * recordings.ts, -agl3942-recordings.ts). No network, no model.
 *
 * What production published: the home hero the office team and its about
 * split the desk, all twelve "Gallery collections" covers the office team and
 * the desk in turn, and the office team as the site's share image, while the
 * job had copied ten wedding and family photos for its other pages. The
 * covers were written at 23:07:19, before any copy, with 22 of their
 * downloads refused; the home page was the first page, with 11 refused.
 */

const HOST = 'zVfToa7iIQ'
const ORG = 'jWmGooWE3L'
const JOB_ID = 'yZUqIPmjIZ'
const HOME = '5opPRLVW_U'
const GALLERY = 'WX2B9IcAnF'

const INPUTS = {
  businessType: 'a wedding and family photographer in the Blue Ridge Mountains who books sessions and elopements',
  audience: 'couples planning a Blue Ridge wedding or elopement, and families who want relaxed outdoor portraits',
  starter: 'portfolio',
  siteKind: 'photography',
  pages: 6,
  businessName: 'Laurel Fork Photography',
  city: 'Boone',
  originJobId: JOB_ID,
}

const STARTER = /^\/_static\/starter\//
const ms = (iso: string) => Date.parse(iso)
/** A deep copy of a fixture's plain data. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The ten photos the job copied, as a page names them. */
const JOB_PHOTOS: AiLayoutPicturePhoto[] = LAUREL_FORK_PHOTOS.map((photo) => ({
  src: `media:${HOST}/${photo.mediaId}`,
  width: photo.width,
  height: photo.height,
  alt: photo.alt,
}))
const JOB_SRCS = new Set(JOB_PHOTOS.map((photo) => photo.src))

/** Each search's recorded answer, by its query, orientation and size, as the cache keyed it. */
const RECORDED: Record<string, StockPhoto[]> = {
  'couple mountains|horizontal|900|0': COUPLE_MOUNTAINS_0919,
  'family mountains|horizontal|900|0': FAMILY_MOUNTAINS_0919,
  'wedding couple mountains|horizontal|900|0': WEDDING_COUPLE_MOUNTAINS,
  'wedding|horizontal|1600|0': WEDDING_HERO,
  'wedding couple mountains|horizontal|1600|0': WEDDING_COUPLE_MOUNTAINS,
}
const ANSWERED = [...new Map(Object.values(RECORDED).flat().map((photo) => [photo.id, photo])).values()]

/**
 * The library and the stock provider, in memory: the site's library holds
 * the ten photos the job copied, by their source keys; a download is refused
 * where `refuse` says, as the image hosts did; every copy is recorded.
 */
function library(refuse: (photo: StockPhoto) => boolean, options: { empty?: boolean } = {}) {
  const held = new Map<string, { src: string; width: number; height: number }>(
    options.empty
      ? []
      : LAUREL_FORK_PHOTOS.map((photo) => [photo.key, { src: `media:${HOST}/${photo.mediaId}`, width: photo.width, height: photo.height }]),
  )
  const downloads: string[] = []
  const copies: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      const key = [request.query, request.orientation, request.minWidth ?? 0, request.minHeight ?? 0].join('|')
      return { photos: RECORDED[key] ?? [], cached: true }
    },
    download: async (photo) => {
      downloads.push(photo.id)
      return refuse(photo) ? null : { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }
    },
    credit: () => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: 'Photo on Pixabay.',
    }),
  }
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const photo = ANSWERED.find((hit) => stockPhotoSourceKey(hit) === request.stockPhoto?.key)
      const src = `media:${HOST}/px${String(request.stockPhoto?.id)}`
      const stored = { src, width: photo?.width ?? 1280, height: photo?.height ?? 853 }
      held.set(String(request.stockPhoto?.key), stored)
      copies.push(String(request.stockPhoto?.id))
      return { ok: true, mediaId: `px${String(request.stockPhoto?.id)}`, ...stored }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const stored = held.get(sourceKey)
      return stored ? { mediaId: stored.src.split('/').pop() as string, ...stored } : null
    },
  }
  return { provider, ingest, downloads, copies }
}

/** The site's pages and the covers' records, in memory, as the late pass reads and writes them. */
function site(lib: ReturnType<typeof library>) {
  const pages = new Map<string, NodesMap>(LAUREL_FORK_PAGES.map((page) => [page.id, clone(page.nodes)]))
  const covers = LAUREL_FORK_COVERS.map((cover) => ({
    order: cover.order,
    values: { title: cover.title, category: cover.category, image: cover.image, image_description: cover.imageDescription } as Record<string, unknown>,
  }))
  const revisions: PluginDraftRecordsRevision[] = []
  const deps = {
    provider: () => lib.provider,
    ingest: () => lib.ingest,
    readNodes: (async (_firestore: unknown, { id }: { id: string }) => {
      const nodes = pages.get(id)
      return nodes ? { versionId: 'v', nodes } : null
    }) as never,
    updateNodes: (async (_firestore: unknown, { id, update }: { id: string; update: (nodes: NodesMap) => NodesMap | null }) => {
      const nodes = pages.get(id)
      if (!nodes) return { ok: false, status: 404, error: 'gone' }
      const next = update(nodes)
      if (next) pages.set(id, next)
      return { ok: true, changed: Boolean(next) }
    }) as never,
    writerFor: ((resource: string) =>
      resource === AI_SITE_DATASET_RESOURCE
        ? {
            pluginId: 'data',
            writer: {
              reviseRecords: async (request: PluginDraftRecordsRevision) => {
                revisions.push(request)
                let changed = 0
                for (const revision of request.records) {
                  const record = covers.find((cover) => cover.order === revision.order)
                  if (!record || request.id !== GALLERY) continue
                  if (Object.entries(revision.where ?? {}).some(([id, value]) => record.values[id] !== value)) continue
                  Object.assign(record.values, revision.values)
                  changed += 1
                }
                return { ok: true as const, changed }
              },
            },
          }
        : null) as never,
  }
  return { pages, covers, revisions, deps }
}

/** The covers' unit job, as the scaffold derived it: the dataset is written under its id. */
const coversJob = {
  $id: GALLERY,
  hostId: HOST,
  createdBy: 'member-1',
  brief: '',
  plan: null,
  inputs: INPUTS,
} as unknown as Pick<AiJob, '$id' | 'hostId' | 'createdBy' | 'inputs' | 'brief' | 'plan'>

/** The covers' pass, replayed: the library still empty, and every download refused, as the hosts refused every one in that burst. */
async function coversPass() {
  const lib = library(() => true, { empty: true })
  const photos = await aiSiteDatasetRecordPhotos({
    job: coversJob,
    name: 'Gallery collections',
    names: LAUREL_FORK_COVERS.map((cover) => cover.title),
    categories: LAUREL_FORK_COVERS.map((cover) => cover.category),
    pictures: 'things',
    stockPhotos: ((input) =>
      aiLayoutStockPhotoSource(input, {
        provider: () => lib.provider,
        ingest: () => lib.ingest,
        now: () => ms(LAUREL_FORK_REFUSALS.covers.at),
      })) as typeof aiLayoutStockPhotoSource,
  })
  const list = aiSiteDatasetStarterList({
    dataset: GALLERY,
    hostId: HOST,
    imageField: 'image',
    fields: [
      { id: 'title', name: 'Title', type: 'text' },
      { id: 'category', name: 'Category', type: 'text' },
      { id: 'image', name: 'Image', type: 'image' },
      { id: 'image_description', name: 'Image description', type: 'text' },
    ],
    people: false,
    names: LAUREL_FORK_COVERS.map((cover) => cover.title),
    categories: LAUREL_FORK_COVERS.map((cover) => cover.category),
    photos,
  })
  return { photos, list, downloads: lib.downloads }
}

/** The home page's two starters as the page step now reports them, with the picks the hosts refused at 23:08:11. */
const HOME_HERO = 'MDpjUplylc'
const HOME_ABOUT = 'A60C_InPsl'
const homeRefused = (keys: readonly string[]) => ({
  request: { query: 'wedding', orientation: 'horizontal' as const, minWidth: 1600 },
  keys: keys.map((id) => `pixabay:${id}`),
  at: LAUREL_FORK_REFUSALS.home.at,
})
const HOME_STARTERS: AiSiteStarterSlot[] = [
  {
    image: HOME_HERO,
    words: 'A couple on a Blue Ridge overlook at golden hour',
    role: 'hero',
    aspect: 21 / 9,
    refused: homeRefused(['1846114', '5061887', '7302669']),
  },
  {
    image: HOME_ABOUT,
    words: 'The photographer with a couple on a mountain trail',
    role: 'gallery',
    aspect: 4 / 3,
    refused: { ...homeRefused(['7315389', '1837148', '3997967']), request: { query: 'wedding couple mountains', orientation: 'horizontal' as const, minWidth: 900 } },
  },
]

/** The job as its last pass found it: every page built, the email written. */
const lastJob = {
  $id: JOB_ID,
  orgId: ORG,
  hostId: HOST,
  createdBy: 'member-1',
  inputs: INPUTS,
  plan: null,
  outputs: [] as AiJobOutput[],
} as unknown as Pick<AiJob, '$id' | 'orgId' | 'hostId' | 'createdBy' | 'inputs' | 'plan' | 'outputs'>

/** The late pass over production's state, at the moment the welcome email settled (23:14:19.275Z). */
async function latePass(options: { refuse: (photo: StockPhoto) => boolean; list: AiSiteStarterList | null; now?: string; withoutPicks?: boolean }) {
  const lib = library(options.refuse)
  const state = site(lib)
  const waits: number[] = []
  /** A picture with no pick of its own to ask again: one its pass ran out of time for, say. */
  const bare = <T extends { refused?: unknown }>(entry: T): T => {
    const copy = { ...entry }
    delete copy.refused
    return copy
  }
  const slots = options.withoutPicks ? HOME_STARTERS.map(bare) : HOME_STARTERS
  const list = options.list && options.withoutPicks ? { ...options.list, records: options.list.records.map(bare) } : options.list
  const photos = aiSiteMergePhotos(null, { pages: [{ screen: HOME, slots }], lists: list ? [list] : [] }) as AiSitePhotos
  const result = await aiSiteLatePhotos(
    {
      firestore: {} as never,
      job: lastJob,
      photos,
      pageIds: LAUREL_FORK_PAGES.map((page) => page.id),
      org: null,
      now: new Date(options.now ?? '2026-10-19T23:14:19.275Z'),
    },
    {
      ...state.deps,
      now: () => ms(options.now ?? '2026-10-19T23:14:19.275Z'),
      sleep: async (wait) => {
        waits.push(wait)
      },
    },
  )
  return { result, state, lib, waits }
}

/** Every image address the published pages show. */
const pageSrcs = (pages: ReadonlyMap<string, NodesMap>) => [...pages.values()].flatMap((nodes) => aiSitePageImages(nodes).map((image) => image.src))
const imageOf = (nodes: NodesMap | undefined, id: string) =>
  (nodes as unknown as Record<string, { props?: Record<string, unknown> }> | undefined)?.[id]?.props ?? {}

beforeEach(() => aiStockForgetJobPhotos())

describe('the Laurel Fork covers’ pass, replayed (AGL-3988, beta.271)', () => {
  it('leaves every cover on a starter, as production did, and records the picks the hosts refused: the 22 its log shows', async () => {
    const { photos, list, downloads } = await coversPass()
    expect(photos.map((photo) => photo.src)).toEqual(LAUREL_FORK_COVERS.map((cover) => cover.image))
    const refused = new Set(list?.records.flatMap((record) => record.refused?.keys ?? []).map((key) => key.replace('pixabay:', '')))
    // Exactly the downloads production's log shows refused in that beat, each tried once.
    expect(downloads).toHaveLength(LAUREL_FORK_REFUSALS.covers.ids.length)
    expect(new Set(downloads)).toEqual(new Set(LAUREL_FORK_REFUSALS.covers.ids))
    expect(refused).toEqual(new Set(LAUREL_FORK_REFUSALS.covers.ids))
    // Dated when the hosts refused them, and asked of the search that found them.
    for (const record of list?.records ?? []) {
      if (!record.refused) continue
      expect(record.refused.at).toBe(LAUREL_FORK_REFUSALS.covers.at)
      expect(RECORDED[[record.refused.request.query, record.refused.request.orientation, record.refused.request.minWidth ?? 0, record.refused.request.minHeight ?? 0].join('|')]).toBeDefined()
    }
    expect(aiSitePhotosOwed(aiSiteMergePhotos(null, { pages: [], lists: list ? [list] : [] }))).toBe(true)
  })
})

describe('the Laurel Fork home page’s own photos (AGL-3988, beta.271)', () => {
  /** The home page as the compiler wrote it: its four picture slots empty, each with the words a slot carries. */
  const compiled = () => {
    const nodes = clone(LAUREL_FORK_PAGES[0]?.nodes as NodesMap) as unknown as Record<string, { props?: Record<string, unknown> }>
    const words: Record<string, string> = {
      [HOME_HERO]: 'A couple on a Blue Ridge overlook at golden hour',
      [HOME_ABOUT]: 'The photographer with a couple on a mountain trail',
      HpkOCRgkaU: 'A family walking a mountain meadow',
      'Hg-Yoxi45H': 'A couple at their mountain wedding',
    }
    for (const [id, alt] of Object.entries(words)) {
      const props = { ...(nodes[id]?.props ?? {}) }
      delete props['src']
      delete props['intrinsicWidth']
      delete props['intrinsicHeight']
      delete props['loading']
      nodes[id] = { ...nodes[id], props: { ...props, alt } }
    }
    return nodes as unknown as NodesMap
  }
  const sections = (LAUREL_FORK_PAGES[0]?.nodes as unknown as Record<string, { nodes?: string[] }>)[CANVAS_ROOT_ELEMENT_ID]?.nodes ?? []

  it('opens on the wide wedding photo it copied for itself, never the office team, and keeps its about split for the late pass', async () => {
    const own = (id: string) => JOB_PHOTOS.find((photo) => photo.src.endsWith(`/${id}`)) as AiLayoutPicturePhoto
    let reported: AiSiteStarterSlot[] = []
    const after = await aiResolveLayoutPictures(compiled(), {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds: sections,
      sectionNames: ['Hero: unhurried photos in the mountains', 'Galleries by subject', 'A short personal about', 'What a session is like, in steps', 'Where we photograph', 'Call to action: get in touch'],
      seed: `${JOB_ID}:${HOME}`,
      // What production's Home pass came to: the hero's and the about split's picks refused, the other two copied.
      source: async (slots: readonly AiLayoutPictureSlot[], report) => {
        const answers = slots.map((slot) =>
          slot.imageId === 'HpkOCRgkaU' ? own('Dno5tXH307') : slot.imageId === 'Hg-Yoxi45H' ? own('20t9SUxyKJ') : null,
        )
        for (const slot of slots) {
          const starter = HOME_STARTERS.find((entry) => entry.image === slot.imageId)
          if (starter?.refused) report?.refused.set(slot, starter.refused)
        }
        return answers
      },
      onStarters: (slots) => {
        reported = slots
      },
    })
    expect(imageOf(after, HOME_HERO)['src']).toBe(`media:${HOST}/20t9SUxyKJ`)
    expect(imageOf(after, HOME_HERO)['alt']).toBe('A couple at a wedding')
    expect(imageOf(after, HOME_HERO)['loading']).toBe('eager')
    // Both of the page's own photos sit beside the about split: it keeps a neutral starter, for the late pass.
    expect([AI_LAYOUT_STARTER_PHOTOS.hero.src, AI_LAYOUT_STARTER_PHOTOS.desk.src]).toContain(imageOf(after, HOME_ABOUT)['src'])
    expect(reported).toEqual([expect.objectContaining({ image: HOME_ABOUT, role: 'gallery', refused: HOME_STARTERS[1]?.refused })])
  })
})

describe('the Laurel Fork late photo pass, over what production left (AGL-3988, beta.271)', () => {
  it('takes the picks later pages copied from the library while the hosts still refuse: 8 of the 30 refused were there by 23:14', async () => {
    const { list } = await coversPass()
    const { result, state, lib } = await latePass({ refuse: () => true, list })
    expect(result).toMatchObject({ photos: null, copied: 0, left: 0 })
    expect(lib.copies).toEqual([])
    // The hero's first pick, 1846114, refused at 23:08 and copied by the Packages page at 23:10:42.
    expect(imageOf(state.pages.get(HOME), HOME_HERO)['src']).toBe(`media:${HOST}/Q_imBRl0u7`)
    // Every cover whose first pick the library held by then shows it.
    const held = new Map(LAUREL_FORK_PHOTOS.map((photo) => [photo.key, photo.mediaId]))
    const own = (list?.records ?? []).flatMap((record, index) => {
      const first = record.refused?.keys[0]
      const mediaId = first ? held.get(first) : undefined
      return mediaId ? [[index, `/api/media/cdn/${HOST}/${mediaId}`]] : []
    })
    expect(own.length).toBeGreaterThan(0)
    for (const [index, value] of own) expect([index, state.covers[index as number]?.values['image']]).toEqual([index, value])
    expect(state.covers.filter((cover) => STARTER.test(String(cover.values['image'])))).toEqual([])
  })

  it('gives every cover, the home hero and its about split one of the job’s own photos where no pick of theirs can be had', async () => {
    const { list } = await coversPass()
    const { result, state, waits } = await latePass({ refuse: () => true, list, withoutPicks: true })
    expect(result).toMatchObject({ photos: null, retried: 0, left: 0 })
    // Every refused pick was a minute old and more: nothing to wait for.
    expect(waits.every((wait) => wait === 0)).toBe(true)

    const home = state.pages.get(HOME)
    const hero = imageOf(home, HOME_HERO)
    expect(JOB_SRCS.has(String(hero['src']))).toBe(true)
    expect(Number(hero['intrinsicWidth']) / Number(hero['intrinsicHeight'])).toBeGreaterThanOrEqual(1.3)
    expect(hero['loading']).toBe('eager')
    expect(hero['alt']).toBe(JOB_PHOTOS.find((photo) => photo.src === hero['src'])?.alt)
    const about = imageOf(home, HOME_ABOUT)
    expect(JOB_SRCS.has(String(about['src']))).toBe(true)
    // Never the photo of the picture beside it.
    const order = aiSitePageImages(home as NodesMap).map((image) => image.src)
    for (const [index, src] of order.entries()) if (index > 0) expect(src).not.toBe(order[index - 1])

    // All twelve covers on the job's photos, each wedding gallery a wedding or a couple, each family gallery a family.
    const values = state.covers.map((cover) => cover.values)
    for (const value of values) {
      expect(String(value['image'])).toMatch(new RegExp(`^/api/media/cdn/${HOST}/`))
      expect(JOB_SRCS.has(`media:${HOST}/${String(value['image']).split('/').pop()}`)).toBe(true)
    }
    for (const value of values) {
      const alt = String(value['image_description'])
      if (value['category'] === 'Family portraits') expect(alt).toMatch(/family|father|mother/i)
      else expect(alt).toMatch(/couple|bride|wedding/i)
    }
    for (const [index, value] of values.entries()) if (index > 0) expect(value['image']).not.toBe(values[index - 1]?.['image'])
    // Each record written once, only where it still held the starter it was written with.
    expect(state.revisions).toHaveLength(1)
    expect(state.revisions[0]?.records.every((record) => STARTER.test(String(record.where?.['image'])))).toBe(true)
  })

  it('copies the refused picks themselves once the hosts let them through, each into its own picture', async () => {
    const { list } = await coversPass()
    const { result, state, lib } = await latePass({ refuse: () => false, list })
    expect(result.copied).toBeGreaterThan(0)
    expect(result.left).toBe(0)
    // The hero's own first pick, refused at 23:08 and copied by the Packages page at 23:10:42, is shown again, not copied twice.
    expect(imageOf(state.pages.get(HOME), HOME_HERO)['src']).toBe(`media:${HOST}/Q_imBRl0u7`)
    expect(lib.copies).not.toContain('1846114')
    // Each cover whose picks were refused shows its own first pick: the library's copy where the job made one, else a new copy.
    const held = new Map(LAUREL_FORK_PHOTOS.map((photo) => [photo.key, photo.mediaId]))
    for (const [index, record] of (list?.records ?? []).entries()) {
      const first = record.refused?.keys[0]
      if (!first) continue
      const expected = held.get(first) ?? `px${first.replace('pixabay:', '')}`
      expect([index, String(state.covers[index]?.values['image'])]).toEqual([index, `/api/media/cdn/${HOST}/${expected}`])
    }
  })

  it('publishes no starter anywhere: pages, covers and the share image', async () => {
    const { list } = await coversPass()
    const { state } = await latePass({ refuse: () => true, list })
    expect(pageSrcs(state.pages).filter((src) => STARTER.test(src))).toEqual([])
    expect(state.covers.filter((cover) => STARTER.test(String(cover.values['image'])))).toEqual([])
    // The share image was the starter the site was created with: the publish's to set, from the home hero.
    expect(aiSiteShareImageOpen(LAUREL_FORK_SHARE_IMAGE)).toBe(true)
    const pages = LAUREL_FORK_PAGES.map((page) => state.pages.get(page.id) ?? null)
    const share = aiSiteSharePhoto(pages[0] ?? null, pages.slice(1))
    const hero = imageOf(state.pages.get(HOME), HOME_HERO)
    expect(share).toEqual({ src: hero['src'], width: hero['intrinsicWidth'], height: hero['intrinsicHeight'], alt: hero['alt'] })
    expect(aiSiteShareImageUpdates(share as AiLayoutPicturePhoto)).toEqual({
      'seo.image': hero['src'],
      'seo.imageWidth': hero['intrinsicWidth'],
      'seo.imageHeight': hero['intrinsicHeight'],
      'seo.imageAlt': hero['alt'],
    })
    expect(STARTER.test(String(share?.src))).toBe(false)
  })

  it('never sets the share image over one the owner picked', () => {
    expect(aiSiteShareImageOpen({ image: `media:${HOST}/ownerPick01`, imageWidth: 1200, imageHeight: 630 })).toBe(false)
    expect(aiSiteShareImageOpen({})).toBe(true)
    expect(aiSiteShareImageOpen(null)).toBe(true)
  })
})

describe('the late pass’s time (AGL-3988)', () => {
  it('waits a minute after the last refusal, never longer, and fits a beat with its copies and writes', async () => {
    const { waits } = await latePass({ refuse: () => true, list: null, now: '2026-10-19T23:08:31.813Z' })
    expect(waits).toEqual([AI_SITE_LATE_PHOTOS_WAIT_MS - 20_000])
    expect(AI_SITE_LATE_PHOTOS_WAIT_MS).toBe(60_000)
    expect(AI_SITE_LATE_PHOTOS_MINIMUM_MS).toBe(AI_SITE_LATE_PHOTOS_WAIT_MS + AI_SITE_LATE_PHOTOS_COPY_MS + AI_SITE_LATE_PHOTOS_WRITES_MS)
    expect(AI_SITE_LATE_PHOTOS_MINIMUM_MS).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
  })

  it('hands what is left to the next pass when its own time ran out while it waited', async () => {
    const lib = library(() => true)
    const state = site(lib)
    const controller = new AbortController()
    const photos = aiSiteMergePhotos(null, { pages: [{ screen: HOME, slots: HOME_STARTERS }], lists: [] }) as AiSitePhotos
    const result = await aiSiteLatePhotos(
      { firestore: {} as never, job: lastJob, photos, pageIds: [HOME], org: null, now: new Date(LAUREL_FORK_REFUSALS.home.at), signal: controller.signal },
      { ...state.deps, now: () => ms(LAUREL_FORK_REFUSALS.home.at), sleep: async () => controller.abort() },
    )
    expect(result.photos).toBe(photos)
    expect(imageOf(state.pages.get(HOME), HOME_HERO)['src']).toBe(AI_LAYOUT_STARTER_PHOTOS.hero.src)
  })
})

describe('what the late pass keeps (AGL-3831, AGL-3856, AGL-3923)', () => {
  it('leaves a site with no stock library on its starters, with no late pass owed', async () => {
    const photos = await aiSiteDatasetRecordPhotos({
      job: coversJob,
      name: 'Gallery collections',
      names: LAUREL_FORK_COVERS.map((cover) => cover.title),
      pictures: 'things',
      stockPhotos: (() => null) as typeof aiLayoutStockPhotoSource,
    })
    expect(photos.every((photo) => STARTER.test(String(photo.src)) && photo.noLibrary)).toBe(true)
    const list = aiSiteDatasetStarterList({
      dataset: GALLERY,
      hostId: HOST,
      imageField: 'image',
      fields: [],
      people: false,
      names: LAUREL_FORK_COVERS.map((cover) => cover.title),
      categories: [],
      photos,
    })
    expect(list).toBeNull()
  })

  it('keeps the starters of a job that copied no photo at all', async () => {
    const lib = library(() => true)
    const state = site(lib)
    // A site with only the home page, none of whose pictures copied anything.
    const bare = new Map([[HOME, clone(LAUREL_FORK_PAGES[0]?.nodes as NodesMap)]])
    for (const id of ['HpkOCRgkaU', 'Hg-Yoxi45H']) {
      const nodes = bare.get(HOME) as unknown as Record<string, { props?: Record<string, unknown> }>
      nodes[id] = { ...nodes[id], props: { ...nodes[id]?.props, src: AI_LAYOUT_STARTER_PHOTOS.desk.src } }
    }
    const result = await aiSiteLatePhotos(
      {
        firestore: {} as never,
        job: lastJob,
        photos: { pages: [{ screen: HOME, slots: HOME_STARTERS }], lists: [] },
        pageIds: [HOME],
        org: null,
        now: new Date('2026-10-19T23:14:19.275Z'),
      },
      {
        ...state.deps,
        ingest: () => ({ ...lib.ingest, findStockPhoto: async () => null }),
        readNodes: (async (_firestore: unknown, { id }: { id: string }) => ({ versionId: 'v', nodes: bare.get(id) })) as never,
        updateNodes: (async () => {
          throw new Error('nothing to write')
        }) as never,
        now: () => ms('2026-10-19T23:14:19.275Z'),
        sleep: async () => undefined,
      },
    )
    expect(result).toMatchObject({ photos: null, filled: 0, left: 2 })
  })

  it('gives a team’s records only their own picks, never a photo of something else', async () => {
    const lib = library(() => true)
    const state = site(lib)
    const team: AiSiteStarterList = {
      dataset: GALLERY,
      imageField: 'image',
      altField: 'image_description',
      people: true,
      records: LAUREL_FORK_COVERS.slice(0, 2).map((cover) => ({ name: cover.title, value: cover.image })),
    }
    const result = await aiSiteLatePhotos(
      {
        firestore: {} as never,
        job: lastJob,
        photos: { pages: [], lists: [team] },
        pageIds: LAUREL_FORK_PAGES.map((page) => page.id),
        org: null,
        now: new Date('2026-10-19T23:14:19.275Z'),
      },
      { ...state.deps, now: () => ms('2026-10-19T23:14:19.275Z'), sleep: async () => undefined },
    )
    expect(result).toMatchObject({ filled: 0, left: 2 })
    expect(state.revisions).toEqual([])
  })

  it('fills only the pictures still on a starter: a picture changed since keeps what it shows', async () => {
    const lib = library(() => true)
    const state = site(lib)
    const home = state.pages.get(HOME) as unknown as Record<string, { props?: Record<string, unknown> }>
    home[HOME_HERO] = { ...home[HOME_HERO], props: { ...home[HOME_HERO]?.props, src: `media:${HOST}/ownerPick01` } }
    await aiSiteLatePhotos(
      {
        firestore: {} as never,
        job: lastJob,
        photos: { pages: [{ screen: HOME, slots: HOME_STARTERS }], lists: [] },
        pageIds: [HOME],
        org: null,
        now: new Date('2026-10-19T23:14:19.275Z'),
      },
      { ...state.deps, now: () => ms('2026-10-19T23:14:19.275Z'), sleep: async () => undefined },
    )
    expect(imageOf(state.pages.get(HOME), HOME_HERO)['src']).toBe(`media:${HOST}/ownerPick01`)
    expect(JOB_SRCS.has(String(imageOf(state.pages.get(HOME), HOME_ABOUT)['src']))).toBe(true)
  })
})
