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

import type { AiRasterStyle } from '../providers/image-contract'

/**
 * The style wording each image-provider kind adds to a description
 * (AGL-3602). The person's description comes first, so it decides what is
 * in the picture; the wording after it decides how the picture is made — a
 * photograph's lens, light and composition, an art style's medium and
 * strokes, a design asset's layout.
 *
 * It is fixed text of ours and carries nothing of the workspace: what reaches
 * the image provider is still the description and the shape, as the
 * published subprocessor row says.
 *
 * `photo` adds nothing: its description is sent exactly as written, as it
 * was before the other kinds existed.
 */
export const AI_MEDIA_RASTER_STYLE_WORDING: Readonly<Record<AiRasterStyle, string>> = {
  photo: '',
  natural:
    'Style: a natural, candid photograph. Realistic colors and textures, soft available light, shot on a full-frame camera with a 35mm lens at a wide aperture for a shallow depth of field, an unposed, true-to-life composition.',
  product:
    'Style: a professional studio product photograph. The product is the hero, centered on a clean seamless backdrop, lit with soft diffused key and fill lights and a gentle contact shadow, tack-sharp focus on every detail, shot with a 100mm macro lens, commercial catalog quality. No other objects unless the description names them.',
  lifestyle:
    'Style: an editorial lifestyle photograph with people using or enjoying the subject in a real setting. Natural expressions and relaxed poses, warm natural light, 50mm lens, shallow depth of field, authentic rather than staged. The people are fictional and must not resemble any real or famous person.',
  architecture:
    'Style: an architectural photograph. Straight vertical lines and balanced two-point perspective, a 24mm tilt-shift lens, natural daylight with soft shadows, a clean uncluttered composition, true-to-life materials and textures.',
  food:
    'Style: a food photograph. Fresh, appetizing and carefully plated, soft directional window light from the side, shallow depth of field with an 85mm lens, rich true colors, a few tasteful props on a textured surface.',
  aerial:
    'Style: an aerial or wide landscape photograph, taken from a drone high above or as a sweeping vista. Wide-angle lens, golden-hour light, deep focus from the foreground to the horizon, vivid but natural colors.',
  'render-3d':
    'Style: a polished 3D render. Smooth stylized shapes, soft global illumination with ambient occlusion, subtle reflections, a clean studio background, high detail.',
  watercolor:
    'Style: a watercolor painting. Soft transparent washes of pigment, visible cold-press paper texture, gentle bleeding edges, loose expressive brushwork, light and airy.',
  'oil-painting':
    'Style: an oil painting on canvas. Rich layered color, visible impasto brushstrokes, painterly light and shadow, a classical, balanced composition.',
  'flat-art':
    'Style: flat vector-style artwork. Clean geometric shapes, solid color fills with no gradients or texture, crisp edges, a limited harmonious palette, a modern editorial illustration look.',
  'line-drawing':
    'Style: a line drawing. Clean, confident ink lines on a plain white background, minimal or no shading, elegant and uncluttered.',
  cartoon:
    'Style: a cartoon or anime-style illustration. Bold outlines, expressive original characters, vibrant cel-shaded colors, playful and friendly. Never a character from an existing film, show, comic or game.',
  background:
    'Style: a background texture or backdrop for a website. Subtle and low in contrast, evenly balanced across the whole frame with no focal subject, no text or lettering, so words can sit on top of it.',
  banner:
    'Style: a wide website banner or hero image. A strong focal subject placed to one side with generous, calm negative space on the other for a headline, no text or lettering in the image, a polished commercial look.',
  social:
    'Style: a social media post graphic. A bold, eye-catching composition with one clear focal point centered with balanced margins, vibrant colors, and no text or lettering unless the description asks for it.',
  mockup:
    'Style: a realistic product mockup. The described design is shown on a device screen or on packaging, photographed in a clean studio or lifestyle setting with accurate perspective, soft lighting and natural reflections.',
}

/** The prompt one picture is asked for: the description, then the kind's style wording. */
export function aiMediaRasterPrompt(description: string, style: AiRasterStyle): string {
  const wording = AI_MEDIA_RASTER_STYLE_WORDING[style]
  return wording ? `${description}\n\n${wording}` : description
}
