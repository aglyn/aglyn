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

import type { AiUsage } from '../providers/contract'
import {
  AI_IMAGE_DEFAULT_MODEL,
  AI_MODEL_CATALOG,
  estimateAiBilledUsd,
} from '../providers/catalog'
import type { AiImageMode, AiImageSize } from '../providers/image-contract'
import { assistCreditsFromUsd } from '../usage/assist-credits'

/**
 * What one picture in Media is expected to draw (AGL-3602), in credits: the
 * estimate the dialog shows before anything is spent, and the figure the
 * door holds a walled band to. Browser-safe, so both read the same number.
 *
 * Each is an ESTIMATE at nominal usage, priced at the billed rates:
 *
 * - a photo is one picture at its per-picture rate for the size the plan
 *   makes (512 px on Free, 1K on a paid plan), plus a prompt and the
 *   thinking Google's model does before it draws;
 * - an illustration is the text provider's answer — the instructions, the
 *   description, and a few thousand tokens of SVG.
 *
 * What is actually charged is what was spent, measured: a picture held back
 * or not stored is never charged, and an illustration that needed its second
 * attempt costs about twice its estimate.
 */

/** A photo's nominal tokens beside its picture. */
export const AI_MEDIA_PHOTO_NOMINAL_USAGE: AiUsage & { images: number } = {
  inputTokens: 600,
  outputTokens: 1_500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  images: 1,
}

/**
 * An illustration's nominal tokens: about 2,100 of instructions — under the
 * fast tier's caching minimum, so read at full rate every time — the tool and
 * the description, and a few thousand of SVG.
 */
export const AI_MEDIA_SVG_NOMINAL_USAGE: AiUsage = {
  inputTokens: 2_500,
  outputTokens: 3_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/**
 * The model an illustration is estimated at where the server's choice is
 * not known: the catalog's first fast-tier row, which is what the default
 * text provider serves illustrations on.
 */
export const AI_MEDIA_SVG_ESTIMATE_MODEL =
  AI_MODEL_CATALOG.find((entry) => entry.tier === 'fast')?.id ?? AI_MODEL_CATALOG[0].id

/**
 * The credits one picture is expected to draw in `mode`, on `model`, at
 * `size` for a photo (1K when absent; an illustration has no size).
 */
export function aiMediaCreditsPerPicture(
  mode: AiImageMode,
  model?: string,
  size?: AiImageSize,
): number {
  return mode === 'photo'
    ? assistCreditsFromUsd(
        estimateAiBilledUsd(
          { ...AI_MEDIA_PHOTO_NOMINAL_USAGE, ...(size ? { imageSize: size } : {}) },
          model ?? AI_IMAGE_DEFAULT_MODEL,
        ),
      )
    : assistCreditsFromUsd(estimateAiBilledUsd(AI_MEDIA_SVG_NOMINAL_USAGE, model ?? AI_MEDIA_SVG_ESTIMATE_MODEL))
}
