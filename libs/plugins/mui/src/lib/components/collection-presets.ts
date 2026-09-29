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

import * as Aglyn from '@aglyn/aglyn'
import {
  mdiAccountCircleOutline,
  mdiMagnify,
  mdiNewspaperVariantOutline,
  mdiPostOutline,
  mdiShareVariant,
  mdiTagMultipleOutline,
  mdiTagOutline,
  mdiTextLong,
} from '@aglyn/shared-data-mdi'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Every collection element's id, read from @aglyn/aglyn rather than imported
// from the element modules: importing them would put all nine elements into
// the chunk of the one element these presets register with.
const ENTRIES_ID = Aglyn.COLLECTION_ENTRIES_COMPONENT_ID
const ENTRY_BODY_ID = Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID
const RELATED_ID = Aglyn.COLLECTION_RELATED_COMPONENT_ID
const SHARE_ID = Aglyn.COLLECTION_SHARE_COMPONENT_ID
const ENTRY_META_ID = Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID
const ENTRY_AUTHOR_ID = Aglyn.COLLECTION_ENTRY_AUTHOR_COMPONENT_ID
const CATEGORIES_ID = Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID
const SEARCH_ID = Aglyn.COLLECTION_SEARCH_COMPONENT_ID
const AUTHOR_PROFILE_ID = Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID

/**
 * The collection family's palette presets. Registered with Collection
 * Entries (`presets: 'collectionPresets'` in plugin.ts), which re-exports
 * them; they name every collection element by id only, so none of those
 * elements' code comes with them.
 */

/**
 * Styling rides the node's own `sx`, never `props.sx` (AGL-1346): both
 * render, but only `node.sx` is the record the Styles panel can edit or
 * clear. `Leaf` composes `node.sx` last, so this is the same result.
 */
const entryText = (variant: string, children: string, extra?: object) => {
  const { sx, ...props } = (extra ?? {}) as Record<string, unknown>
  return {
    $id: null,
    componentId: 'muiTypography',
    pluginId: BUNDLE_ID,
    props: { variant, children, ...props },
    ...(sx ? { sx } : {}),
  }
}

