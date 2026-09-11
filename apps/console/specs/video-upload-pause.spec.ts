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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { code } from './source-text'

/**
 * Video ingress is paused behind one release flag (AGL-2830).
 *
 * The route specs prove each door refuses a video and still takes an image
 * and a document. This file holds what none of them can see:
 *
 * - **The gate itself.** Which flag, which org, which content types, and that
 *   a non-video never waits on a Remote Config read.
 * - **The flag fails shut**, in the registry and in the seeded template.
 * - **No ingress was missed.** A door is found by what makes it one: it runs
 *   `inspectUploadBytes` over caller bytes (AGL-1475). A new route that
 *   inspects bytes and forgets the pause fails here rather than shipping.
 * - **The library reads the same flag** and stops offering video.
 */

const mockFlag: { open: boolean; calls: Array<[string, unknown]> } = {
  open: false,
  calls: [],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: async (key: string, orgId: unknown) => {
    mockFlag.calls.push([key, orgId])
    return mockFlag.open
  },
}))

import {
  getReleaseFlagDefinition,
  parseReleaseFlagValue,
} from '@aglyn/aglyn/app-utils/release-flags'
import { UPLOAD_TYPES } from '../utils/media-upload-limits'
import {
  videoUploadPausedRefusal,
  videoUploadsOpenForOrg,
} from '../utils/server/video-uploads'

const REPO_ROOT = join(__dirname, '..', '..', '..')

const VIDEO_TYPES = UPLOAD_TYPES.filter((spec) =>
  spec.contentType.startsWith('video/'),
).map((spec) => spec.contentType)

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

beforeEach(() => {
  mockFlag.open = false
  mockFlag.calls = []
})

describe('the gate (AGL-2830)', () => {
  it('has video types to gate, so the cases below are not over nothing', () => {
    expect(VIDEO_TYPES.length).toBeGreaterThanOrEqual(3)
  })

  it.each(VIDEO_TYPES)('refuses %s while the flag is closed', async (contentType) => {
    const refusal = await videoUploadPausedRefusal({ contentType, orgId: 'org-1' })
    expect(refusal?.status).toBe(403)
    expect(refusal?.headers.get('cache-control')).toBe('no-store')
    expect(await refusal?.json()).toEqual({
      error: expect.stringMatching(/^Video uploads are paused\./),
      code: 'video_uploads_paused',
    })
  })

  it('asks release_video_uploads, for the org it was handed', async () => {
    await videoUploadPausedRefusal({ contentType: 'video/mp4', orgId: 'org-7' })
    expect(mockFlag.calls).toEqual([['release_video_uploads', 'org-7']])
  })

  it('lets a video through once the flag is on for the org', async () => {
    mockFlag.open = true
    expect(
      await videoUploadPausedRefusal({ contentType: 'video/webm', orgId: 'org-1' }),
    ).toBeNull()
    expect(await videoUploadsOpenForOrg('org-1')).toBe(true)
  })

  it.each(['image/png', 'image/svg+xml', 'application/pdf', 'application/zip', 'text/csv'])(
    'never reads the flag for %s, and never refuses it',
    async (contentType) => {
      expect(
        await videoUploadPausedRefusal({ contentType, orgId: 'org-1' }),
      ).toBeNull()
      expect(mockFlag.calls).toEqual([])
    },
  )
})

describe('the flag fails shut (AGL-2830)', () => {
  it('is OFF in the registry, so an unreachable Remote Config refuses video', () => {
    expect(getReleaseFlagDefinition('release_video_uploads').defaultEnabled).toBe(
      false,
    )
  })

  it('is seeded OFF in the Remote Config template', () => {
    const template = JSON.parse(read('cloud/firebase-remoteconfig.template.json'))
    const raw = template.parameters?.release_video_uploads?.defaultValue?.value
    expect(typeof raw).toBe('string')
    // `true` as the fallback, so an unparseable seed cannot pass as OFF.
    expect(parseReleaseFlagValue(raw, true).enabled).toBe(false)
  })
})

