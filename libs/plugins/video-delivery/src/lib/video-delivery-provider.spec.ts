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

import { verifyDeliveryToken } from './delivery-token'
import { createFakeR2Endpoint } from './testing/fake-r2-endpoint'
import {
  createVideoDeliveryProvider,
  type VideoDeliverySettings,
  videoDeliveryConfigured,
  videoDeliveryOrigin,
  videoDeliverySettingsFromEnv,
} from './video-delivery-provider'

/**
 * The R2 + Worker adapter behind core's delivery contract (AGL-2824): which
 * settings each capability needs, what a delivery URL looks like, and that a
 * copy lands in the bucket the settings name.
 */

const NOW = Date.parse('2026-09-18T12:00:00.000Z')

const SETTINGS: VideoDeliverySettings = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-access-key',
  bucket: 'aglyn-video',
  deliveryHost: 'video.example.workers.dev',
  deliverySecret: 'a'.repeat(64),
}

const KEY = 'orgs/org-acme/med-film/0123456789abcdef/master/0123456789abcdef'

describe('the video delivery provider (AGL-2824)', () => {
  it('needs the R2 settings to store and the host and secret to deliver', () => {
    expect(videoDeliveryConfigured(SETTINGS, 'store')).toBe(true)
    expect(videoDeliveryConfigured(SETTINGS, 'deliver')).toBe(true)
    // The tenant app holds no R2 key pair and still mints.
    const tenant = { ...SETTINGS, accessKeyId: '', secretAccessKey: '' }
    expect(videoDeliveryConfigured(tenant, 'store')).toBe(false)
    expect(videoDeliveryConfigured(tenant, 'deliver')).toBe(true)
    // A placeholder secret is no secret.
    expect(videoDeliveryConfigured({ ...SETTINGS, deliverySecret: 'changeme' }, 'deliver')).toBe(
      false,
    )
    expect(videoDeliveryConfigured({ ...SETTINGS, deliveryHost: '' }, 'deliver')).toBe(false)
  })

  it('reads its settings from the environment names the owner set', () => {
    const saved = { ...process.env }
    try {
      process.env['R2_ACCOUNT_ID'] = SETTINGS.accountId
      process.env['R2_ACCESS_KEY_ID'] = SETTINGS.accessKeyId
      process.env['R2_SECRET_ACCESS_KEY'] = SETTINGS.secretAccessKey
      process.env['R2_VIDEO_BUCKET'] = SETTINGS.bucket
      process.env['MEDIA_VIDEO_DELIVERY_HOST'] = ` ${SETTINGS.deliveryHost} `
      process.env['MEDIA_VIDEO_DELIVERY_SECRET'] = SETTINGS.deliverySecret
      expect(videoDeliverySettingsFromEnv()).toEqual(SETTINGS)
    } finally {
      process.env = saved
    }
  })

  it('is unconfigured for both capabilities with no settings at all', () => {
    const provider = createVideoDeliveryProvider({
      settings: () => ({
        accountId: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucket: '',
        deliveryHost: '',
        deliverySecret: '',
      }),
    })
    expect(provider.isConfigured('store')).toBe(false)
    expect(provider.isConfigured('deliver')).toBe(false)
  })

  it('mints a URL on the delivery host whose token the Worker accepts for that key only', async () => {
    const provider = createVideoDeliveryProvider({ settings: () => SETTINGS, now: () => NOW })
    const url = new URL(
      await provider.deliveryUrl({
        key: KEY,
        expiresAtMs: NOW + 15 * 60 * 1000,
        claims: { scope: 'org:org-acme:host-1', mediaId: 'med-film', orgId: 'org-acme', hostId: 'host-1' },
      }),
    )
    expect(url.origin).toBe('https://video.example.workers.dev')
    expect(url.pathname).toBe(`/${KEY}`)
    const verdict = await verifyDeliveryToken(url.searchParams.get('token'), SETTINGS.deliverySecret, {
      key: KEY,
      nowMs: NOW,
    })
    expect(verdict).toEqual({
      ok: true,
      claims: {
        key: KEY,
        expiresAtMs: NOW + 15 * 60 * 1000,
        orgId: 'org-acme',
        hostId: 'host-1',
        mediaId: 'med-film',
        scope: 'org:org-acme:host-1',
      },
    })
  })

  it('refuses to mint without its settings, rather than minting a URL nothing verifies', async () => {
    const provider = createVideoDeliveryProvider({
      settings: () => ({ ...SETTINGS, deliverySecret: '' }),
      now: () => NOW,
    })
    await expect(
      provider.deliveryUrl({
        key: KEY,
        expiresAtMs: NOW + 60_000,
        claims: { scope: 'x', mediaId: 'y', orgId: null, hostId: null },
      }),
    ).rejects.toThrow(/not configured/)
  })

  it('copies into, and removes from, the bucket its settings name', async () => {
    const endpoint = createFakeR2Endpoint({ ...SETTINGS })
    const provider = createVideoDeliveryProvider({
      settings: () => SETTINGS,
      fetch: endpoint.fetch,
      now: () => NOW,
    })
    await provider.putObject({
      key: KEY,
      body: new TextEncoder().encode('FILM'),
      contentLength: 4,
      contentType: 'video/mp4',
    })
    expect(endpoint.objects.has(KEY)).toBe(true)
    expect(await provider.deleteObjectsWithPrefix('orgs/org-acme/med-film/')).toBe(1)
    expect(endpoint.objects.size).toBe(0)
    await provider.deleteObject(KEY)
  })

  it('accepts a bare host or a local origin, and refuses anything else', () => {
    expect(videoDeliveryOrigin('video.example.workers.dev')).toBe(
      'https://video.example.workers.dev',
    )
    expect(videoDeliveryOrigin('https://video.example.workers.dev')).toBe(
      'https://video.example.workers.dev',
    )
    expect(videoDeliveryOrigin('http://localhost:8787')).toBe('http://localhost:8787')
    for (const refused of [
      'http://video.example.workers.dev',
      'https://video.example.workers.dev/path',
      'https://user:pass@video.example.workers.dev',
      'https://video.example.workers.dev?x=1',
      'video.example.workers.dev/path',
      'ftp://video.example.workers.dev',
      '',
    ]) {
      expect([refused, videoDeliveryOrigin(refused)]).toEqual([refused, null])
    }
  })
})

