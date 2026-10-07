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

/*==========================================
 * PHONE OR TABLET (AGL-3618).
 *
 * One rule for both apps: a window at least 768 points wide on its shorter
 * side is a tablet, and gets a sidebar and side-by-side panes; anything
 * narrower is a phone, and gets stacks. The SHORTER side, so an iPad keeps
 * its tablet layout when rotated and a large phone in landscape stays a
 * phone. Pure, so a spec can drive every size.
 *=========================================*/

export type FormFactor = 'phone' | 'tablet'

export interface MobileLayout {
  formFactor: FormFactor
  orientation: 'portrait' | 'landscape'
  width: number
  height: number
  /** Show two panes side by side (a list and its detail, a register and its cart). */
  split: boolean
}

export const TABLET_MIN_SHORT_SIDE = 768

export function layoutFor(width: number, height: number): MobileLayout {
  const shortSide = Math.min(width, height)
  const formFactor: FormFactor = shortSide >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone'
  const orientation = width > height ? 'landscape' : 'portrait'
  return {
    formFactor,
    orientation,
    width,
    height,
    // A tablet splits in both orientations; a phone never does, because a
    // 390-point pane beside another one is two unusable screens.
    split: formFactor === 'tablet' && width >= TABLET_MIN_SHORT_SIDE,
  }
}
