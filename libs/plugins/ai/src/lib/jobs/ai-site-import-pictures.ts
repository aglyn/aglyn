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
 * IMPROVE IT, GENERATIVE: A REDESIGNED PAGE'S PICTURES (AGL-4152).
 *
 * A redesign may ask for a picture where its own do not fit: a slot, which
 * `aiResolveLayoutPictures` fills or drops. This is the order it fills from,
 * first to last:
 *
 *   1. the page's own photos no `keep` placed;
 *   2. the source photos the site's earlier pages left off;
 *   3. what the site's own photo links hold, then the stock library
 *      (`aiLayoutSitePhotoSource`): no credits, copied into the library, its
 *      photographer kept, its brand-tag refusal held;
 *   4. only where the owner switched them on, and it is quoted, a generated
 *      picture: a hero or a section's lead, never a person or a product, at most
 *      `AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE` a page.
 *
 * A slot nothing fills is dropped, and the row around it redraws without a gap
 * (`aiLayoutDropEmptyPictures`). The tally is what the page's row says.
 *=========================================*/

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { aiLayoutPictureBandCells, type AiLayoutPicturePhoto, type AiLayoutPictureSlot, type AiLayoutPictureSource } from '../layout-language/ai-layout-pictures'
import { AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE, type AiSiteImportPagePictures, type AiSiteImportPhoto } from '../model/ai-site-import'
import { aiMediaCreditsPerPicture } from '../model/ai-media-credits'
import { estimateAiBilledUsd } from '../providers/catalog'
import { AiImageSafetyRefusal, type AiImageAspectRatio, type AiImageProvider } from '../providers/image-contract'
import { aiImageAltText, aiImageFileName } from '../server/ai-media-image'
import { aiMediaRasterPrompt } from '../server/ai-media-raster-prompt'
import { recordAssistCost } from '../usage/assist-usage'
import { aiAssignOwnerPhotos } from './ai-layout-owner-photos'

type NodesMap = Parameters<typeof aiLayoutPictureBandCells>[0]

/** How long one generated picture is waited on: a picture is decoration, and a page never fails over one. */
export const AI_SITE_IMPORT_GENERATED_PICTURE_MS = 40_000

/** What a slot's picture came from, as the page's row tells it. */
export interface AiSiteImportPictureTally {
  source: number
  stock: number
  generated: number
  /** What the generated pictures cost at the billed rates. */
  generatedUsd: number
  /** The addresses of the source's photos a slot took. */
  placed: string[]
}

export function aiSiteImportPictureTally(): AiSiteImportPictureTally {
  return { source: 0, stock: 0, generated: 0, generatedUsd: 0, placed: [] }
}

/** A generated picture for a slot, stored and metered; `null` where it could not be made or kept. */
export type AiSiteImportPictureMaker = (slot: AiLayoutPictureSlot, tally: AiSiteImportPictureTally) => Promise<AiLayoutPicturePhoto | null>

/** The words that say a picture shows a person: a generated one would show someone who does not exist as if they did. */
const SHOWS_PEOPLE = /\b(?:team|staff|crew|owner|owners|founder|founders|person|people|portrait|headshot|family|families|customer|customers|client|clients|patient|patients|doctor|dentist|stylist|therapist|attorney|lawyer|accountant)\b/i

/**
 * Which slots may take a generated picture (AGL-4152): the page's hero, or the
 * first picture of a section that is no cell of a band, and none that shows a
 * person, a product or a record's own thing.
 */
export function aiSiteImportGeneratedSlots(nodes: NodesMap, slots: readonly AiLayoutPictureSlot[]): boolean[] {
  const cells = aiLayoutPictureBandCells(nodes, slots)
  const seen = new Set<number>()
  return slots.map((slot, index) => {
    const lead = !seen.has(slot.sectionIndex)
    seen.add(slot.sectionIndex)
    return lead && !cells[index] && !slot.product && !slot.people && !slot.record && !SHOWS_PEOPLE.test(slot.alt)
  })
}

/**
 * The source a redesigned page's slots fill from, in the order above. `next`
 * answers the slots the source's own photos leave and tallies its own stock
 * photos; a slot it leaves empty takes a generated picture where one is allowed.
 */
export function aiSiteImportPictureSource(input: {
  photos: readonly AiSiteImportPhoto[]
  next: AiLayoutPictureSource | null
  make?: AiSiteImportPictureMaker | null
  nodes: NodesMap
  tally: AiSiteImportPictureTally
  /** The most generated pictures this page may take. */
  cap?: number
}): AiLayoutPictureSource | null {
  const { next, make, tally } = input
  // A photo the library holds no size for cannot be framed.
  const photos = input.photos.filter((photo) => photo.width && photo.height)
  if (!photos.length && !next && !make) return null
  const froms = new Map(photos.map((photo) => [photo.src, photo.from ?? '']))
  const cap = input.cap ?? AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE
  return async (slots, report) => {
    const own = aiAssignOwnerPhotos(slots, photos)
    own.forEach((photo) => {
      if (!photo) return
      tally.source += 1
      const from = froms.get(photo.src)
      if (from) tally.placed.push(from)
    })
    const open = slots.filter((_slot, index) => !own[index])
    const found = next && open.length ? await next(open, report) : []
    let at = 0
    const answers = own.map((photo) => photo ?? found[at++] ?? null)
    if (!make) return answers
    const allowed = aiSiteImportGeneratedSlots(input.nodes, slots)
    let left = Math.max(0, cap)
    const out: Array<AiLayoutPicturePhoto | null> = [...answers]
    // One at a time, so the cap holds whatever each comes to: the hero first, the biggest seen first.
    const order = slots.map((slot, index) => ({ slot, index })).sort((a, b) => Number(b.slot.role === 'hero') - Number(a.slot.role === 'hero') || a.index - b.index)
    for (const { slot, index } of order) {
      if (left <= 0) break
      if (answers[index]?.src || !allowed[index]) continue
      const made = await make(slot, tally)
      if (made) {
        out[index] = made
        left -= 1
      }
    }
    return out
  }
}

