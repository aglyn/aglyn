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

import { createHmac, timingSafeEqual } from 'crypto'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import type { PrinterBrand } from '../model/commerce-printers'
import { tokenSigningSecret } from './download'

/**
 * The per-printer secret in a cloud printer's poll URL (AGL-3619).
 *
 * DERIVED, NOT STORED: `HMAC(TOKEN_SIGNING_SECRET, printer:{hostId}:{printerId}:{version})`,
 * the supplier-token construction (`supplier-update.ts`). Nothing secret sits
 * in a Firestore document a client can read, a manager can be shown the URL
 * again whenever they need to paste it, and "Regenerate URL" invalidates the
 * old one by bumping `secretVersion` on the printer.
 *
 * It rides in the URL PATH rather than in HTTP authentication because the two
 * vendors disagree: Star CloudPRNT offers Basic and Epson Server Direct Print
 * offers Digest, and both accept any https URL. The printer's own identity
 * (Star's MAC, Epson's ID) is checked as well, so the URL alone does not let
 * a different device drain the queue.
 */
export function printerSecret(hostId: string, printerId: string, version: number): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`printer:${hostId}:${printerId}:${Math.max(0, Math.floor(Number(version) || 0))}`)
    .digest('hex')
    .slice(0, 40)
}

/** Constant-time comparison of a presented secret with the printer's current one. */
export function printerSecretMatches(
  hostId: string,
  printerId: string,
  version: number,
  presented: unknown,
): boolean {
  const candidate = typeof presented === 'string' ? presented.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{40}$/.test(candidate)) return false
  let expected: string
  try {
    expected = printerSecret(hostId, printerId, version)
  } catch {
    // TOKEN_SIGNING_SECRET is not configured: nothing can authenticate.
    return false
  }
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
}

/** The route each brand polls, under the console's plugin API dispatcher. */
export const PRINTER_POLL_ROUTE: Record<PrinterBrand, string> = {
  star: 'commerce/cloudprnt',
  epson: 'commerce/epson-sdp',
}

/** The full https URL a manager pastes into the printer's web configuration. */
export function printerPollUrl(
  brand: PrinterBrand,
  hostId: string,
  printerId: string,
  version: number,
): string {
  return (
    `${platformConsoleOrigin()}/api/${PRINTER_POLL_ROUTE[brand]}/` +
    `${encodeURIComponent(hostId)}/${encodeURIComponent(printerId)}/` +
    printerSecret(hostId, printerId, version)
  )
}
