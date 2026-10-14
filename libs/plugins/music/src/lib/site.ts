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
import { mdiMusic } from '@aglyn/shared-data-mdi'
import * as MusicPlayer from './components/music-player'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The Music player plugin (AGL-3716): the Music player element and its Track
 * rows, which play the site owner's own audio from the media library.
 */
export const MUSIC_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: MusicPlayer.default,
    schema: MusicPlayer.schema,
    presets: MusicPlayer.presets,
  },
  {
    component: MusicPlayer.MusicTrack,
    schema: MusicPlayer.trackSchema,
  },
]

export function registerMusicPlugin(): void {
  // The canvas half, and the only half: this runs on every published page
  // that places a player, so it registers nothing a console would load.
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Music player',
        description: 'Play your own tracks from the media library',
        icon: { path: mdiMusic.path },
        components: MUSIC_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
