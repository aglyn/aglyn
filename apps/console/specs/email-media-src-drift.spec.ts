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

import { hostPublicOrigin, resolveMediaSrc } from '@aglyn/aglyn'
import {
  hostEmailOrigin,
  resolveEmailMediaSrc,
} from '@aglyn/shared-util-email'

/**
 * Drift guard (AGL-1224), the same device AGL-765 used for
 * `EMAIL_NODE_ROOT_ID` one file over.
 *
 * `libs/shared/util/email/src/lib/email-media-src.ts` carries a COPY of
 * `resolveMediaSrc` and `hostPublicOrigin`. It has to: `shared-util-email` is
 * tagged `scope:shared`, and the module-boundary rule makes shared libs
 * leaves, so it cannot import `@aglyn/aglyn` — the arrow points the other way
 * so every send site can pull the email renderer without the framework.
 *
 * This spec lives in the console because the console may import BOTH, and it
 * runs the two implementations over one table of inputs. A divergence here
 * means a picked image silently stops resolving in delivered mail while the
 * besigner canvas keeps showing it — the exact shape of the original bug,
 * which is why this is table-driven rather than a couple of spot checks.
 */
describe('email media resolution does not drift from @aglyn/aglyn', () => {
  const HOST_IDS = [
    undefined,
    'h1',
    'host_2',
    'not a segment',
    '',
    'h'.repeat(65),
  ]

  const STORED = [
    // References, every scope form.
    'media:h1/med123',
    'media:org:o1/med123',
    'media:org:o1:h2/med123',
    'media:HOST-9_x/MED-9_x',
    // Malformed references must resolve to undefined, not reach an <img src>.
    'media:',
    'media:/med123',
    'media:h1/',
    'media:h1',
    'media:bad scope/med123',
    'media:h1/bad id',
    'media:org:/med123',
    'media:org:o1:h2:extra/med123',
    'media:h1/med/extra',
    // The segment LENGTH bound, both sides of it. Without these a mirror that
    // widened {1,64} agreed with the authority on every other input — the
    // drift this table missed on its first pass.
    `media:h1/${'m'.repeat(64)}`,
    `media:h1/${'m'.repeat(65)}`,
    `media:${'h'.repeat(65)}/med123`,
    `media:org:${'o'.repeat(65)}/med123`,
    // Everything else passes through untouched.
    '/api/media/cdn/h1/med123',
    'https://firebasestorage.googleapis.com/v0/b/x/o/y.png?alt=media',
    'https://cdn.other.test/x.png',
    '//cdn.other.test/x.png',
    '{{var:aB3xK9m2Qw}}',
    '',
  ]

  it.each(STORED)('resolves %p identically for every host id', (stored) => {
    for (const hostId of HOST_IDS) {
      expect(resolveEmailMediaSrc(stored, hostId)).toBe(
        resolveMediaSrc(stored, { hostId }),
      )
    }
  })

  it('agrees on absent values', () => {
    expect(resolveEmailMediaSrc(undefined)).toBe(resolveMediaSrc(undefined))
    expect(resolveEmailMediaSrc(null)).toBe(resolveMediaSrc(null))
  })

  const HOSTS = [
    { cname: 'shop.acme.com', subdomain: 'acme' },
    { cname: null, subdomain: 'acme' },
    { subdomain: 'acme' },
    { cname: 'shop.acme.com' },
    // Neither: there is no origin, and both must say so rather than guess.
    {},
    { cname: null, subdomain: null },
    { cname: '', subdomain: '' },
  ]

  it.each(HOSTS)('derives the origin of %p identically', (host) => {
    expect(hostEmailOrigin(host)).toBe(hostPublicOrigin(host))
  })

  it('agrees on an absent host', () => {
    expect(hostEmailOrigin(undefined)).toBe(hostPublicOrigin(undefined))
    expect(hostEmailOrigin(null)).toBe(hostPublicOrigin(null))
  })

  /**
   * The mirror could agree with the authority by both being broken — two
   * copies of `() => undefined` pass every assertion above. So pin the actual
   * contract too: these are the outputs the CDN route and the tenant apex
   * genuinely serve.
   */
  it('pins what the pair actually produces, not just that they match', () => {
    expect(resolveEmailMediaSrc('media:org:o1/med123', 'h2')).toBe(
      '/api/media/cdn/org:o1:h2/med123',
    )
    expect(resolveEmailMediaSrc('media:h1/med123')).toBe(
      '/api/media/cdn/h1/med123',
    )
    expect(resolveEmailMediaSrc('media:h1/bad id')).toBeUndefined()
    expect(hostEmailOrigin({ subdomain: 'acme' })).toBe(
      'https://acme.aglyn.app',
    )
    expect(hostEmailOrigin({ cname: 'shop.acme.com', subdomain: 'acme' })).toBe(
      'https://shop.acme.com',
    )
  })

  /**
   * The half that was NOT mirrored (AGL-2195).
   *
   * `hostPublicOrigin` has read `NEXT_PUBLIC_TENANT_DOMAIN` since AGL-2022;
   * the email copy wrote `aglyn.app` in flat. Every table above agreed
   * anyway, because every one of them runs with the variable unset — where
   * the configured value and the hard-coded literal are the same string. A
   * drift guard that only ever exercises the default cannot see a missing
   * default, which is how a self-hosted deployment came to mail absolute
   * links on Aglyn's apex while this file stayed green.
   *
   * Both modules read the variable at MODULE scope, so the only way to
   * observe the configured branch is to set it and re-require them. That is
   * what `isolateModules` is for; `resetModules` afterwards puts the shared
   * registry back for whatever runs next.
   */
  it('both follow a configured tenant apex, not only the default', () => {
    const previous = process.env.NEXT_PUBLIC_TENANT_DOMAIN
    process.env.NEXT_PUBLIC_TENANT_DOMAIN = 'sites.example.com'
    try {
      jest.isolateModules(() => {
        const email = require('@aglyn/shared-util-email')
        const framework = require('@aglyn/aglyn')
        const host = { subdomain: 'acme' }
        expect(email.hostEmailOrigin(host)).toBe(
          'https://acme.sites.example.com',
        )
        expect(email.hostEmailOrigin(host)).toBe(
          framework.hostPublicOrigin(host),
        )
        // A custom domain still wins over the configured apex, in both.
        const custom = { cname: 'shop.acme.com', subdomain: 'acme' }
        expect(email.hostEmailOrigin(custom)).toBe('https://shop.acme.com')
        expect(email.hostEmailOrigin(custom)).toBe(
          framework.hostPublicOrigin(custom),
        )
      })
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
      else process.env.NEXT_PUBLIC_TENANT_DOMAIN = previous
      jest.resetModules()
    }
  })
})
