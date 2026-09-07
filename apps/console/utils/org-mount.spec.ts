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

import { resolveOrgMount } from './org-mount'

/**
 * The one builder both org-level mounts share (AGL-2636). What it pins is
 * how a site READS off the mount — a plugin surface names sites by this and
 * links into them by this, and the two pages that build a mount must agree
 * or a person is one name on the hub and another on the sites page.
 */
describe('resolveOrgMount', () => {
  const hosts = [
    { $id: 'h-1', displayName: 'Demo Bakery', subdomain: 'demo' },
    // No display name: the subdomain stands in.
    { $id: 'h-2', subdomain: 'second' },
    // Nothing the list could name it by: the id, and no link.
    { $id: 'h-3' },
    // A field of the wrong shape is no field at all — the list is a raw
    // document, and a stray value must not become a site's name.
    { $id: 'h-4', displayName: 42, subdomain: { bad: true } },
  ]

  it('names each site by display name, then subdomain, then id, and links only what has a subdomain', () => {
    const mount = resolveOrgMount({
      orgId: 'org-1',
      orgSlug: 'acme',
      hosts,
      hostsReady: true,
    })
    expect(mount).toEqual({
      orgId: 'org-1',
      hosts: [
        { id: 'h-1', name: 'Demo Bakery', subdomain: 'demo' },
        { id: 'h-2', name: 'second', subdomain: 'second' },
        { id: 'h-3', name: 'h-3', subdomain: null },
        { id: 'h-4', name: 'h-4', subdomain: null },
      ],
      hostsReady: true,
      hostsPath: '/acme/hosts',
    })
  })

  it('carries the list\'s readiness through, so a consumer can hold on it', () => {
    const mount = resolveOrgMount({
      orgId: 'org-1',
      orgSlug: 'acme',
      hosts: [],
      hostsReady: false,
    })
    expect(mount?.hostsReady).toBe(false)
    expect(mount?.hosts).toEqual([])
  })

  it('is no mount at all until the workspace has resolved', () => {
    expect(
      resolveOrgMount({ orgId: undefined, orgSlug: 'acme', hosts, hostsReady: true }),
    ).toBeUndefined()
  })
})
