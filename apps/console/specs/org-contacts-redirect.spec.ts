/**
 * @jest-environment node
 *
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
 * THE OLD ADDRESS BOOK REDIRECTS INTO THE ORG-LEVEL CRM (AGL-2630).
 *
 * `/[orgSlug]/contacts` was a read-only, cross-site address book. It is now
 * the contacts section of the organization-level CRM hub, and a kept link is
 * sent there — PERMANENTLY, so a browser corrects the bookmark rather than
 * following the hop on every visit, and to the SECTION rather than the bare
 * hub, which would only redirect again.
 *
 * The rule is the CRM's (`consoleRedirects` in plugins.config.json), read
 * from the compiled manifest `next.config.js` spreads into its `redirects()`
 * rather than by loading the config, which runs the build's asset sync. It
 * is asserted through Next's own matcher: what has to hold is where each
 * real URL lands, and that a site's addresses, which differ in their second
 * segment, do not move.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination'

const CONFIG = readFileSync(join(__dirname, '..', 'next.config.js'), 'utf8')
const MANIFEST = 'plugins.redirects.generated.json'
const RULES = JSON.parse(
  readFileSync(join(__dirname, '..', 'constants', MANIFEST), 'utf8'),
) as Array<{ pluginId: string; source: string; destination: string; permanent: boolean }>
const SOURCE = '/:orgSlug/contacts'

/** Where Next sends `path` under the declared rule, or `null` if it does not match. */
function landing(path: string): string | null {
  const rule = RULES.find((one) => one.source === SOURCE)
  const params = getPathMatch(SOURCE, { removeUnnamedParams: true, strict: true })(path)
  if (!rule || !params) return null
  return prepareDestination({
    appendParamsToQuery: false,
    destination: rule.destination,
    params,
    query: {},
  }).newUrl
}

describe('/[orgSlug]/contacts', () => {
  it('CONTROL: the CRM declares the rule, and the config serves the manifest', () => {
    expect(CONFIG).toContain(`require('./constants/${MANIFEST}')`)
    expect(RULES.find((one) => one.source === SOURCE)?.pluginId).toBe('crm')
  })

  it('is PERMANENT — a temporary redirect would be followed on every visit', () => {
    expect(RULES.find((one) => one.source === SOURCE)?.permanent).toBe(true)
  })

  it("sends a kept link to the org CRM hub's contacts section", () => {
    expect(landing('/test-org/contacts')).toBe('/test-org/crm/contacts')
  })

  it('carries the org of the address, not a remembered one', () => {
    expect(landing('/northwind-coffee/contacts')).toBe('/northwind-coffee/crm/contacts')
  })

  it("leaves a site's CRM, the hub itself and deeper paths alone", () => {
    expect(landing('/test-org/hosts/shop/contacts')).toBeNull()
    expect(landing('/test-org/crm/contacts')).toBeNull()
    expect(landing('/test-org/contacts/c-1')).toBeNull()
  })
})
