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
 * Overlay copy as a visitor reads it (AGL-2887).
 *
 * The published page renders a bar's text and a popup's headline and body
 * exactly as the server hands them over, so whatever this function leaves in
 * the copy is what the visitor sees.
 */

import type { HostVariable } from '@aglyn/aglyn/app-utils/variables'
import { resolveOverlayCopy } from './overlay-copy'

const VARIABLES: Record<string, HostVariable> = {
  'var-sale': { name: 'saleEndsAt', type: 'text', value: 'Sunday at midnight' },
}
const SITE = {
  displayName: 'Northwind Coffee',
  subdomain: 'northwind',
}

describe('resolveOverlayCopy (AGL-2887)', () => {
  it('fills a site variable in by its id', () => {
    expect(
      resolveOverlayCopy('Sale ends {{var:var-sale}}', VARIABLES, SITE),
    ).toBe('Sale ends Sunday at midnight')
  })

  it("fills the site's own details in", () => {
    expect(
      resolveOverlayCopy('Welcome to {{host.businessName}}', VARIABLES, SITE),
    ).toBe('Welcome to Northwind Coffee')
  })

  it('renders a detail the site has not set as nothing, never the token', () => {
    expect(
      resolveOverlayCopy('Questions? {{host.supportEmail}}', VARIABLES, SITE),
    ).toBe('Questions? ')
  })

  it('renders a variable whose document is gone as nothing', () => {
    expect(resolveOverlayCopy('Ends {{var:deleted}}.', VARIABLES, SITE)).toBe(
      'Ends .',
    )
  })

  it('resolves variables before details, as a page does', () => {
    // A variable whose value names the site still reads as the site.
    const variables: Record<string, HostVariable> = {
      'var-tagline': {
        name: 'tagline',
        type: 'text',
        value: '{{host.businessName}} roasts on Fridays',
      },
    }
    expect(resolveOverlayCopy('{{var:var-tagline}}', variables, SITE)).toBe(
      'Northwind Coffee roasts on Fridays',
    )
  })

  it('leaves a bare {{name}} as typed, because nothing resolves that form', () => {
    expect(resolveOverlayCopy('Ends {{saleEndsAt}}', VARIABLES, SITE)).toBe(
      'Ends {{saleEndsAt}}',
    )
  })

  it('returns plain copy untouched', () => {
    expect(resolveOverlayCopy('Free shipping this week', {}, SITE)).toBe(
      'Free shipping this week',
    )
  })
})
