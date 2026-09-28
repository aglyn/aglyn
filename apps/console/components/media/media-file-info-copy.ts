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
  embeddedFieldKind,
  MEDIA_EMBEDDED_GROUP_ORDER,
  type MediaEmbeddedField,
  type MediaEmbeddedGroup,
  type MediaEmbeddedPatch,
} from '@aglyn/aglyn/app-utils/media-embedded-fields'

/**
 * The Details drawer's "File info" decisions, out of the component
 * (AGL-3331) — the same split `media-detail-copy.ts` makes, for the same
 * reason: the library component mounts a listener stack, so these are
 * asserted as plain functions.
 */

export interface MediaFileFact {
  label: string
  value: string
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  )
  const scaled = bytes / 1024 ** exponent
  return `${exponent ? scaled.toFixed(scaled < 10 ? 1 : 0) : scaled} ${units[exponent]}`
}

const timestampMs = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as { seconds?: unknown; toMillis?: () => number }
  if (typeof record.toMillis === 'function') return record.toMillis()
  return typeof record.seconds === 'number' ? record.seconds * 1000 : null
}

const formatDuration = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/**
 * What the platform itself knows about the stored file — measured from the
 * bytes or recorded at upload, and so never editable: a size or a digest
 * that could be typed over would stop describing the file.
 */
export function mediaStoredFacts(
  media: Record<string, any> | null | undefined,
  locale?: string,
): MediaFileFact[] {
  if (!media) return []
  const facts: MediaFileFact[] = []
  const push = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') {
      facts.push({ label, value: String(value) })
    }
  }
  const when = (value: unknown) => {
    const ms = timestampMs(value)
    return ms === null
      ? null
      : new Date(ms).toLocaleString(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
  }
  push('Type', media['contentType'])
  push('Size', formatBytes(Number(media['sizeBytes'] ?? 0)))
  const video = media['video'] as
    | { width?: number; height?: number; durationMs?: number; codec?: string }
    | undefined
  const width = media['width'] ?? video?.width
  const height = media['height'] ?? video?.height
  if (width && height) push('Dimensions', `${width} × ${height} px`)
  if (video?.durationMs) push('Duration', formatDuration(video.durationMs))
  if (video?.codec) push('Codec', video.codec)
  push('Uploaded', when(media['createdAt']))
  push('Last changed', when(media['updatedAt']))
  // An API key uploads as `api:{keyId}` — the one uploader worth
  // naming here, because a uid means nothing to the person reading this.
  if (String(media['uploadedBy'] ?? '').startsWith('api:')) {
    push('Uploaded by', 'API key')
  }
  const sha = String(media['contentSha256'] ?? '')
  if (sha) push('SHA-256', `${sha.slice(0, 12)}…`)
  return facts
}

/** Embedded fields bucketed by group, in display order, empty groups out. */
export function groupEmbeddedFields(
  fields: MediaEmbeddedField[],
): Array<{ group: MediaEmbeddedGroup; fields: MediaEmbeddedField[] }> {
  return MEDIA_EMBEDDED_GROUP_ORDER.map((group) => ({
    group,
    fields: fields.filter((field) => field.group === group),
  })).filter((bucket) => bucket.fields.length)
}

/**
 * The text a field is edited as. A list is one entry per line — a creator
 * is routinely "Doe, Jane", so neither comma nor semicolon is a safe
 * separator to put in front of a person. A date loses its zone for the
 * picker, and gets it back on save (see {@link embeddedPatchFromDrafts}).
 */
export function embeddedDraftValue(
  field: Pick<MediaEmbeddedField, 'key' | 'value' | 'values'>,
): string {
  if (field.values) return field.values.join('\n')
  const value = field.value ?? ''
  if (embeddedFieldKind(field.key) === 'date') return value.slice(0, 19)
  return value
}

/** A date's zone suffix (`Z`, `+02:00`), or empty for a local time. */
const zoneOf = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[0] ?? ''

/**
 * The edit a set of drafts amounts to, against the fields they started
 * from: changed keys with their new values, cleared keys as `null`, added
 * keys that were filled in. An untouched field is never in the patch, so a
 * save rewrites only what somebody actually changed.
 */
export function embeddedPatchFromDrafts(
  fields: MediaEmbeddedField[],
  drafts: Record<string, string>,
  removed: ReadonlySet<string> = new Set(),
): MediaEmbeddedPatch {
  const patch: MediaEmbeddedPatch = {}
  const byKey = new Map(fields.map((field) => [field.key, field]))
  for (const key of removed) {
    if (byKey.has(key)) patch[key] = null
  }
  for (const [key, draft] of Object.entries(drafts)) {
    if (removed.has(key)) continue
    const field = byKey.get(key)
    const kind = embeddedFieldKind(key)
    const trimmed = draft.trim()
    if (field && trimmed === embeddedDraftValue(field).trim()) continue
    if (!field && !trimmed) continue
    if (!trimmed) {
      patch[key] = null
      continue
    }
    if (kind === 'list') {
      patch[key] = trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      continue
    }
    if (kind === 'date') {
      // `datetime-local` answers without seconds when they are zero.
      const withSeconds = /T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed
      patch[key] = withSeconds + zoneOf(field?.value ?? '')
      continue
    }
    patch[key] = trimmed
  }
  return patch
}
