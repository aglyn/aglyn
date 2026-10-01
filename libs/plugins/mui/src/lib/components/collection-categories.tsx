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
import { mdiTagMultipleOutline } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const CATEGORIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID

export interface CollectionCategoriesProps extends StackProps {
  /**
   * Collection whose taxonomy renders (compose-time). Blank = the collection
   * routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /**
   * Label for the unfiltered pill (default "All"). Clearing the field
   * persists `Aglyn.COLLECTION_ALL_PILL_NONE`, which omits the pill —
   * `''` cannot be stored at all (AGL-1336).
   */
  allLabel?: string
  /**
   * Server-stamped pill links (`expandCollectionCategories`); never set by
   * hand — the tenant builds them from the collection's categories and the
   * routed category.
   */
  items?: Aglyn.CollectionCategoryLink[]
}

/** Pill look, in palette tokens so it follows the site theme in both modes. */
const pillSx = (active: boolean) => ({
  px: 1.75,
  py: 0.75,
  borderRadius: 999,
  border: '1px solid',
  borderColor: active ? 'primary.main' : 'divider',
  bgcolor: active ? 'primary.main' : 'transparent',
  color: active ? 'primary.contrastText' : 'text.secondary',
  fontSize: 14,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  '&:hover': {
    borderColor: active ? 'primary.main' : 'text.primary',
    color: active ? 'primary.contrastText' : 'text.primary',
  },
})

/**
 * The category filter row for a collection listing (AGL-1321): "All" plus one
 * pill per category, each a REAL anchor to `/{collection}/category/{slug}`.
 *
 * Anchors, not click handlers, and that is the whole design. A JS-only toggle
 * would be invisible to crawlers, unopenable in a new tab, unlinkable, and
 * unreachable without hydration — and it could not exist anyway, since the
 * filter is resolved server-side before the page is composed. The pill the
 * current URL selected carries `aria-current="page"`, stamped on the server so
 * it is in the HTML rather than derived after hydration.
 */
const CollectionCategories = forwardRef<
  HTMLDivElement,
  CollectionCategoriesProps
>((props, ref) => {
  // `collectionSlug`/`allLabel` are compose-time: the tenant resolves them
  // while stamping `items`; strip so they never hit the DOM.
  const { collectionSlug, allLabel, items, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  if (!items?.length) {
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Category pills — All + one pill per collection category render here'}
      </Box>
    )
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={1}
      {...rest}
      // MERGE, never replace (AGL-1450) — see collection-entry-meta.tsx.
      sx={[{ flexWrap: 'wrap', rowGap: 1 }, ...nodeSx]}
    >
      {items.map((item) =>
        // Editing surfaces render the pill look without an href, so a click
        // in the besigner never navigates the canvas away.
        suppressNavigation ? (
          <Box key={item.href} sx={pillSx(item.active)}>
            {item.label}
          </Box>
        ) : (
          <AppLink
            key={item.href}
            href={item.href}
            underline="none"
            aria-current={item.active ? 'page' : undefined}
            sx={pillSx(item.active)}
          >
            {item.label}
          </AppLink>
        ),
      )}
    </MuiStack>
  )
})
CollectionCategories.displayName = 'AglynCollectionCategories'

export const collectionCategoriesSchema: Aglyn.ComponentSchema<CollectionCategoriesProps> =
  {
    $id: CATEGORIES_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Category Pills',
    description: 'A pill per collection category, each filtering the listing.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTagMultipleOutline.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection whose categories render as pills (e.g. ' +
          '"blog"). Leave blank on a list-template page to use the ' +
          'collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'allLabel',
        label: 'All label',
        description:
          'Label for the unfiltered pill, which links to the collection ' +
          'root (default "All"). Clear the box to omit that pill — it then ' +
          'reads "none", which is what makes the omission stick. Typing ' +
          '"none" does the same thing.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        // Without this the emptied field persists NOTHING (AGL-1336): ddf
        // maps an emptied value to `clearedValue`, final-form's parse turns
        // `''` into `undefined`, and the missing key takes the runtime
        // default — so "clear it to omit that pill" was undoable by
        // clicking. Same shape as FIELD_COLOR_ALT1's `'default'` (AGL-1191):
        // a value that means something has to BE something.
        //
        // ddf only substitutes `clearedValue` when the field HAD an initial
        // value (`enhancedOnChange`'s `typeof initial !== 'undefined'`),
        // which is why its preset (collection-presets.ts) seeds `allLabel`
        // and why the sentinel is a word an author can also type. A block
        // that never carried the prop has an already-empty box and nothing
        // to clear.
        clearedValue: Aglyn.COLLECTION_ALL_PILL_NONE,
      },
    ],
  }

export { CollectionCategories }
