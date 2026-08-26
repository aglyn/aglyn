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
 * `docs.aglyn.com` SHIPPED WITH NO CSP AND NO `nosniff` AT ALL (AGL-1152).
 *
 * Measured on the live site 2026-08-26: the only security header on the whole
 * origin was `Strict-Transport-Security`. The console has had an enforcing
 * nonce'd `script-src` since AGL-523 and the tenant has enforcing `object-src`
 * / `base-uri` / `frame-ancestors`; docs had nothing, and nothing was watching,
 * because `vercel.json` is JSON and cannot hold the comment that would have
 * said so. This spec is that comment, with a failing test attached.
 *
 * Docs is a STATIC Docusaurus build, not a Next app, so there is no middleware
 * and no per-request anything: headers come from `apps/docs/vercel.json`.
 *
 * ## Why this policy carries no `script-src` yet
 *
 * The page runs 5 INLINE scripts (Docusaurus colour-mode bootstrap and the
 * gtag loader) plus `googletagmanager.com`, and carries 52 inline `style`
 * ATTRIBUTES. A `script-src` without `'unsafe-inline'` therefore has to name
 * those five by hash, and because the build output is static the hashes are
 * computable — at BUILD time, which is a postbuild step this change does not
 * include. Shipping `'unsafe-inline'` to get a `script-src` line into the
 * header would be worse than having none: it reads as protection in an audit
 * and stops nothing.
 *
 * ⛔ And NOT a report-only `script-src` "to gather evidence" in the meantime.
 * A static site has no route handler, so there is no collector to point
 * `report-uri` at, and this codebase has already been burned twice by policies
 * that report into nothing — AGL-1788 (`report-to` silently suppressing
 * `report-uri`) and AGL-1799 (reports retained ~60 minutes and discarded). A
 * policy that cannot be satisfied and cannot be read is the AGL-1228 shape.
 *
 * ## What IS here, and why each is safe on this origin
 *
 * - `object-src 'none'` — docs embeds no plugins; this is free.
 * - `base-uri 'self'` — nothing rewrites the base tag; also free.
 * - `frame-ancestors 'self'` — VERIFIED before setting: docs is LINKED from
 *   the console's help system and cited by assist, never iframed. It does not
 *   restrict docs framing others (that is `frame-src`), so YouTube-style
 *   embeds inside a docs page are unaffected.
 * - `nosniff` — a docs site serves user-recognisable downloads; MIME sniffing
 *   on those is exactly the shape AGL-1474 exploited on the console.
 * - HSTS gains `includeSubDomains`. Note this is a TIGHTENING, not a hole
 *   being closed: `aglyn.com` already sends `includeSubDomains`, which covers
 *   this host for any browser that has visited the apex.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface HeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

const config = JSON.parse(
  readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8'),
) as { headers?: HeaderRule[] }

/** The rule that applies to every path. */
const siteWide = (config.headers ?? []).find((rule) => rule.source === '/(.*)')
const valueOf = (key: string) =>
  siteWide?.headers.find(
    (header) => header.key.toLowerCase() === key.toLowerCase(),
  )?.value ?? ''

describe('docs security headers (AGL-1152)', () => {
  it('applies a rule to EVERY path, not just one page', () => {
    // The pre-existing rule was scoped to `/status` alone. A security header
    // that covers one route is the shape that reads as covered and is not.
    expect(siteWide).toBeDefined()
  })

  it('sends a CSP with the three directives that are free on this origin', () => {
    const csp = valueOf('Content-Security-Policy')
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain('frame-ancestors')
  })

  it('sends nosniff and a referrer policy', () => {
    expect(valueOf('X-Content-Type-Options')).toBe('nosniff')
    expect(valueOf('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('HSTS covers subdomains', () => {
    const hsts = valueOf('Strict-Transport-Security')
    expect(hsts).toMatch(/max-age=\d+/)
    expect(hsts).toContain('includeSubDomains')
  })

  it('⛔ ships NO script-src until the inline hashes are computed at build time', () => {
    // The guard that matters most here, and the one a future change is most
    // likely to trip: adding `script-src` WITHOUT hashing the five inline
    // scripts means adding `'unsafe-inline'`, which is protection-shaped and
    // stops nothing. If you are here because you added a real hashed
    // `script-src`, update this to assert the hashes — do not delete it.
    const csp = valueOf('Content-Security-Policy')
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })
})
