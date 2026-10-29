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

import type { VisitorUploadFileView, VisitorUploadRequest } from './visitor-upload'

/*==========================================
 * SENDING ONE FILE FROM THE BROWSER (AGL-4096).
 *
 * Three steps, the middle one straight to Storage so a 25 MB file never
 * passes through a function (whose request body stops at 4.5 MB):
 *
 *   1. ask the route for a TICKET for this file's name, type and size;
 *   2. POST the bytes to the signed upload the ticket carries, as a form;
 *   3. ask the route to FINALIZE the ticket, which checks the bytes and keeps
 *      them, and answers the file's record.
 *
 * The form in step 2 is sent `no-cors`. A site lives on its own domain, any
 * domain, and the bucket answers cross-origin requests only for the console's
 * addresses, which are listed one by one (AGL-1452); a form post needs no
 * such permission. Its answer cannot be read in return, and does not need to
 * be: finalize is what says whether the file arrived, and refuses one that
 * did not. Storage itself holds the post to the size, type and path signed
 * into its policy.
 *
 * The plugin supplies the two calls to its own routes, which decide who may
 * upload for what; this only moves the bytes.
 *=========================================*/

/** What a ticket route answers. */
export interface VisitorUploadTicketAnswer {
  ticket: string
  upload: { url: string; fields: Record<string, string> }
}

export type VisitorUploadOutcome = { ok: true; file: VisitorUploadFileView } | { ok: false; error: string }

const NOT_SENT = 'The file could not be sent. Check your connection and try again.'

/** Sends one file through a ticket, the signed upload and finalize. Never throws. */
export async function sendVisitorUpload(options: {
  file: Blob & { name: string }
  requestTicket(request: VisitorUploadRequest): Promise<VisitorUploadTicketAnswer | { error: string }>
  finalize(ticket: string): Promise<{ file: VisitorUploadFileView } | { error: string }>
  fetchImpl?: typeof fetch
}): Promise<VisitorUploadOutcome> {
  const { file } = options
  const send = options.fetchImpl ?? globalThis.fetch
  try {
    const ticket = await options.requestTicket({ name: file.name, contentType: file.type, size: file.size })
    if ('error' in ticket) return { ok: false, error: ticket.error }
    if (!ticket.ticket || !ticket.upload?.url) return { ok: false, error: NOT_SENT }
    const form = new FormData()
    for (const [key, value] of Object.entries(ticket.upload.fields ?? {})) form.append(key, value)
    // Storage reads the policy's fields first and the file last.
    form.append('file', file)
    await send(ticket.upload.url, { method: 'POST', mode: 'no-cors', body: form })
    const finished = await options.finalize(ticket.ticket)
    if ('error' in finished) return { ok: false, error: finished.error }
    return { ok: true, file: finished.file }
  } catch {
    return { ok: false, error: NOT_SENT }
  }
}
