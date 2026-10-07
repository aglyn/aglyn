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

import type { FontEmbedding } from '../font-file/read-font-file'

/**
 * A font's embedding license (OS/2 `fsType`) in plain words (AGL-3656), for
 * the installer's verdict and for the route's refusal, so the two cannot say
 * different things about the same bits.
 */

export interface FontLicenseWords {
  /** One short label for a chip. */
  label: string
  /** What the bits mean, and what the installer does about them. */
  detail: string
  tone: 'success' | 'warning' | 'error'
}

export function describeFontLicense(embedding: FontEmbedding, noSubsetting = false): FontLicenseWords {
  const whole = noSubsetting
    ? ' Its license asks for it to be embedded whole, so it is converted but not trimmed to your scripts.'
    : ''
  switch (embedding) {
    case 'installable':
      return {
        label: 'Embedding allowed',
        detail: `The font's license bits allow it to be embedded in a web page.${whole}`,
        tone: 'success',
      }
    case 'editable':
      return {
        label: 'Embedding allowed',
        detail: `The font's license bits allow it to be embedded in documents people can edit, which covers a web page.${whole}`,
        tone: 'success',
      }
    case 'preview-print':
      return {
        label: 'Check the license',
        detail:
          "The font's license bits allow embedding for viewing and printing only. Many such licenses still " +
          `exclude websites, so make sure yours includes web use before you publish with it.${whole}`,
        tone: 'warning',
      }
    case 'restricted':
      return {
        label: 'Embedding not allowed',
        detail:
          "The font's maker has marked it as not embeddable (restricted license), so it cannot be used on a " +
          'website. Ask the maker for a web license or a web font version.',
        tone: 'error',
      }
    case 'bitmap-only':
      return {
        label: 'Embedding not allowed',
        detail:
          "The font's license allows only bitmap copies to be embedded, and a website needs the outlines. " +
          'Ask the maker for a web font version.',
        tone: 'error',
      }
  }
}
