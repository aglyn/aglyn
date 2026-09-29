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
import { mdiMagnify } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { SuggestSearchBox, useEntryFuse } from './collection-search-box'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const SEARCH_ID: Aglyn.ComponentId = Aglyn.COLLECTION_SEARCH_COMPONENT_ID

export interface CollectionSearchProps extends StackProps {
  /**
   * Collection whose entries this box searches (compose-time). Blank = the
   * collection routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /** Hint text inside the box (blank = "Search posts…"). */
  searchPlaceholder?: string
  /**
   * Server-stamped matchable text per entry (`expandCollectionSearch`);
   * never set by hand.
   */
  searchIndex?: Aglyn.CollectionEntrySearchItem[]
  /** How many entries the index was drawn from; never set by hand. */
  searchTotal?: number
  /** Whether that read reached its bound; never set by hand. */
  searchCapped?: boolean
}

/**
 * A search box for a collection that lives where the author puts it
 * (AGL-1516, Figma 494:1220).
 *
 * The entries block has had a search box since AGL-1516's first half, and it
 * renders inside that block — first child of its own stack. The frame puts
 * the field in the listing's TOOLBAR: category pills on the left, search and
 * RSS on the right, one row. That was unbuildable, and unbuildable in both
 * directions — a block's own child cannot be lifted out of it, and the pills
 * cannot be moved in, because every child of an entries block is cloned once
 * per entry. Three passes of authoring hit the same wall.
 *
 * So the field became its own block. It searches the collection the listing
 * beside it is drawn from, and answers with the suggestion panel (496:1218)
 * — the only behaviour a standalone box can honestly have, since it owns no
 * cards to hide. Enter submits to the site-wide results page, so the box
 * works with no JavaScript at all.
 *
 * Inert on editing surfaces, like Category Pills: the besigner has no index
 * to search, and a field that answered there would be answering about
 * nothing.
 */
const CollectionSearch = forwardRef<HTMLDivElement, CollectionSearchProps>(
  (props, ref) => {
    // Compose-time and search-only attributes: strip so they never hit the
    // DOM.
    const {
      collectionSlug,
      searchPlaceholder,
      searchIndex,
      searchTotal,
      searchCapped,
      ...rest
    } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const { fuzzy, requestFuzzy } = useEntryFuse(searchIndex)
    if (!suppressNavigation && !searchIndex?.length) {
      // Nothing stamped on a live surface: an unknown collection, an empty
      // one, or a page composed before this block existed. Renders NOTHING
      // rather than a field that can only ever answer "no matches" — that
      // answer would read as a fact about the reader's query instead of
      // about the absent index behind it.
      return <Box ref={ref} {...rest} />
    }
    return (
      <MuiStack ref={ref} {...rest} sx={[{ alignItems: 'flex-end' }, ...nodeSx]}>
        <SuggestSearchBox
          fuzzy={fuzzy}
          requestFuzzy={requestFuzzy}
          {...(searchIndex ? { items: searchIndex } : {})}
          {...(searchPlaceholder === undefined
            ? {}
            : { placeholder: searchPlaceholder })}
          {...(suppressNavigation ? { inert: true } : {})}
          // The honest miss for THIS box. It searched one bounded read of the
          // collection — never "the collection", and on a category route not
          // even the whole of it, because the source arrives filtered. So it
          // reports the number it actually looked through, and says plainly
          // when that number was a ceiling rather than a total.
          emptyText={(text) =>
            searchCapped
              ? `No matches for “${text}” in the ${searchIndex?.length ?? 0} ` +
                'entries searched here — the collection holds more, which ' +
                'this box has not read.'
              : `No matches for “${text}” in the ${searchIndex?.length ?? 0} ` +
                'entries searched here.'
          }
        />
      </MuiStack>
    )
  },
)
CollectionSearch.displayName = 'AglynCollectionSearch'

export const collectionSearchSchema: Aglyn.ComponentSchema<CollectionSearchProps> =
  {
    $id: SEARCH_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Collection Search',
    description:
      'A search box for a content collection, with a suggestions dropdown.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiMagnify.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection this box searches (e.g. "blog"). Leave blank ' +
          'on a list-template screen to use the collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'searchPlaceholder',
        label: 'Search placeholder',
        description:
          'Hint text inside this box. Blank shows "Search posts…", which is ' +
          'worth changing when the collection is not posts.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      // `searchIndex`, `searchTotal` and `searchCapped` are deliberately NOT
      // attributes: all three are server-stamped facts about a read, and an
      // author who could edit them could make the box lie about its own
      // reach.
    ],
  }

export { CollectionSearch }
