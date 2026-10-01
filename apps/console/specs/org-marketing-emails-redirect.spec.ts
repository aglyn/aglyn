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
 *
 * @jest-environment node
 */

/**
 * The organization's messages left its Marketing hub (AGL-3300).
 *
 * `/[orgSlug]/marketing/emails/…` was the org hub's Emails section — the
 * list, one message's report, its editor — and those URLs are in bookmarks
 * and pasted links. The messages now live on the organization's own Emails
 * page, beside a site's, so the old addresses redirect there.
 *
 * Asserted through Next's own matcher rather than by reading the pattern:
 * what has to hold is where each real URL LANDS, and the one URL that must
 * not move at all is the site hub's, whose path differs from the org's only
 * in its second segment.
 *
 * The rule is the email plugin's (`consoleRedirects` in plugins.config.json),
 * read from the compiled manifest `next.config.js` spreads into its
 * `redirects()` rather than by loading the config, which runs the build's
 * asset sync.
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
const SOURCE = '/:orgSlug/marketing/emails/:path*'

/** The rule declared for `SOURCE`, as the manifest carries it. */
function declaredRule(): { destination: string; permanent: boolean } {
  const rule = RULES.find((one) => one.source === SOURCE)
  return {
    destination: rule?.destination ?? '',
    permanent: rule?.permanent === true,
  }
}

/** Where Next sends `path` under the declared rule, or `null` if it does not match. */
function landing(path: string): string | null {
  const params = getPathMatch(SOURCE, {
    removeUnnamedParams: true,
    strict: true,
  })(path)
  if (!params) return null
  return prepareDestination({
    appendParamsToQuery: false,
    destination: declaredRule().destination,
    params,
    query: {},
  }).newUrl
}

describe('the org Marketing hub’s old Emails section', () => {
  it('CONTROL: the rule is declared, and permanent', () => {
    expect(CONFIG).toContain(`require('./constants/${MANIFEST}')`)
    expect(RULES.find((one) => one.source === SOURCE)?.pluginId).toBe('email')
    expect(declaredRule()).toEqual({
      destination: '/:orgSlug/emails/messages/:path*',
      permanent: true,
    })
  })

  it('sends the list, one message and its editor to the org’s Emails page', () => {
    expect(landing('/acme/marketing/emails')).toBe('/acme/emails/messages')
    expect(landing('/acme/marketing/emails/send_1')).toBe(
      '/acme/emails/messages/send_1',
    )
    expect(landing('/acme/marketing/emails/send_1/edit')).toBe(
      '/acme/emails/messages/send_1/edit',
    )
  })

  it('leaves every site hub alone, and the org hub’s other sections', () => {
    expect(landing('/acme/hosts/shop/marketing/emails')).toBeNull()
    expect(landing('/acme/hosts/shop/marketing/emails/send_1')).toBeNull()
    expect(landing('/acme/marketing/campaigns')).toBeNull()
    expect(landing('/acme/marketing/overview')).toBeNull()
    expect(landing('/acme/marketing')).toBeNull()
  })
})
