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

import { messageSender } from '@aglyn/aglyn/app-utils/message-search'

/**
 * How the Inbox renders one submission (AGL-2168).
 *
 * `/product/forms`'s hero mockup IS the Inbox, and it shows every row as a
 * person: a coloured initials avatar, `Priya Nair`, the form name, and
 * `2m`. The console rendered no sender at all — the row's one content cell
 * was every field concatenated as `name: Priya Nair · email: … · message:
 * …`, so the name was in there somewhere, at the mercy of whatever order
 * the author happened to define the fields in.
 */

export interface SubmissionSender {
  /** Best available display name — a name, else an email, else a fallback. */
  label: string
  /** The email, when one was submitted. */
  email?: string
  /** One or two letters for the avatar. */
  initials: string
}

/**
 * Who sent it.
 *
 * A form is author-defined, so there is no guaranteed name field — the
 * lookup is by convention and falls back to the email, then to the form's
 * own name. It never returns an empty string: an avatar with no letters in
 * it is worse than a generic one.
 */
export function submissionSender(
  fields: Record<string, unknown> | undefined,
  fallback = 'Someone',
): SubmissionSender {
  // The platform's one convention for who wrote in — the one the list's
  // From filter and search are stamped from (AGL-3321), so the name a row
  // draws is the name it is found by.
  const { name, email } = messageSender(fields)
  const label = name ?? email ?? fallback
  return { label, ...(email ? { email } : {}), initials: initialsOf(label) }
}

/**
 * Up to two initials. An email falls back to its local part, so
 * `priya@lumen.co` gives `P` rather than a `@`.
 */
export function initialsOf(label: string): string {
  const trimmed = String(label ?? '').trim()
  const source = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed
  const words = source
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
  const letters = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return (letters || source[0] || '?').toUpperCase()
}

/**
 * A deterministic hue for the avatar, so one sender keeps one colour
 * across sessions and machines. The mockup's avatars are coloured, and a
 * random palette index would make the same person a different colour on
 * every render.
 */
export function senderHue(label: string): number {
  let hash = 0
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) % 360
  }
  return hash
}

/**
 * `2m`, `18m`, `1h`, `3d` — the relative times the mockup's list shows.
 *
 * The console rendered `toLocaleString()`, which is the right answer to a
 * different question: an inbox is scanned for recency, and "8/18/2026,
 * 2:04:31 PM" makes the reader do the subtraction. The absolute time stays
 * on the detail pane, where it is the fact you actually want.
 */
export function relativeTime(
  atMs: number | undefined,
  nowMs: number = Date.now(),
): string {
  if (!atMs || !Number.isFinite(atMs)) return '--'
  const seconds = Math.round((nowMs - atMs) / 1000)
  // A clock skew between the browser and the server can put a fresh
  // submission a few seconds in the future. "in 4 seconds" on an inbox row
  // is a bug report waiting to happen; "now" is simply true.
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  return `${Math.floor(days / 30)}mo`
}

export interface SubmissionRouting {
  /** The dataset a record was appended to, when one was. */
  dataset?: { id?: string; name?: string; recordId?: string }
  /**
   * The dataset the form is bound to, when the record was refused because a
   * value failed the dataset's model (AGL-2773): field id → the reason.
   */
  datasetRefused?: {
    id?: string
    name?: string
    errors?: Record<string, string>
  }
}

export interface RoutingChip {
  label: string
  color: 'success' | 'info' | 'warning' | 'default'
}

/**
 * The status chips the mockup's detail pane carries under the fields:
 * `Saved to Inbox` (green) and `Added to "Leads" dataset` (blue).
 *
 * The first is unconditional and free — every submission that exists is in
 * the Inbox, which is exactly why the mockup shows it: it is the
 * reassurance, not a status.
 *
 * The second reports what the submit route actually DID. It is stamped on
 * the document only when a record was really appended, so a form bound to
 * a dataset that was deleted, or whose record quota was full, shows no chip
 * rather than a chip for a row that does not exist — the two failure modes
 * the route already swallows silently.
 */
export function routingChips(routing: SubmissionRouting | undefined): RoutingChip[] {
  const chips: RoutingChip[] = [{ label: 'Saved to Inbox', color: 'success' }]
  const dataset = routing?.dataset
  if (dataset?.recordId) {
    chips.push({
      label: dataset.name
        ? `Added to “${dataset.name}” dataset`
        : 'Added to a dataset',
      color: 'info',
    })
  }
  /*
   * The record the submission did NOT become, and why (AGL-2773). A form
   * bound to a dataset whose model refuses one of the submitted values keeps
   * the submission and writes no row; without this the owner sees a form
   * that "stopped saving" and no reason for it.
   */
  const refused = routing?.datasetRefused
  if (refused && !dataset?.recordId) {
    const reasons = Object.values(refused.errors ?? {}).filter(
      (reason) => typeof reason === 'string' && reason,
    )
    const where = refused.name ? `“${refused.name}” dataset` : 'the dataset'
    chips.push({
      label: reasons.length
        ? `Not added to ${where}: ${reasons.join('; ')}`
        : `Not added to ${where}`,
      color: 'warning',
    })
  }
  return chips
}

/**
 * A file a submission carries (AGL-4098), as the Inbox lists it: its id, the
 * field it answered, its name, type and size. The forms plugin records them;
 * the Inbox reads them off the stored row defensively and downloads each
 * through that plugin's route, never from storage itself.
 */
export interface SubmissionFile {
  id: string
  field: string
  name: string
  contentType: string
  size: number
}

/** The most files a submission carries. */
const SUBMISSION_FILES_MAX = 10

/** The files a stored submission names, in order; none for a row without any. */
export function submissionFiles(raw: unknown): SubmissionFile[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, SUBMISSION_FILES_MAX).flatMap((entry) => {
    const file = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const id = typeof file['id'] === 'string' ? file['id'] : ''
    const name = typeof file['name'] === 'string' ? file['name'] : ''
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !name) return []
    return [
      {
        id,
        field: typeof file['field'] === 'string' ? file['field'] : '',
        name,
        contentType: typeof file['contentType'] === 'string' ? file['contentType'] : '',
        size: Number(file['size']) || 0,
      },
    ]
  })
}

/** `12 KB`, `3.4 MB`: a file's size as the Inbox shows it. */
export function submissionFileSize(bytes: number): string {
  if (!(bytes > 0)) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

/**
 * What a submission asks for, as a chip says it (AGL-4098): "Quote request"
 * for a submission from a form marked as asking for a quote, else null.
 */
export function submissionRequestLabel(raw: unknown): string | null {
  const kind = (raw as { kind?: unknown } | null | undefined)?.kind
  return kind === 'quote' ? 'Quote request' : null
}

/** The kind of request a submission is, for a plugin that answers it, or null. */
export function submissionRequestKind(raw: unknown): string | null {
  const kind = (raw as { kind?: unknown } | null | undefined)?.kind
  return typeof kind === 'string' && /^[a-z][a-z-]{0,31}$/.test(kind) ? kind : null
}
