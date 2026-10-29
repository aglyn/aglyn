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
import { mdiFileDocumentOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { forwardRef, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { QUOTE_PAGE_COMPONENT_ID } from '../constants/quote-page'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = QUOTE_PAGE_COMPONENT_ID

export interface QuotePageProps {
  heading?: string
}

/** The page itself, loaded only where a quote is drawn, so no other page of the site carries it. */
const QuotePageBody = lazy(() => import('./quote-page-body'))

/**
 * The customer's quote page (AGL-4094), where a quote's pay link opens: the
 * quote, and its Pay button. See `quote-page-body.tsx`.
 */
const QuotePage = forwardRef<HTMLDivElement, QuotePageProps>((props, ref) => (
  <Suspense
    fallback={
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress size={28} aria-label="Loading your quote" />
      </Box>
    }
  >
    <QuotePageBody ref={ref} {...props} />
  </Suspense>
))
QuotePage.displayName = 'QuotePage'

export const schema: Aglyn.ComponentSchema<QuotePageProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Quote',
  description: 'A customer’s quote and its Pay button, opened from the pay link a business sends.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiFileDocumentOutline.path, sx: { color: 'primary.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the quote. Defaults to the quote number.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Quote',
    pluginId: BUNDLE_ID,
    description: 'A customer’s quote and its Pay button, for the /pay-quote page',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiFileDocumentOutline.path, sx: { color: 'primary.main' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default QuotePage
