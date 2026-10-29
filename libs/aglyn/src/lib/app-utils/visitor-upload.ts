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
 * FILES A VISITOR SENDS A BUSINESS (AGL-4096).
 *
 * Artwork for a quote, a logo with a request form: files someone without an
 * account hands a business through its site. This module is the policy, pure
 * and shared by the browser and the server:
 *
 * - which files are taken ({@link VISITOR_UPLOAD_TYPES}: PNG, JPEG, WebP,
 *   GIF, PDF, SVG, AI, EPS, PSD, TIFF), how big ({@link VISITOR_UPLOAD_MAX_BYTES})
 *   and how many at once ({@link VISITOR_UPLOAD_MAX_FILES});
 * - what a file's type IS ({@link resolveVisitorUploadType}): read from its
 *   name and checked against what the browser said, so a `.psd` a browser
 *   labels `application/octet-stream` is still a Photoshop file and a `.png`
 *   labelled `text/html` is nothing;
 * - where its bytes live ({@link visitorUploadPendingPath} while it is on its
 *   way, {@link visitorUploadFinalPath} once it is checked);
 * - the record a finished upload is ({@link VisitorUploadFile}).
 *
 * The server half (`@aglyn/tenant-data-admin/server/visitor-upload`) signs the
 * upload, inspects the bytes and moves them; the browser half
 * (`visitor-upload-client.ts`) sends them. A plugin that takes files (commerce
 * for a quote's artwork, forms for a request) names its own `purpose` and the
 * record it is for, and decides for itself who may upload for it.
 *=========================================*/

/** The most one file may weigh. */
export const VISITOR_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** The most files one submission carries. */
export const VISITOR_UPLOAD_MAX_FILES = 10

/** How long the signed upload a ticket carries can be used, from its minting. */
export const VISITOR_UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000

/**
 * Where uploads wait until they are checked. Top-level, never under `hosts/`:
 * the bucket's lifecycle deletes whatever is still here a day after it
 * arrived (`cloud/media-bucket-lifecycle.json`), which no rule may do under a
 * prefix that holds live customer files.
 */
export const VISITOR_UPLOAD_PENDING_PREFIX = 'visitor-uploads-pending/'

/** The honeypot field a form posts beside its files, as the forms plugin names it. */
export const VISITOR_UPLOAD_HONEYPOT_FIELD = 'website'

/** One kind of file a visitor may send. */
export interface VisitorUploadType {
  /** The type the file is stored and served as. */
  contentType: string
  /** Lower-case, with the dot. The first is the one a file is renamed to when it has none. */
  extensions: readonly string[]
  /** What a person calls it. */
  label: string
  /**
   * Shown in the page as a picture. Only raster formats a browser draws and
   * that cannot carry script; everything else downloads.
   */
  inline: boolean
  /** Other types a browser reports for this kind of file. */
  aliases?: readonly string[]
}

export const VISITOR_UPLOAD_TYPES: readonly VisitorUploadType[] = [
  { contentType: 'image/png', extensions: ['.png'], label: 'PNG', inline: true },
  { contentType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], label: 'JPEG', inline: true, aliases: ['image/jpg', 'image/pjpeg'] },
  { contentType: 'image/webp', extensions: ['.webp'], label: 'WebP', inline: true },
  { contentType: 'image/gif', extensions: ['.gif'], label: 'GIF', inline: true },
  { contentType: 'application/pdf', extensions: ['.pdf'], label: 'PDF', inline: false, aliases: ['application/x-pdf'] },
  // Stripped of script on the way in, and still downloaded rather than drawn.
  { contentType: 'image/svg+xml', extensions: ['.svg'], label: 'SVG', inline: false },
  {
    contentType: 'application/illustrator',
    extensions: ['.ai'],
    label: 'AI',
    inline: false,
    aliases: ['application/postscript', 'application/pdf', 'application/vnd.adobe.illustrator'],
  },
  { contentType: 'application/postscript', extensions: ['.eps'], label: 'EPS', inline: false, aliases: ['application/eps', 'image/eps', 'image/x-eps', 'application/x-eps'] },
  {
    contentType: 'image/vnd.adobe.photoshop',
    extensions: ['.psd'],
    label: 'PSD',
    inline: false,
    aliases: ['application/x-photoshop', 'application/photoshop', 'application/psd', 'image/psd', 'image/x-photoshop'],
  },
  { contentType: 'image/tiff', extensions: ['.tif', '.tiff'], label: 'TIFF', inline: false, aliases: ['image/x-tiff'] },
]