/** Directory names a source walk never enters. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
])

/** Every non-spec TypeScript source file under `dir`, repo-relative. */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(REPO_ROOT, dir))) {
    if (entry.startsWith('.') || SKIPPED_DIRECTORIES.has(entry)) continue
    const path = `${dir}/${entry}`
    if (statSync(join(REPO_ROOT, path)).isDirectory()) {
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

/**
 * Files that call `inspectUploadBytes` and cannot store a video, each with the
 * text that proves it. The proof is asserted, so an exemption outlives its
 * reason only by failing.
 */
const CANNOT_STORE_VIDEO: Record<string, { why: string; proof: string }> = {
  'libs/aglyn/src/lib/app-utils/upload-inspection.ts': {
    why: 'the inspector itself, which stores nothing',
    proof: 'export function inspectUploadBytes',
  },
  'libs/plugins/marketplace/src/lib/server/preview-image.ts': {
    why: 'a listing preview image, whose allowlist is image formats only',
    proof: 'isImageUploadContentType(contentType)',
  },
}

const GATE_CALLS = ['videoUploadPausedRefusal(', 'videoUploadsOpenForOrg(']

describe('every ingress asks the video flag (AGL-2830)', () => {
  const ingresses = [...sourceFiles('apps'), ...sourceFiles('libs')].filter(
    (path) => read(path).includes('inspectUploadBytes('),
  )
  const body = (path: string) => code(read(path), path)

  it('finds the four media ingresses, so the sweep below covers something', () => {
    expect(ingresses).toEqual(
      expect.arrayContaining([
        'apps/console/app/api/media/upload/route.ts',
        'apps/console/app/api/media/upload-url/route.ts',
        'apps/console/app/api/media/replace/route.ts',
        'apps/console/utils/api-v1-resources.ts',
      ]),
    )
  })

  it('has every ingress ask the flag, or prove it cannot store a video', () => {
    for (const path of ingresses) {
      const exempt = CANNOT_STORE_VIDEO[path]
      if (exempt) {
        expect([path, read(path).includes(exempt.proof)]).toEqual([path, true])
        continue
      }
      expect([path, GATE_CALLS.some((call) => body(path).includes(call))]).toEqual(
        [path, true],
      )
    }
  })

  it('keeps every exemption pointed at a file that still inspects bytes', () => {
    for (const path of Object.keys(CANNOT_STORE_VIDEO)) {
      expect([path, ingresses.includes(path)]).toEqual([path, true])
    }
  })

  it('refuses a direct upload before the body is decoded or stored', () => {
    const text = body('apps/console/app/api/media/upload/route.ts')
    const gate = text.indexOf('videoUploadPausedRefusal(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(text.indexOf("Buffer.from(data, 'base64')"))
    expect(gate).toBeLessThan(text.indexOf('file.save('))
  })

  it('refuses a signed upload at the mint AND at finalize', () => {
    const text = body('apps/console/app/api/media/upload-url/route.ts')
    const first = text.indexOf('videoUploadPausedRefusal(')
    const last = text.lastIndexOf('videoUploadPausedRefusal(')
    // The mint: before any URL exists.
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(text.indexOf('getSignedUrl('))
    // Finalize: after the object's real type is read, before its bytes are.
    expect(last).toBeGreaterThan(text.indexOf('file.getMetadata()'))
    expect(last).toBeLessThan(text.indexOf('storedObjectSha256('))
  })

  it('refuses a replace on all three legs, through the one refusal helper', () => {
    const text = body('apps/console/app/api/media/replace/route.ts')
    expect(text.indexOf('videoUploadPausedRefusal(')).toBeGreaterThan(
      text.indexOf('async function replacementRefusal('),
    )
    expect(text.match(/replacementRefusal\(\{/g) ?? []).toHaveLength(3)
    expect(text.match(/await replacementRefusal\(\{/g) ?? []).toHaveLength(3)
  })

  it('refuses a /v1 upload above the idempotency claim', () => {
    const text = body('apps/console/utils/api-v1-resources.ts')
    const create = text.indexOf('async function createMedia(')
    const gate = text.indexOf('videoUploadsOpenForOrg(', create)
    expect(gate).toBeGreaterThan(create)
    expect(gate).toBeLessThan(text.indexOf('claimWrite(', create))
    expect(gate).toBeLessThan(text.indexOf("Buffer.from(raw, 'base64')", create))
  })
})

describe('the library stops offering video (AGL-2830)', () => {
  const component = code(
    readFileSync(
      join(__dirname, '..', 'components', 'media', 'media-library.component.tsx'),
      'utf8',
    ),
    'media-library.component.tsx',
  )

  it('reads the flag the routes read, without the staff preview they refuse', () => {
    expect(component).toContain('useReleaseFlag(VIDEO_UPLOADS_RELEASE_FLAG)')
    expect(component).toContain('videoUploadsFlag.released')
    expect(component).not.toContain('videoUploadsFlag.visible')
  })

  it('derives every chooser from the flag', () => {
    expect(component).toContain('uploadAcceptAttribute({ video: videoUploadsOpen })')
    expect(component.match(/accept=\{uploadAccept\}/g) ?? []).toHaveLength(2)
    expect(component).toMatch(
      /uploadAcceptForKind\([\s\S]{0,240}\{ video: videoUploadsOpen \}/,
    )
  })

  it('refuses a dropped video before it uploads', () => {
    const gate = component.indexOf(
      'isVideoUploadType(contentType) && !videoUploadsOpen',
    )
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(component.indexOf("'/api/media/upload-url'"))
  })

  it('refuses a video replace before either chooser opens, and before it uploads', () => {
    expect(component).toContain("kind === 'video' && !videoUploadsOpen")
    // Defined once, asked by the card's chooser and by the drawer's button.
    expect(component.match(/replaceIsPaused\(/g) ?? []).toHaveLength(2)
  })

  it('says the pause out loud once the flag has answered', () => {
    expect(component).toMatch(
      /videoUploadsFlag\.ready && !videoUploadsOpen[\s\S]{0,240}Video uploads paused/,
    )
  })
})
