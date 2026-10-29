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

import type { PluginApiHandler } from '@aglyn/aglyn/server'

/**
 * How a route answers with a quote's or an invoice's PDF (AGL-4095). Kept
 * apart from `commerce-pdf.ts`, which makes the file, so a route sends one
 * without loading the PDF writer or sharp.
 */

export interface CommercePdfFile {
  bytes: Uint8Array
  /** ASCII, ending `.pdf`. */
  filename: string
}

/** The headers a PDF answer carries: a download, never cached, indexed or referred on. */
export function pdfResponseHeaders(file: CommercePdfFile): Record<string, string> {
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  }
}

/** Sends a PDF on the (req, res) shape. */
export function sendPdf(res: Parameters<PluginApiHandler>[1], file: CommercePdfFile): void {
  for (const [name, value] of Object.entries(pdfResponseHeaders(file))) res.setHeader(name, value)
  res.status(200).send(Buffer.from(file.bytes))
}
