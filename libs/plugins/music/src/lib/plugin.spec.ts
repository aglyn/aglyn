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

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { MUSIC_BUNDLE, registerMusicPlugin } from './plugin'

describe('music plugin (AGL-3716)', () => {
  it('keeps the persisted component ids', () => {
    // The ids are stored in screen documents — never rename.
    expect(MUSIC_BUNDLE.map((entry) => entry.schema.$id)).toEqual([
      'musicPlayer',
      'musicTrack',
    ])
    expect(BUNDLE_ID).toBe('music')
  })

  it('declares the player as the one container, and it renders its tracks (AGL-1389)', () => {
    expect(Aglyn.auditChildContract(MUSIC_BUNDLE, ['musicPlayer'])).toEqual([])
    expect(
      Aglyn.auditComposeChildSurvival(Aglyn.listAcceptingComponentIds(MUSIC_BUNDLE)),
    ).toEqual([])
  })

  it('registers a mui-dependent bundle once, and no console surface', () => {
    registerMusicPlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [Aglyn.MUI_BUNDLE_ID]: true })
    expect(
      Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID),
    ).toBeUndefined()
    registerMusicPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })
})
