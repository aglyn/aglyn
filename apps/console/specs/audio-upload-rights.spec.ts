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
 * Audio in the media library, and the rights gate it passes (AGL-3716).
 *
 * The library takes MP3, M4A, AAC, OGG and WAV so a site can play its owner's
 * own music in the Music player. Every ingress route refuses an audio file
 * unless the request carries the uploader's rights confirmation, and stores
 * the answer on the asset with who gave it and when.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectUploadBytes } from '@aglyn/aglyn/app-utils/upload-inspection'
import { mediaKindOf } from '@aglyn/aglyn/app-utils/media-metadata'
import { MEDIA_TYPE_OPTIONS } from '@aglyn/aglyn/app-utils/media-filter'
import {
  AUDIO_RIGHTS_REQUIRED_CODE,
  AUDIO_RIGHTS_STATEMENT,
  audioRightsRefusal,
  audioRightsVerdict,
} from '../utils/media-audio-rights'
import {
  AUDIO_TYPES,
  isAllowedUploadType,
  mediaPickerKindOf,
  mediaUploadKind,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  signedUploadMaxBytes,
  uploadAcceptForPickerKind,
} from '../utils/media-upload-limits'
import { mediaFileTypeIcon } from '../utils/media-file-icon'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('audio is accepted, as its own family', () => {
  it.each(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav'])('%s', (type) => {
    expect(AUDIO_TYPES.has(type)).toBe(true)
    expect(isAllowedUploadType(type)).toBe(true)
    expect(mediaUploadKind(type)).toBe('audio')
    expect(mediaPickerKindOf(type)).toBe('audio')
    expect(mediaKindOf(type)).toBe('audio')
    expect(signedUploadMaxBytes(type)).toBeGreaterThan(0)
    // A file upload, like video and documents: the `videoMedia` tier.
    expect(requiresFileUploadEntitlement(type)).toBe(true)
  })

  it('folds the names browsers give audio to one stored type', () => {
    expect(normalizeUploadContentType('audio/mp3', 'a.mp3')).toBe('audio/mpeg')
    expect(normalizeUploadContentType('audio/x-m4a', 'a.m4a')).toBe('audio/mp4')
    expect(normalizeUploadContentType('audio/x-wav', 'a.wav')).toBe('audio/wav')
    expect(normalizeUploadContentType('', 'a.ogg')).toBe('audio/ogg')
  })

  it('narrows a picker to audio, and the library can filter to it', () => {
    const accept = uploadAcceptForPickerKind('audio')
    expect(accept).toContain('audio/mpeg')
    expect(accept).toContain('.mp3')
    expect(accept).not.toContain('image/')
    expect(MEDIA_TYPE_OPTIONS.map((option) => option.value)).toContain('audio')
    expect(mediaFileTypeIcon('audio/mpeg').label).toBe('MP3')
  })

  it('checks the bytes against the claimed audio type', () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0])
    expect(inspectUploadBytes({ bytes: id3, contentType: 'audio/mpeg' })).toBeNull()
    const ogg = new TextEncoder().encode('OggS....')
    expect(inspectUploadBytes({ bytes: ogg, contentType: 'audio/ogg' })).toBeNull()
    const pdf = new TextEncoder().encode('%PDF-1.7')
    expect(inspectUploadBytes({ bytes: pdf, contentType: 'audio/mpeg' })?.code).toBe('type_mismatch')
    const exe = new TextEncoder().encode('MZ......')
    expect(inspectUploadBytes({ bytes: exe, contentType: 'audio/wav' })).not.toBeNull()
  })
})

describe('the rights gate', () => {
  it('refuses audio without an explicit true', async () => {
    for (const confirmed of [undefined, false, 'true', 1]) {
      const verdict = audioRightsVerdict({ contentType: 'audio/mpeg', confirmed, uid: 'u1' })
      expect(verdict.refusal).not.toBeNull()
      if (!verdict.refusal) continue
      const response = audioRightsRefusal(verdict.refusal)
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe(AUDIO_RIGHTS_REQUIRED_CODE)
    }
  })

  it('stores who confirmed, when, and the sentence they confirmed', () => {
    expect(
      audioRightsVerdict({ contentType: 'audio/wav', confirmed: true, uid: 'u1', nowMs: 42 }),
    ).toEqual({
      refusal: null,
      fields: { rightsConfirmation: { uid: 'u1', atMs: 42, statement: AUDIO_RIGHTS_STATEMENT } },
    })
  })

  it('asks nothing of a file that is not audio', () => {
    expect(audioRightsVerdict({ contentType: 'image/png', confirmed: undefined, uid: 'u1' })).toEqual({
      refusal: null,
      fields: {},
    })
  })

  it.each([
    ['apps/console/app/api/media/upload/route.ts', 1],
    ['apps/console/app/api/media/upload-url/route.ts', 2],
    ['apps/console/app/api/media/replace/route.ts', 2],
    ['apps/console/utils/api-v1-resources.ts', 1],
  ])('every ingress route asks it: %s', (path, times) => {
    const source = read(path)
    expect(source.split('audioRightsVerdict(').length - 1).toBeGreaterThanOrEqual(times)
  })

  it('the routes that write a document store the answer', () => {
    expect(read('apps/console/app/api/media/upload/route.ts')).toContain('...rights.fields')
    expect(read('apps/console/app/api/media/upload-url/route.ts')).toContain('...rights.fields')
    expect(read('apps/console/utils/api-v1-resources.ts')).toContain('...rights.fields')
    expect(read('apps/console/app/api/media/replace/route.ts')).toContain('rightsConfirmation:')
  })

  it('the library asks the question before any audio leaves the browser', () => {
    const library = read('apps/console/components/media/media-library.component.tsx')
    expect(library).toContain('askAudioRights(audioNames)')
    expect(library).toContain('MediaAudioRightsDialog')
  })
})
