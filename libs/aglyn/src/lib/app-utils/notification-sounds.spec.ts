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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_NOTIFICATION_SOUND, NOTIFICATION_SOUNDS, notificationSound } from './notification-sounds'

const ROOT = join(__dirname, '../../../../..')

describe('notification sounds', () => {
  it('lists the default first, with unique ids', () => {
    expect(NOTIFICATION_SOUNDS[0].id).toBe(DEFAULT_NOTIFICATION_SOUND)
    expect(new Set(NOTIFICATION_SOUNDS.map((entry) => entry.id)).size).toBe(NOTIFICATION_SOUNDS.length)
  })

  it('reads an unknown or missing pick as the default', () => {
    expect(notificationSound(undefined).id).toBe(DEFAULT_NOTIFICATION_SOUND)
    expect(notificationSound('retired-sound').id).toBe(DEFAULT_NOTIFICATION_SOUND)
    expect(notificationSound('cowbell').label).toBe('Cowbell')
  })

  it('names Android resources Android accepts', () => {
    for (const entry of NOTIFICATION_SOUNDS) expect(entry.android).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('has every file the list names, on every platform', () => {
    for (const entry of NOTIFICATION_SOUNDS) {
      expect(existsSync(join(ROOT, 'apps/console/public', entry.web))).toBe(true)
      expect(existsSync(join(ROOT, 'apps/ios/Shared/Sounds', entry.apple))).toBe(true)
      expect(existsSync(join(ROOT, 'apps/android/app/src/main/res/raw', `${entry.android}.wav`))).toBe(true)
    }
  })

  it('is the list the generator writes', () => {
    const generator = readFileSync(join(ROOT, 'tools/notification-sounds/generate.py'), 'utf8')
    const ids = [...generator.matchAll(/^ {4}'([a-z_]+)': [a-z_]+,$/gm)].map((match) => match[1])
    expect(ids.sort()).toEqual(NOTIFICATION_SOUNDS.map((entry) => entry.id).sort())
  })
})
