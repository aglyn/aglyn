/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
