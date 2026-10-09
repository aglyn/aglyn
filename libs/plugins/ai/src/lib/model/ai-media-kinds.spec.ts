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
 * The kinds of picture Media's Create with AI offers (AGL-3602): one kind
 * per style the door accepts, each in the mode the door runs that style in,
 * with a shape the dialog can offer, and with style wording on the server
 * for every image-provider kind but the plain Photo.
 */

import { AI_IMAGE_ASPECT_RATIOS, AI_RASTER_STYLES, AI_SVG_STYLES } from '../providers/image-contract'
import { AI_MEDIA_RASTER_STYLE_WORDING, aiMediaRasterPrompt } from '../server/ai-media-raster-prompt'
import { AI_MEDIA_KIND_IDS, AI_MEDIA_KINDS, aiMediaKind, aiMediaKindsOffered } from './ai-media-kinds'

describe('the kinds', () => {
  it('has exactly one kind for every style the door accepts', () => {
    expect(AI_MEDIA_KINDS.map((kind) => kind.id).sort()).toEqual([...AI_MEDIA_KIND_IDS].sort())
    expect(new Set(AI_MEDIA_KINDS.map((kind) => kind.id)).size).toBe(AI_MEDIA_KINDS.length)
  })

  it('runs the SVG styles as illustrations and every other style on the image provider', () => {
    for (const style of AI_SVG_STYLES) expect(aiMediaKind(style)).toMatchObject({ mode: 'illustration', group: 'vector' })
    for (const style of AI_RASTER_STYLES) expect(aiMediaKind(style)?.mode).toBe('photo')
  })

  it('offers a shape the dialog has, and colors only where they are sent', () => {
    for (const kind of AI_MEDIA_KINDS) {
      expect(AI_IMAGE_ASPECT_RATIOS).toContain(kind.aspectRatio)
      // Only an SVG carries a palette; the image provider receives the
      // description and the shape, as its published row says.
      expect([kind.id, kind.colors === 'palette']).toEqual([kind.id, kind.mode === 'illustration'])
    }
    expect(aiMediaKind('banner')?.aspectRatio).toBe('16:9')
    expect(aiMediaKind('social')?.aspectRatio).toBe('1:1')
    expect(aiMediaKind('food')?.colors).toBe('none')
    expect(aiMediaKind('watercolor')?.colors).toBe('describe')
  })

  it('offers the image-provider kinds only where the deployment makes them', () => {
    expect(aiMediaKindsOffered(false).map((kind) => kind.id)).toEqual([...AI_SVG_STYLES])
    expect(aiMediaKindsOffered(true)).toHaveLength(AI_SVG_STYLES.length + AI_RASTER_STYLES.length)
  })
})

describe('the style wording', () => {
  it('sends a Photo exactly as described, and every other kind with its wording after the description', () => {
    expect(aiMediaRasterPrompt('a red barn', 'photo')).toBe('a red barn')
    for (const style of AI_RASTER_STYLES.filter((entry) => entry !== 'photo')) {
      const wording = AI_MEDIA_RASTER_STYLE_WORDING[style]
      expect([style, wording.startsWith('Style: ')]).toEqual([style, true])
      expect(aiMediaRasterPrompt('a red barn', style)).toBe(`a red barn\n\n${wording}`)
    }
  })

  it('asks for made-up people and original characters, never real ones', () => {
    expect(AI_MEDIA_RASTER_STYLE_WORDING.lifestyle).toMatch(/fictional and must not resemble any real or famous person/)
    expect(AI_MEDIA_RASTER_STYLE_WORDING.cartoon).toMatch(/Never a character from an existing/)
  })
})
