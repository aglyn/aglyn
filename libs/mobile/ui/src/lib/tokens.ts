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
 * The theme tokens (AGL-3620): the console's resolved palette, compiled to
 * `tokens.generated.json` by `tools/scripts/generate-mobile-theme-tokens.mjs`.
 * JSON rather than a module so `app.config.ts` (splash and icon grounds)
 * reads the same values outside Metro.
 */

import generated from './tokens.generated.json'

export const MOBILE_THEME_TOKENS = generated

export type MobileColorScheme = 'light' | 'dark'
export type MobilePalette = (typeof generated)['light']
