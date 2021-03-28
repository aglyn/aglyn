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
