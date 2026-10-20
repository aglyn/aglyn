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
 * Pins how a film's `video` node is read off the film band (AGL-3998).
 *
 *   node --test tools/scripts/lib/marketing-film.test.mjs
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { filmVideoProps } from './marketing-film.mjs'

/** The band's video node as it is stored on aglyn.com. */
const BAND = {
  heading: { $id: 'heading', componentId: 'muiTypography', props: { children: '{{prop.headline}}' } },
  video: {
    $id: 'video',
    componentId: 'video',
    props: {
      title: '{{prop.videoTitle}}',
      poster: '{{prop.posterImage}}',
      src: '{{prop.videoSource}}',
      description: '{{prop.videoDescription}}',
      uploadDate: '{{prop.publicationDate}}',
      durationSeconds: '{{prop.duration}}',
    },
  },
}
const VALUES = {
  headline: 'Edit your website like you mean it',
  videoTitle: 'Edit your website like you mean it',
  posterImage: 'media:org:org/poster',
  videoSource: 'https://aglyn.wistia.com/medias/abc',
  videoDescription: 'Move sections and preview every screen size.',
  publicationDate: '2026-10-06',
  duration: 44,
}

test('fills each binding of the band’s video from the instance', () => {
  assert.deepEqual(filmVideoProps(BAND, VALUES), {
    props: {
      title: 'Edit your website like you mean it',
      poster: 'media:org:org/poster',
      src: 'https://aglyn.wistia.com/medias/abc',
      description: 'Move sections and preview every screen size.',
      uploadDate: '2026-10-06',
      durationSeconds: 44,
    },
  })
})

test('keeps a prop the band sets outright', () => {
  const band = { video: { ...BAND.video, props: { ...BAND.video.props, loadPlayer: false } } }
  assert.equal(filmVideoProps(band, VALUES).props.loadPlayer, false)
})

test('refuses an instance that leaves a bound value empty', () => {
  const { videoSource: _src, ...rest } = VALUES
  assert.match(filmVideoProps(BAND, rest).problem, /"videoSource" empty/)
  assert.match(filmVideoProps(BAND, { ...VALUES, videoSource: '' }).problem, /"videoSource" empty/)
})

test('refuses a band without exactly one video node', () => {
  assert.match(filmVideoProps({ heading: BAND.heading }, VALUES).problem, /0 video nodes/)
  assert.match(filmVideoProps({ ...BAND, second: { ...BAND.video, $id: 'second' } }, VALUES).problem, /2 video nodes/)
})