/**
 * Published pages refuse a redirect whose target their `media-src` does not
 * name, so the tenant policy admits the delivery origin — read from the same
 * `MEDIA_VIDEO_DELIVERY_HOST`, by `mediaDeliveryOrigin` in the repo-root
 * `security-origins.js`. That file is CommonJS the tenant middleware requires
 * and cannot import this package, so it carries its own copy of the rules
 * above. These hold the two copies to the same answer for every shape of
 * setting: a copy that admitted less would blank a delivered video, and one
 * that admitted more would widen the policy for an origin nothing mints on.
 */
describe('the published-page media policy names the origin URLs are minted on', () => {
  const { mediaDeliveryOrigin } =
    // Repo-root CommonJS outside the nx graph, as the tenant specs read it.
    // eslint-disable-next-line @nx/enforce-module-boundaries
    require('../../../../../security-origins.js') as {
      mediaDeliveryOrigin: (raw?: string) => string | undefined
    }

  it.each([
    'video.example.workers.dev',
    'Video.Example.Workers.Dev',
    'video.example.workers.dev:8443',
    '  video.example.workers.dev  ',
    'https://video.example.workers.dev',
    'https://video.example.workers.dev/',
    'https://video.example.workers.dev:443',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://video.example.workers.dev',
    'https://video.example.workers.dev/path',
    'https://user:pass@video.example.workers.dev',
    'https://video.example.workers.dev?x=1',
    'https://video.example.workers.dev#top',
    'video.example.workers.dev/path',
    'video.example.workers.dev; script-src *',
    '*.example.workers.dev',
    '-video.example.workers.dev',
    'ftp://video.example.workers.dev',
    'not a host',
    '',
  ])('%j', (setting) => {
    expect(mediaDeliveryOrigin(setting) ?? null).toBe(videoDeliveryOrigin(setting))
  })
})