/** Types a browser sends when it does not know; the name decides then. */
const UNKNOWN_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown'])

/** `PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF`. */
export function describeVisitorUploadTypes(): string {
  const labels = VISITOR_UPLOAD_TYPES.map((type) => type.label)
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** The file picker's `accept`: every extension and type taken. */
export const VISITOR_UPLOAD_ACCEPT = VISITOR_UPLOAD_TYPES.flatMap((type) => [
  ...type.extensions,
  type.contentType,
]).join(',')

/** `25 MB`. */
export function formatVisitorUploadBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

/** The extension of a file name, lower-case with its dot, or ''. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * The type a file is taken as, or null when it is not one this takes. The
 * NAME decides, because a browser reports most design files as nothing or as
 * something generic; the reported type only has to agree with it (be this
 * type, one it is known by, or unknown). The bytes are checked against the
 * answer after they arrive.
 */
export function resolveVisitorUploadType(name: string, reportedType: string): VisitorUploadType | null {
  const extension = extensionOf(String(name ?? ''))
  const reported = String(reportedType ?? '').split(';')[0].trim().toLowerCase()
  const byName = VISITOR_UPLOAD_TYPES.find((type) => type.extensions.includes(extension))
  if (!byName) return null
  if (UNKNOWN_TYPES.has(reported) || reported === byName.contentType) return byName
  return byName.aliases?.includes(reported) ? byName : null
}

/** A stored type, as the list of types knows it; null for anything else. */
export function visitorUploadTypeOf(contentType: string): VisitorUploadType | null {
  return VISITOR_UPLOAD_TYPES.find((type) => type.contentType === contentType) ?? null
}

/** Whether a stored file may be shown as a picture rather than downloaded. */
export function visitorUploadIsInline(contentType: string): boolean {
  return visitorUploadTypeOf(contentType)?.inline === true
}

/**
 * A file name safe to keep and to put in a download's header: no folders, no
 * control or quoting characters, at most 120 characters, and ending in the
 * extension of the type it was taken as.
 */
export function safeVisitorUploadName(name: string, type: VisitorUploadType): string {
  const last = String(name ?? '').split(/[\\/]/).pop() ?? ''
  // Control characters, quotes and the characters a header or a path would read.
  const base = Array.from(last)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'"<>|:*?%;'.includes(character)
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const extension = extensionOf(base)
  const stem = (type.extensions.includes(extension) ? base.slice(0, -extension.length) : base).trim()
  const kept = (stem || 'file').slice(0, 120 - 6).trim() || 'file'
  return `${kept}${type.extensions.includes(extension) ? extension : type.extensions[0]}`
}

/** What the browser asks to upload: a file's name, its reported type and its size. */
export interface VisitorUploadRequest {
  name: string
  contentType: string
  size: number
}

/** A request, checked: the type it is taken as and a safe name. */
export interface CheckedVisitorUpload {
  name: string
  type: VisitorUploadType
  size: number
}

/**
 * Checks what the browser asks to send, before anything is signed: one of
 * the types taken, not empty, not over the size. The answer's `error` names
 * the file and what to do.
 */
export function checkVisitorUploadRequest(
  raw: unknown,
  options: { maxBytes?: number } = {},
): { ok: true; upload: CheckedVisitorUpload } | { ok: false; error: string; code: 'type' | 'size' | 'empty' } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof source['name'] === 'string' ? source['name'].slice(0, 400) : ''
  const size = Number(source['size'])
  const shown = name.split(/[\\/]/).pop()?.trim() || 'This file'
  const type = resolveVisitorUploadType(name, typeof source['contentType'] === 'string' ? source['contentType'] : '')
  if (!type) {
    return {
      ok: false,
      code: 'type',
      error: `${shown} can't be sent. Send a ${describeVisitorUploadTypes()} file.`,
    }
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, code: 'empty', error: `${shown} is empty.` }
  }
  const maxBytes = Math.min(options.maxBytes ?? VISITOR_UPLOAD_MAX_BYTES, VISITOR_UPLOAD_MAX_BYTES)
  if (size > maxBytes) {
    return {
      ok: false,
      code: 'size',
      error: `${shown} is ${formatVisitorUploadBytes(size)}. Files can be up to ${formatVisitorUploadBytes(maxBytes)}.`,
    }
  }
  return { ok: true, upload: { name: safeVisitorUploadName(name, type), type, size } }
}

