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

import json from '../../json/authors.min.json'
import { Normal } from '../../common/data-type'


type Json = typeof json

export type AuthorKeys = Normal.KeysFromList<Json['authorIds']> | keyof Json['byAuthorId']
export type Author = Normal.Values<Json['byAuthorId']>
export type Authors = {
  authorIds: Normal.KeyList<AuthorKeys>
  byAuthorId: Normal.Lookup<Author, AuthorKeys>
}

export const authors: Authors = json
