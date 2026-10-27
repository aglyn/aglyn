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

import { waiverSiteOrigin, waiverSiteSignUrl } from './waiver-share'

/**
 * Where a waiver's share link and QR code open (AGL-4042): the store's own
 * site — its custom domain while it serves, else its platform address — and
 * never the console.
 */
describe('the store’s signing page', () => {
  it('opens on the custom domain while it serves, else on the platform address', () => {
    expect(waiverSiteOrigin({ cname: 'rides.example.com', subdomain: 'acme' })).toBe('https://rides.example.com')
    expect(waiverSiteOrigin({ cname: 'rides.example.com', cnameAttachmentPending: true, subdomain: 'acme' })).toBe(
      'https://acme.aglyn.app',
    )
    expect(waiverSiteOrigin({ cname: 'rides.example.com', cnameDetachmentPending: true, subdomain: 'acme' })).toBe(
      'https://acme.aglyn.app',
    )
    expect(waiverSiteOrigin({ subdomain: 'acme' })).toBe('https://acme.aglyn.app')
    expect(waiverSiteOrigin({})).toBeNull()
    expect(waiverSiteOrigin({ subdomain: 'not a name' })).toBeNull()
  })

  it('names the waiver in the link, or opens the list', () => {
    expect(waiverSiteSignUrl('https://rides.example.com', 'w1')).toBe('https://rides.example.com/sign-waiver?waiver=w1')
    expect(waiverSiteSignUrl('https://acme.aglyn.app/', null)).toBe('https://acme.aglyn.app/sign-waiver')
  })
})