/** A file a visitor or a member sent, once it is checked and kept. */
export interface VisitorUploadFile {
  /** Unique within its purpose and record. */
  id: string
  /** The name it was sent with, made safe. */
  name: string
  contentType: string
  /** Bytes, as stored (an SVG may shrink when its script is stripped). */
  size: number
  /** The private Storage object. Never sent to a visitor. */
  path: string
  uploadedAtMs: number
}

/** A file as a visitor's page may see it: no storage path. */
export type VisitorUploadFileView = Omit<VisitorUploadFile, 'path'>

/** The record without its storage path. */
export function visitorUploadFileView(file: VisitorUploadFile): VisitorUploadFileView {
  return { id: file.id, name: file.name, contentType: file.contentType, size: file.size, uploadedAtMs: file.uploadedAtMs }
}

/** A purpose or a record id as a path segment: letters, digits, `-` and `_`, and not too long. */
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

export function isVisitorUploadSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT.test(value)
}

/** What an upload is for: the site, what kind of thing (`quote-artwork`), and which one. */
export interface VisitorUploadScope {
  hostId: string
  purpose: string
  purposeId: string
}

/** Whether every part of a scope can be a path segment. */
export function isVisitorUploadScope(scope: Partial<VisitorUploadScope>): scope is VisitorUploadScope {
  return isVisitorUploadSegment(scope.hostId) && isVisitorUploadSegment(scope.purpose) && isVisitorUploadSegment(scope.purposeId)
}

/** Where a file waits between the browser's upload and its check. */
export function visitorUploadPendingPath(scope: VisitorUploadScope, uploadId: string): string {
  return `${VISITOR_UPLOAD_PENDING_PREFIX}${scope.hostId}/${scope.purpose}/${scope.purposeId}/${uploadId}`
}

/** The folder every kept file of one purpose and record is in. */
export function visitorUploadFolder(scope: VisitorUploadScope): string {
  return `hosts/${scope.hostId}/private/uploads/${scope.purpose}/${scope.purposeId}/`
}

/** Where a checked file is kept: private to the site, with no download token. */
export function visitorUploadFinalPath(scope: VisitorUploadScope, uploadId: string): string {
  return `${visitorUploadFolder(scope)}${uploadId}`
}

/**
 * The files a browser picked, checked before any is sent: how many, and each
 * one's type and size. `already` is how many the submission holds.
 */
export function checkVisitorUploadSelection(
  files: ReadonlyArray<{ name: string; type: string; size: number }>,
  already = 0,
  maxFiles = VISITOR_UPLOAD_MAX_FILES,
): string | null {
  if (already + files.length > maxFiles) {
    return `Send up to ${maxFiles} files at a time.`
  }
  for (const file of files) {
    const checked = checkVisitorUploadRequest({ name: file.name, contentType: file.type, size: file.size })
    if ('error' in checked) return checked.error
  }
  return null
}