export const collectionPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ENTRIES_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Collection Entries',
    pluginId: BUNDLE_ID,
    description:
      'Repeats a card (title, date, excerpt, Read more) per published ' +
      'entry of a content collection',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiPostOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRIES_ID,
      pluginId: BUNDLE_ID,
      props: { spacing: 4 },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { spacing: 0.5 },
          nodes: [
            entryText('h5', '{{entry.title}}', { component: 'h2' }),
            entryText('caption', '{{entry.date}}', {
              sx: { color: 'text.secondary' },
            }),
            entryText('body1', '{{entry.excerpt}}'),
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: BUNDLE_ID,
              props: {
                children: 'Read more',
                href: '{{entry.url}}',
                size: 'small',
              },
              sx: { alignSelf: 'flex-start' },
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId(ENTRY_BODY_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Body',
    pluginId: BUNDLE_ID,
    description: "Renders the current entry's markdown body, themed",
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRY_BODY_ID,
      pluginId: BUNDLE_ID,
      props: { markdown: '{{entry.body}}' },
    },
  },
  {
    $id: generatePresetId(RELATED_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Related Posts',
    pluginId: BUNDLE_ID,
    description:
      "Other entries sharing the current entry's category or tags",
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: RELATED_ID,
      pluginId: BUNDLE_ID,
      // `layout`, the two type steps and `dateFormat` are seeded rather than
      // left to the runtime fallback so each dropdown opens on the value the
      // block is actually rendering, and an author who tries another has a
      // named route back (AGL-1457/AGL-1459). The `show*` switches are
      // deliberately absent: their unset state IS the shipped behaviour.
      props: {
        heading: 'Related articles',
        limit: 3,
        layout: 'list',
        headingVariant: 'h5',
        titleVariant: 'subtitle1',
        dateFormat: Aglyn.COLLECTION_ENTRY_DATE_FORMAT_DEFAULT,
      },
    },
  },
  {
    $id: generatePresetId(SHARE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Share Bar',
    pluginId: BUNDLE_ID,
    description: 'X, LinkedIn, Facebook, and copy-link buttons for the page',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: SHARE_ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Share' },
    },
  },
  {
    $id: generatePresetId(CATEGORIES_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Category Pills',
    pluginId: BUNDLE_ID,
    description:
      "Links to each of the collection's categories, filtering the listing",
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTagMultipleOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: CATEGORIES_ID,
      pluginId: BUNDLE_ID,
      // Seeded, not left to the runtime default: an explicit initial value
      // is what lets the attributes form substitute the cleared sentinel
      // when the author empties the box (AGL-1336).
      props: { allLabel: Aglyn.COLLECTION_ALL_PILL_DEFAULT },
    },
  },
  {
    // Every author-placeable component needs a preset: the element drawer is
    // built from PRESETS alone (`ComponentManager.schemasByCategory` iterates
    // `this.presets`), so a component with only a schema renders correctly
    // once a node exists but can never be put on a canvas by clicking.
    //
    // This one earns its place in the drawer because the entries block's own
    // search field cannot leave that block, and the toolbar row wants the
    // search beside the category pills rather than above the entries.
    $id: generatePresetId(SEARCH_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Collection Search',
    pluginId: BUNDLE_ID,
    description:
      'Search box for a collection, with a dropdown of matching entries',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiMagnify.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: SEARCH_ID,
      pluginId: BUNDLE_ID,
      // Deliberately no seeded props. Both attributes read blank as a real
      // choice — `collectionSlug` blank means "take the collection from the
      // URL", which is correct on the list templates this block is for, and
      // `searchPlaceholder` blank means the designed "Search posts…".
      props: {},
    },
  },
  {
    $id: generatePresetId(ENTRY_META_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Meta',
    pluginId: BUNDLE_ID,
    description: 'Author · date · category line with tag chips for the entry',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: 'secondary.main' } },
    data: {
      $id: null,
      componentId: ENTRY_META_ID,
      pluginId: BUNDLE_ID,
      props: {
        date: '{{entry.date}}',
        // Named rather than left to the runtime fallback (AGL-1459): the
        // dropdown opens on the value the block is actually rendering, and
        // an author who tries a format has a named route back. `default` is
        // also the fallback, so naming it is the same choice, not a second.
        dateFormat: Aglyn.COLLECTION_ENTRY_DATE_FORMAT_DEFAULT,
        author: '{{entry.author}}',
        category: '{{entry.category}}',
        tags: '{{entry.tags}}',
      },
    },
  },
  {
    $id: generatePresetId(ENTRY_AUTHOR_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Author',
    pluginId: BUNDLE_ID,
    description: 'Portrait, byline and bio card for the entry’s author',
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      path: mdiAccountCircleOutline.path,
      sx: { color: 'secondary.main' },
    },
    data: {
      $id: null,
      componentId: ENTRY_AUTHOR_ID,
      pluginId: BUNDLE_ID,
      // Seeded EMPTY, unlike Entry Meta's preset. Those bindings predate the
      // server fill and stay for compatibility; here the fill is the only
      // mechanism, and a seeded `{{entry.authorImage}}` would render a broken
      // portrait on every surface that is not an entry template.
      props: {},
    },
  },
  {
    $id: generatePresetId(AUTHOR_PROFILE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Author Profile',
    pluginId: BUNDLE_ID,
    description: 'Portrait, name, role, bio and links for an author page',
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      path: mdiAccountCircleOutline.path,
      sx: { color: 'secondary.main' },
    },
    data: {
      $id: null,
      componentId: AUTHOR_PROFILE_ID,
      pluginId: BUNDLE_ID,
      // Seeded EMPTY, for the reason the card above it is: the server fill is
      // the only mechanism here, and a seeded `{{author.image}}` would render
      // a broken portrait on every surface that is not an author page.
      props: {},
    },
  },
]
