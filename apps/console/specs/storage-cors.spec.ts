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

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The bucket CORS rule, checked against the request the uploader ACTUALLY
 * issues (AGL-1408).
 *
 * AGL-1317 was verified by watching `/api/media/upload-url` mint a signed
 * URL and return 200. It does. The leg that carries the bytes — the browser's
 * `PUT` straight to `storage.googleapis.com` — was never driven, and it could
 * not have succeeded: `gs://aglyn-main.appspot.com` had no CORS configuration
 * at all, so the preflight failed and every large-file upload died as
 * `TypeError: Failed to fetch` behind a generic "try again" snackbar.
 *
 * This spec cannot make a cross-origin request, so it does the next thing
 * that would have caught it: it PARSES the `PUT` out of the uploader and
 * asserts `cloud/storage-cors.json` permits that exact request — the method
 * it uses and every header it sets. Asserting a plausible-looking policy in
 * isolation is what let the two drift apart in the first place, so nothing
 * here is written from memory of the client; it is all read back out of it.
 *
 * What this does NOT prove: that the committed document is what is actually
 * on the bucket. Nothing in a repo can prove that — see
 * `docs/STORAGE_MANUAL_CONFIG.md` for the read-back command.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** The one origin the console is served on today. See the doc for why only one. */
const CONSOLE_ORIGIN = 'https://app.aglyn.com'

interface CorsRule {
  origin?: string[]
  method?: string[]
  responseHeader?: string[]
  maxAgeSeconds?: number
}

function corsRules(): CorsRule[] {
  const raw = readFileSync(join(REPO_ROOT, 'cloud', 'storage-cors.json'), 'utf8')
  return JSON.parse(raw) as CorsRule[]
}

/**
 * The signed `PUT` as the uploader writes it — method and header names read
 * out of the source, not restated here. A header added to that call without a
 * matching `responseHeader` entry fails the preflight in production and fails
 * this spec first.
 */
function signedPutRequest(): { method: string; headers: string[] } {
  const source = readFileSync(
    join(
      REPO_ROOT,
      'apps/console/components/media/media-library.component.tsx',
    ),
    'utf8',
  )
  const start = source.indexOf('fetch(minted.uploadUrl')
  if (start < 0) {
    throw new Error(
      'The DAM uploader no longer PUTs to the minted signed URL — re-derive ' +
        'this spec against whatever replaced it before deleting it.',
    )
  }
  const block = source.slice(start, start + 600)
  const method = /method:\s*'([A-Z]+)'/.exec(block)?.[1] ?? ''
  const headerBlock = /headers:\s*\{([\s\S]*?)\}/.exec(block)?.[1] ?? ''
  const headers = [...headerBlock.matchAll(/(['"])([\w-]+)\1\s*:/g)].map(
    (match) => match[2],
  )
  return { method, headers }
}

describe('signed direct-to-GCS upload CORS (AGL-1408)', () => {
  it('still routes large uploads through a direct PUT to the signed URL', () => {
    const { method, headers } = signedPutRequest()
    expect(method).toBe('PUT')
    // A PUT is never a CORS "simple request", and `Content-Type: application/pdf`
    // is not a safelisted value either — so this call is always preflighted.
    // That is the whole reason a CORS rule is required at all.
    expect(headers).toContain('Content-Type')
  })

  it('permits that exact method from the console origin', () => {
    const { method } = signedPutRequest()
    const rule = corsRules().find((entry) =>
      (entry.origin ?? []).includes(CONSOLE_ORIGIN),
    )
    expect(rule).toBeDefined()
    expect(rule?.method ?? []).toContain(method)
  })

  it('allowlists every header the uploader sets on the PUT', () => {
    const { headers } = signedPutRequest()
    const rule = corsRules().find((entry) =>
      (entry.origin ?? []).includes(CONSOLE_ORIGIN),
    )
    const allowed = (rule?.responseHeader ?? []).map((header) =>
      header.toLowerCase(),
    )
    for (const header of headers) {
      // GCS answers the preflight's `Access-Control-Request-Headers` from
      // `responseHeader`; a header the client sends and the rule omits is a
      // failed preflight, which the browser reports only as "Failed to fetch".
      expect(allowed).toContain(header.toLowerCase())
    }
  })

  it('never wildcards the origin on a bucket that accepts signed writes', () => {
    for (const rule of corsRules()) {
      // The signed URL carries the authorization, so CORS is the only thing
      // deciding WHICH page may present one. `*` would let any site on the
      // internet drive an upload with a leaked URL for its full 15-minute TTL.
      expect(rule.origin ?? []).not.toContain('*')
      expect(rule.origin ?? []).not.toHaveLength(0)
      for (const origin of rule.origin ?? []) {
        expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/)
      }
    }
  })

  it('caches the preflight rather than paying it per file', () => {
    for (const rule of corsRules()) {
      expect(rule.maxAgeSeconds ?? 0).toBeGreaterThan(0)
    }
  })
})
