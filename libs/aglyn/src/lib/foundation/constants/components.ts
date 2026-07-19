/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export enum ComponentCategory {
  /**
   * Composed, ready-made section presets (hero, nav bar, footer, …) —
   * the "Section & block library" (AGL-538). Multi-node subtrees with
   * sensible defaults, as opposed to single primitive elements.
   */
  BLOCKS = 'Sections & Blocks',
  INPUT = 'Input',
  /** Data-capture elements: forms, fields, search (AGL-541). */
  FORMS = 'Forms',
  /** Visual content: images, video, icons (AGL-541). */
  MEDIA = 'Media',
  /** Store widgets: products, cart, checkout companions (AGL-541). */
  COMMERCE = 'Commerce',
  SURFACE = 'Surface',
  NAVIGATION = 'Navigation',
  LAYOUT = 'Layout',
  DATA_DISPLAY = 'Data Display',
  TEXT = 'Text',
  UNCATEGORIZED = 'Uncategorized',
  ALL = 'All',
}

/**
 * Display rank of the element drawer/picker categories (AGL-538). Lower
 * ranks first; categories not listed here (plugin-registered strings like
 * "Community" or the per-host "Your components") sort after the ranked
 * ones alphabetically, and Uncategorized/All always sink to the bottom.
 */
export const COMPONENT_CATEGORY_ORDER: readonly string[] = [
  ComponentCategory.BLOCKS,
  ComponentCategory.LAYOUT,
  ComponentCategory.NAVIGATION,
  ComponentCategory.TEXT,
  ComponentCategory.FORMS,
  ComponentCategory.INPUT,
  ComponentCategory.MEDIA,
  ComponentCategory.DATA_DISPLAY,
  ComponentCategory.COMMERCE,
  ComponentCategory.SURFACE,
]
