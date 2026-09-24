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

import {
  CANVAS_ROOT_ELEMENT_ID,
  components,
  createResourceUid,
  EMAIL_VIEW_BUNDLE_ID,
  nestedToDefinition,
  REUSABLE_COMPONENT_KIND_EMAIL,
  REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS,
  type ReusableComponentKind,
  type ReusableEmailBlockStarter,
} from '@aglyn/aglyn'
import { consolePluginLoader } from '../constants/console-plugin-loader'

/** What the Components page's create drawer asks. */
export interface ComponentCreateChoice {
  /** Where it will be used: `site` (on pages) or `email` (in emails). */
  kind?: unknown
  /** For an email block, what it starts as: a header, a footer, or blank. */
  starter?: unknown
}

/** The fields a new component is created with, beside its name. */
export interface ComponentCreateSeed {
  /** Present only for an email block; a page component sends none. */
  kind?: ReusableComponentKind
  rootId: string
  nodes: Record<string, unknown>
}

/**
 * The empty canvas every new component has opened on — a root node, because
 * an empty `{}` renders as "Invalid node" in the besigner (AGL-693).
 */
function blankTree(): Omit<ComponentCreateSeed, 'kind'> {
  return {
    rootId: CANVAS_ROOT_ELEMENT_ID,
    nodes: {
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'div',
        nodes: [],
      },
    },
  }
}

/**
 * What a new reusable component is created holding (AGL-3287): where it is
 * placed, and the tree it starts from.
 *
 * A page component starts blank, as every component always has. An email
 * block starts as the email plugin's Header or Footer, or blank. The starter
 * trees are read from the element presets the plugin registers — the same
 * ones an author drops into an email — so a Header block and a dropped Header
 * are one tree; this page only has to load the plugin's canvas half first,
 * which it would not otherwise need.
 *
 * Throws when a starter cannot be found, rather than quietly creating a blank
 * block the author did not ask for.
 */
export async function componentCreateSeed(
  choice: ComponentCreateChoice,
): Promise<ComponentCreateSeed> {
  if (choice?.kind !== REUSABLE_COMPONENT_KIND_EMAIL) return blankTree()
  const starter: ReusableEmailBlockStarter =
    choice.starter === 'header' || choice.starter === 'footer'
      ? choice.starter
      : 'blank'
  if (starter === 'blank') {
    return { kind: REUSABLE_COMPONENT_KIND_EMAIL, ...blankTree() }
  }
  await consolePluginLoader.ensure([EMAIL_VIEW_BUNDLE_ID], ['site'])
  const preset = components.getPreset(
    REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS[starter],
  )
  if (!preset?.data) {
    throw new Error(
      `The ${starter} could not be loaded. Try again, or start from Blank.`,
    )
  }
  return {
    kind: REUSABLE_COMPONENT_KIND_EMAIL,
    ...nestedToDefinition(preset.data as never, createResourceUid),
  }
}

export default componentCreateSeed
