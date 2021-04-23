/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import json from '../../json/tags.min.json'
import { Normal } from '../../common/data-type'

type Json = typeof json

export type TagKeys = Normal.KeysFromList<Json['tagIds']> | keyof Json['byTagId']
export type Tag = Normal.Values<Json['byTagId']>
export type Tags = {
  tagIds: Normal.KeyList<TagKeys>
  byTagId: Normal.Lookup<Tag, TagKeys>
}

export const tags: Tags = json
