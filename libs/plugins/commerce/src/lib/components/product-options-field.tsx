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
import { mdiPackageVariantClosed } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { forwardRef, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

/*
 * THE PRODUCT AND OPTIONS FIELD (AGL-4098): a form field that asks which of
 * the store's products, and which of its options, a person wants — on a
 * "Request a quote" form, say.
 *
 * It lives in Commerce because the products are Commerce's, and it is a form
 * field like any other: it knows nothing about the form around it and posts
 * plain strings under its name. Its answer is the product and options in
 * words (`Vinyl banner — 3 × 6 ft / Matte`); beside it, under `{name}__data`,
 * it posts the exact product, variant and options for this plugin to read
 * back when a quote is started from the request (`parseProductFieldValue`).
 * The forms plugin keeps that value apart from the answers a person reads.
 *
 * This shell is what a page loads until the field draws; the picker is a
 * chunk of its own. The component id is persisted in documents; never rename
 * it. The core's form reader restates it (`FORM_PLUGIN_ANSWER_ELEMENTS`).
 */
export const PRODUCT_OPTIONS_FIELD_ID: Aglyn.ComponentId = 'product-options-field'

export interface ProductOptionsFieldProps {
  /** What the product and options are sent as. */
  name?: string
  /** The question, above the picker. */
  label?: string
  /** One product to ask about; empty lets the person pick from the store. */
  productId?: string
  required?: boolean
}

const ProductOptionsFieldBody = lazy(() => import('./product-options-field-body'))

/** A product and its options, picked from the store; sent in words. */
const ProductOptionsField = forwardRef<HTMLDivElement, ProductOptionsFieldProps>((props, ref) => (
  <Suspense
    fallback={
      <Box sx={{ py: 1 }}>
        <CircularProgress size={20} aria-label="Loading the product field" />
      </Box>
    }
  >
    <ProductOptionsFieldBody ref={ref} {...props} />
  </Suspense>
))
ProductOptionsField.displayName = 'AglynProductOptionsField'

export const schema: Aglyn.ComponentSchema<ProductOptionsFieldProps> = {
  $id: PRODUCT_OPTIONS_FIELD_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product and options',
  description:
    'A form field: the person picks one of your products and its options, such as size and finish. It arrives with the submission, and a quote started from it begins with that product.',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiPackageVariantClosed.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'label',
      label: 'Label',
      description: 'The question above the picker, such as “What would you like priced?”.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'name',
      label: 'Field name',
      description: 'The name the choice is listed under in the Inbox and exports.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'productId',
      label: 'Product',
      description: 'Ask about one product only: the person picks its options. Leave it empty to let them pick from your store.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'required',
      label: 'Required?',
      description: 'The form can’t be sent until a product (and each of its options) is picked.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(PRODUCT_OPTIONS_FIELD_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product and options',
    pluginId: BUNDLE_ID,
    description: 'A product from your store and its options, for a quote request',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiPackageVariantClosed.path, sx: { color: 'info.main' } },
    data: {
      $id: null,
      componentId: PRODUCT_OPTIONS_FIELD_ID,
      pluginId: BUNDLE_ID,
      props: { name: 'product', label: 'Product', required: true },
    },
  },
]

export default ProductOptionsField
