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
 * The docs site's copy of the consent-default snippet cannot drift
 * (AGL-1597).
 *
 * `apps/docs` is a Docusaurus app in its own Vercel project and cannot import
 * from `libs/` (AGL-1595), so the declaration is duplicated there. The same
 * treatment as the internal-traffic snippet next door (AGL-2064), and here
 * the stakes are higher than a mis-stamped parameter: this copy is the ONLY
 * thing standing between an EEA visitor and an unrestricted analytics tag. A
 * stale copy runs without error, declares *a* consent state, and looks
 * exactly like a working one.
 *
 * The specific drift this is aimed at: someone edits the EU country set in
 * `visitor-consent.ts` — an accession, a code change — the shared constant
 * updates itself by derivation, and the docs copy silently does not.
 *
 * PLANTED RED (verified): delete `"CH"` from the docs copy's region array.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  PLATFORM_CONSENT_DEFAULT_SNIPPET,
  PLATFORM_PRIOR_CONSENT_REGIONS,
} from '@aglyn/aglyn/app-utils/platform-consent-default'

const DOCS_CONFIG = resolve(__dirname, '../../docs/docusaurus.config.ts')

describe('the docs consent-default snippet (AGL-1597)', () => {
  const source = readFileSync(DOCS_CONFIG, 'utf8')

  it('is character-for-character the shared constant', () => {
    expect(source).toContain(PLATFORM_CONSENT_DEFAULT_SNIPPET)
  })

  it('is queued INTO the head snippet that defines gtag', () => {
    // In a headTag of its own it would throw on an undefined `gtag` and take
    // the whole declaration with it.
    const head = source.slice(source.indexOf('headTags:'))
    const shim = head.indexOf('function gtag(){dataLayer.push(arguments);}')
    const consent = head.indexOf(PLATFORM_CONSENT_DEFAULT_SNIPPET)
    expect(shim).toBeGreaterThan(-1)
    expect(consent).toBeGreaterThan(shim)
  })

  it('is declared BEFORE the `set` calls that follow it', () => {
    // Ordering is the mechanism. A consent default queued after `config` is
    // not a default; queueing it ahead of everything else is the only reason
    // this works at all.
    const head = source.slice(source.indexOf('headTags:'))
    const consent = head.indexOf(PLATFORM_CONSENT_DEFAULT_SNIPPET)
    const contentGroup = head.indexOf("gtag('set',{'content_group':'docs'});")
    expect(contentGroup).toBeGreaterThan(-1)
    expect(consent).toBeLessThan(contentGroup)
  })

  it('still carries content_group, which it must not have displaced', () => {
    expect(source).toContain("gtag('set',{'content_group':'docs'});")
  })

  it('names every prior-consent region in the docs copy itself', () => {
    // Reads the FILE, not the constant, so a hand-edited copy that dropped a
    // country fails here even if the concatenation still parses.
    const head = source.slice(source.indexOf('headTags:'))
    for (const code of PLATFORM_PRIOR_CONSENT_REGIONS) {
      expect(head).toContain(`"${code}"`)
    }
  })
})
