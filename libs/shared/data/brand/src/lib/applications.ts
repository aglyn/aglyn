/**
 * @license
 * Copyright 2021 Aglyn LLC
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
  mdiArrowTopLeft,
  mdiBookVariant,
  mdiBookVariantMultiple,
  mdiCodeArray,
  mdiCodeBracesBox,
  mdiCodeString,
  mdiContentDuplicate,
  mdiCubeOutline,
  mdiDeleteOutline,
  mdiDrag,
  mdiFileTree,
  mdiFormDropdown,
  mdiInformationVariant,
  mdiLoginVariant,
  mdiLogoutVariant,
  mdiPencil,
  mdiVariable,
} from '@aglyn/shared-ui-mdi-jsx'


export const APP_WWW = {
  META_TITLE: 'Aglyn',
  META_DESCRIPTION: 'Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations',
}

export const ProductNames = {
  WWW: '.com',
}

export const IconVariant = {
  // Blocks and symbols
  ENTITY_BLOCK: mdiCubeOutline.path,

  // Data
  PROPERTY: mdiVariable.path,
  DOCUMENT: mdiBookVariant.path,
  COLLECTION: mdiBookVariantMultiple.path,

  // Data-sets
  PROPERTIES: mdiFormDropdown.path,
  DETAILS: mdiInformationVariant.path,
  TREE_VIEW: mdiFileTree.path,

  // Data-Type
  STRING: mdiCodeString.path,
  ARRAY: mdiCodeArray.path,
  OBJECT: mdiCodeBracesBox.path,

  // Modification
  MODIFY_DUPLICATE: mdiContentDuplicate.path,
  MODIFY_DELETE: mdiDeleteOutline.path,
  MODIFY_EDIT: mdiPencil.path,
  MODIFY_DRAG: mdiDrag.path,
  SELECT_PARENT: mdiArrowTopLeft.path,

  // User
  LOGIN: mdiLoginVariant.path,
  LOGOUT: mdiLogoutVariant.path,
}
