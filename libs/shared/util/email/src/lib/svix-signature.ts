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

/**
 * THE ONE SVIX SIGNATURE CHECK.
 *
 * Resend signs every webhook the Svix way: HMAC-SHA256 over
 * `{svix-id}.{svix-timestamp}.{raw body}` with the base64 secret after
 * `whsec_`, and a `svix-signature` header carrying space-delimited
 * `v1,<base64>` entries, any one of which may match during a secret
 * rotation. The delivery-events webhook has verified this since AGL-268;
 * the CRM's capture webhook (AGL-2657) verifies it too, and a second
 * implementation would be a second place for the comparison to stop being
 * constant-time. So the check lives here, and both import it.
 *
 * Signs the RAW body — the exact request text, never a re-serialization —
 * which is why the callers hand this a `Buffer` of `req.rawBody`.
 */
export function verifySvixSignature(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer,
  signatureHeader: string,
): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(payload)
      .digest()
    return signatureHeader.split(' ').some((entry) => {
      const [, signature] = entry.split(',')
      if (!signature) return false
      const candidate = Buffer.from(signature, 'base64')
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      )
    })
  } catch {
    return false
  }
}

/**
 * The `svix-signature` header value a test fixture or a replay tool signs a
 * payload with — the inverse of {@link verifySvixSignature}, so a spec never
 * spells the HMAC recipe a second time.
 */
export function signSvixPayload(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer | string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
    .digest('base64')
  return `v1,${signature}`
}
