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

'use client'

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Saving a quote's or an invoice's PDF from the console (AGL-4095): the
 * server makes the file (`commerce/quote` `pdf`, `commerce/order-print`
 * `kind=invoice-pdf`), and the browser saves it under the name the answer
 * gives.
 */

/** The file name an answer's `Content-Disposition` gives, or `fallback`. */
export function pdfFilenameFrom(disposition: string | null | undefined, fallback: string): string {
  const named = /filename="?([^";]+)"?/i.exec(String(disposition ?? ''))?.[1]?.trim()
  return named && /\.pdf$/i.test(named) ? named : fallback
}

/**
 * Asks for a PDF with the signed-in account's token and saves it. Resolves to
 * null when it was saved, or to the message to show when it was refused.
 */
export async function downloadCommercePdf(
  user: Parameters<typeof authorizedFetch>[0],
  path: string,
  init: RequestInit,
  fallbackName: string,
): Promise<string | null> {
  let response: Response
  try {
    response = await authorizedFetch(user, path, init)
  } catch {
    return 'The PDF could not be made. Check your connection and try again.'
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    return String(payload?.error ?? 'The PDF could not be made')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = pdfFilenameFrom(response.headers.get('content-disposition'), fallbackName)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return null
}
