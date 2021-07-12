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

import util from '@mdi/util'
import { capitalCase, paramCase } from 'change-case'
import { Normal } from '../common/data-type'
import path from 'path'
import fs from 'fs'


type FileInfo = { out: string; exportName: string; data: Record<string, unknown> }

type Icons = {
  iconIds: string[]
  byIconId: Normal.Lookup<{
    path: string
    name: string
    alias: { [alias: string]: true }
  },
    string>
}
type Authors = {
  authorIds: string[]
  byAuthorId: Normal.Lookup<{
    name: string
    icon: { [iconId: string]: true }
  },
    string>
}
type Tags = {
  tagIds: string[]
  byTagId: Normal.Lookup<{
    name: string
    icon: { [iconId: string]: true }
  },
    string>
}

const outDir = path.join(__dirname, '../json/')
const version = util.getVersion()
const meta = util.getMeta(true)
const iconIds: string[] = []
const authorIds: string[] = []
const tagIds: string[] = []
const icons: Icons = {iconIds, byIconId: {}}
const authors: Authors = {authorIds, byAuthorId: {}}
const tags: Tags = {tagIds, byTagId: {}}
function configureIcon(iconMeta) {
  const {name, path, aliases = []} = iconMeta
  const iconId = paramCase(name)
  iconIds.push(iconId)
  icons.byIconId[iconId] = {path, name: capitalCase(iconId), alias: {}}
  aliases.forEach((aliasId) => (icons.byIconId[iconId].alias[aliasId] = true))
  return iconId
}
function configureTags(iconId, iconMeta) {
  const {tags: iconTags = []} = iconMeta
  iconTags.forEach((tagName) => {
    const tagId = paramCase(tagName)
    // Ensure tagId is present in allIds
    if (!(tagIds.indexOf(tagId) >= 0)) {
      tagIds.push(tagId)
      tags.byTagId[tagId] = {
        name: String(tagName),
        icon: {},
      }
    }
    tags.byTagId[tagId].icon = {
      ...tags.byTagId[tagId].icon,
      [iconId]: true,
    }
  })
}
function configureAuthors(iconId, iconMeta) {
  const {author} = iconMeta
  const authorId = paramCase(author)
  if (!(authorIds.indexOf(authorId) >= 0)) {
    authorIds.push(authorId)
    authors.byAuthorId[authorId] = {
      name: String(author),
      icon: {},
    }
  }
  // Append icon to existing author
  authors.byAuthorId[authorId].icon = {
    ...authors.byAuthorId[authorId].icon,
    [iconId]: true,
  }
}

function generateFile(fileInfo: FileInfo, minify = false): void {
  const {data, out} = fileInfo
  const min = Boolean(minify)
  const contents = JSON.stringify(data, null, min ? null : 2)
  const filename = `${out}${min ? '.min' : ''}.json`
  const outFile = `${outDir}${filename}`
  fs.writeFile(outFile, contents, (err) => {
    if (err) {
      console.error('Error generating file', outFile)
    } else {
      console.info('Generating file', outFile)
    }
  })
}

;(function() {
  meta.forEach((iconMeta) => {
    const iconId = configureIcon(iconMeta)
    configureTags(iconId, iconMeta)
    configureAuthors(iconId, iconMeta)
  })
  const filesInfo = [
    {out: 'icons', exportName: 'icons', data: icons},
    {out: 'authors', exportName: 'authors', data: authors},
    {out: 'tags', exportName: 'tags', data: tags},
  ]
  filesInfo.forEach((data) => {
    generateFile(data)
    generateFile(data, true)
  })
  console.log(`\u2714 Generated icons for mdi build v${version}`)
})()
