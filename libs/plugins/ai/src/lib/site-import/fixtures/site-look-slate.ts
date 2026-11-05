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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A home page drawn the way the 11/4 Keep my site evidence was (AGL-4152), in
 * plain markup of no builder's (`site-look/slate-home.html`): a dark slate
 * hero and a second slate band, a near-black closing band, light cyan filled
 * buttons set in capitals under dark words, and a hero heading held to 12 em
 * inside a 1200 px column. Its stylesheet says its dark scheme, under a media
 * query and a class on the root (AGL-4152). What the reader keeps of it, and the theme Keep my
 * site draws from that, is held by `site-import-layout.spec.ts` and
 * `ai-site-import-look.spec.ts`.
 */

export const SITE_LOOK_SLATE_URL = 'https://www.slate-studio.example/'

export const SITE_LOOK_SLATE_HTML = readFileSync(join(__dirname, 'site-look', 'slate-home.html'), 'utf8')
