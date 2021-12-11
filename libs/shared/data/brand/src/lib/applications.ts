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


export const APP_WWW = {
  META_TITLE: 'Aglyn',
  META_DESCRIPTION: 'Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations',
}

export const ProductNames = {
  WWW: '.com',
}

export enum IconVariant {
  // Data
  PROPERTY = 'variable',
  DOCUMENT = 'book-variant',
  COLLECTION = 'book-variant-multiple',

  // Data-sets
  PROPERTIES = 'form-dropdown',
  DETAILS = 'information-variant',
  TREE_VIEW = 'file-tree',


  // Data-Type
  STRING = 'code-string',
  ARRAY = 'code-array',
  OBJECT = 'code-braces-box',

  // Modification
  MODIFY_DUPLICATE = 'content-duplicate',
  MODIFY_DELETE = 'delete-outline',
  MODIFY_EDIT = 'pencil',
  SELECT_PARENT = 'arrow-top-left',

  // User
  LOGIN = 'login-variant',
  LOGOUT = 'logout-variant',
}
