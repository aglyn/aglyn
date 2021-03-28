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