/** The nearest shape the image models draw to a slot's frame. */
export function aiSiteImportPictureShape(aspect: number): AiImageAspectRatio {
  const shapes: ReadonlyArray<readonly [AiImageAspectRatio, number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]]
  const wanted = aspect > 0 && Number.isFinite(aspect) ? aspect : 4 / 3
  return [...shapes].sort((a, b) => Math.abs(a[1] - wanted) - Math.abs(b[1] - wanted))[0]?.[0] ?? '4:3'
}

/** What a generated picture is made through, and whether the workspace's meter has room for it. */
export interface AiSiteImportPictureMakerInput {
  provider: AiImageProvider | null
  ingest: PluginMediaIngest | null
  firestore: FirebaseFirestore.Firestore
  orgId: string
  hostId: string
  uid: string
  /** What the site is, which a picture's own words are read with. */
  about: string
  /** Whether the workspace's meter has room for a picture now. */
  roomFor?: (credits: number) => boolean
  record?: typeof recordAssistCost
}

/**
 * A generated picture through the Media door's own parts (AGL-4152): the image
 * provider at a paid plan's size, the fixed style wording, the media library's
 * ingest as an upload this member made, the same provenance on the asset, and the
 * same meter, charged only once it is stored. `null` where it cannot run here.
 */
export function aiSiteImportPictureMaker(input: AiSiteImportPictureMakerInput): AiSiteImportPictureMaker | null {
  const { provider, ingest } = input
  if (!provider?.configured() || !ingest) return null
  const size = '1K' as const
  return async (slot, tally) => {
    const model = provider.defaultModel()
    if (input.roomFor && !input.roomFor(aiMediaCreditsPerPicture('photo', model, size))) return null
    const words = `${slot.alt}. For a website about: ${input.about}`.replace(/\s+/g, ' ').trim()
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_SITE_IMPORT_GENERATED_PICTURE_MS))
    try {
      const result = await Promise.race([
        provider.generate({ model, prompt: aiMediaRasterPrompt(words, 'natural'), aspectRatio: aiSiteImportPictureShape(slot.aspect), size, count: 1 }),
        timeout,
      ])
      const image = result?.images[0]
      if (!result || !image) return null
      const alt = aiImageAltText(slot.alt)
      const stored = await ingest.ingest({
        hostId: input.hostId,
        uid: input.uid,
        fileName: aiImageFileName(slot.alt, 0, image.mimeType),
        contentType: image.mimeType,
        bytes: Buffer.from(image.base64, 'base64'),
        alt,
        description: 'Created with AI from a description.',
      })
      if (!stored.ok) return null
      const usage = { ...result.usage, images: 1, imageSize: size }
      let signalId: string | null = null
      try {
        signalId = await (input.record ?? recordAssistCost)(input.firestore, input.orgId, {
          route: 'ai/jobs',
          hostId: input.hostId,
          model,
          tier: 'entitled',
          usage,
          docsPaths: [],
          stopReason: 'end_turn',
          free: null,
          uid: input.uid,
          kind: 'image',
        })
      } catch (error) {
        console.error('ai site import: a generated picture’s usage was not recorded', { orgId: input.orgId, error })
      }
      await input.firestore
        .collection('hosts')
        .doc(input.hostId)
        .collection('media')
        .doc(stored.mediaId)
        .update({ aiGenerated: { model, prompt: slot.alt, mode: 'photo', style: 'natural', aspectRatio: aiSiteImportPictureShape(slot.aspect), signalId, generatedBy: input.uid, createdAt: new Date() } })
        .catch((error: unknown) => console.error('ai site import: a generated picture’s record was not written', { mediaId: stored.mediaId, error }))
      tally.generated += 1
      tally.generatedUsd += estimateAiBilledUsd(usage, model)
      return { src: stored.src, width: stored.width ?? 1024, height: stored.height ?? 1024, alt }
    } catch (error) {
      if (!(error instanceof AiImageSafetyRefusal)) console.warn('ai site import: a generated picture failed; its slot is dropped', { error })
      return null
    }
  }
}

/** A page's pictures, as its row reads them once its slots are filled. */
export function aiSiteImportPagePicturesOf(pictures: AiSiteImportPagePictures, tally: AiSiteImportPictureTally): AiSiteImportPagePictures {
  const taken = new Set(tally.placed)
  return { source: pictures.source + tally.source, stock: tally.stock, generated: tally.generated, slots: 0, unplaced: pictures.unplaced.filter((url) => !taken.has(url)) }
}
