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
 * Pure helpers behind the asset-detail drawer (AGL-2143).
 *
 * The DAM component is 4,000+ lines and mounts a live Firestore tree, so
 * anything with a rule in it goes here where a test can reach it directly.
 */

/**
 * The stored tag value is a comma-joined string and stays one — the filter
 * chips, the bulk tag actions and the API all read that shape. This only
 * changes how it is EDITED.
 */
export function parseTagList(value: string | undefined): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of String(value ?? '').split(',')) {
    const tag = raw.trim()
    if (!tag) continue
    // Case-insensitively deduped, first spelling wins. `Hero` and `hero`
    // are one tag to a person and were two to the filter row.
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/** Back to the stored shape. Round-trips a parsed list unchanged. */
export function serializeTagList(tags: readonly string[]): string {
  return tags.join(', ')
}

/**
 * Adds one tag to a stored value.
 *
 * Returns the value UNCHANGED when the tag is blank or already present, so
 * a stray Enter cannot append an empty entry — which is how the free-text
 * field grew `brand,hero,` and then a tag named `` that no chip matched.
 */
export function addTag(value: string | undefined, tag: string): string {
  const tags = parseTagList(value)
  const trimmed = tag.trim()
  if (!trimmed) return serializeTagList(tags)
  if (tags.some((existing) => existing.toLowerCase() === trimmed.toLowerCase()))
    return serializeTagList(tags)
  return serializeTagList([...tags, trimmed])
}

/** Removes one tag, matching case-insensitively. */
export function removeTag(value: string | undefined, tag: string): string {
  return serializeTagList(
    parseTagList(value).filter(
      (existing) => existing.toLowerCase() !== tag.trim().toLowerCase(),
    ),
  )
}

export interface MediaDeliveryDescription {
  /** Drives the status dot's colour. */
  tone: 'success' | 'warning' | 'info'
  /** The line itself, e.g. `CDN · variants 320 / 640 / 1280`. */
  label: string
}

/**
 * What `/product/media`'s asset-detail mockup shows in its footer:
 * a green dot and `CDN · variants 320 / 640 / 1280`.
 *
 * Read off the asset's OWN `variants` array rather than
 * `MEDIA_CDN_VARIANT_WIDTHS`. The constant says what the generator aims to
 * produce; the array says what this file actually has. They differ for
 * every SVG (nothing to resize), every asset uploaded before variants
 * existed, and every asset whose generation has not finished — and a footer
 * that names three widths an asset does not have is worse than no footer,
 * because `?w=` on a missing variant silently serves the original.
 *
 * It is also why this takes no entitlement argument. `cdnPath` is written
 * only for orgs with `mediaCdn`, so its presence IS the answer, and the
 * unentitled case already has its own chip and tooltip elsewhere.
 */
export function describeMediaDelivery(media: {
  cdnPath?: string
  variants?: number[]
  contentType?: string
}): MediaDeliveryDescription {
  const widths = [...(media.variants ?? [])]
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((a, b) => a - b)
  if (!media.cdnPath) {
    return {
      tone: 'warning',
      label: 'Served from storage — no CDN on this plan',
    }
  }
  if (widths.length === 0) {
    const isImage = String(media.contentType ?? '').startsWith('image/')
    return {
      tone: 'info',
      label: isImage
        ? 'CDN · original only, no resized variants for this file'
        : 'CDN · original only',
    }
  }
  return {
    tone: 'success',
    label: `CDN · variants ${widths.join(' / ')}`,
  }
}

/**
 * Filename to save a download under.
 *
 * The display `name` is what the customer renamed the file to, and the
 * object path carries the real extension — `Hero background` must not land
 * on disk without `.jpg`. Falls back to the object path's own basename.
 */
export function downloadFileName(media: {
  name?: string
  objectPath?: string
  url?: string
  contentType?: string
}): string {
  const source = media.objectPath ?? media.url ?? ''
  const pathExt = /\.([A-Za-z0-9]{1,8})(?:\?|$)/.exec(
    source.split('/').pop() ?? '',
  )?.[1]
  const typeExt = String(media.contentType ?? '').split('/')[1]?.split('+')[0]
  const extension = pathExt ?? (typeExt || undefined)
  const base = (media.name ?? '').trim() || (source.split('/').pop() ?? 'file')
  if (!extension) return base
  return base.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? base
    : `${base}.${extension}`
}
