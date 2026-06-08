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

import * as fs from 'fs'
import { dirname } from 'path'
import { convertIdToModuleName } from '../../src/lib/utils/convert-id-to-module-name'


type FileOptionsJson = {
  type: 'json'
  data: Record<any, any>
  minify?: boolean
}
type FileOptionsExportDefault = {
  type: 'module'
  data: Record<any, any>
}
type FileOptionsExportDefaultArray = {
  type: 'module-array'
  data: Record<any, any>[] | Record<any, any>
  importDir: string
}
type FileOptionsExportName = {
  type: 'named'
  data: Record<any, any>[]
  importDir: string
}

type FileUnionOptions =
  | FileOptionsJson
  | FileOptionsExportDefault
  | FileOptionsExportDefaultArray
  | FileOptionsExportName

type FileOptions = FileUnionOptions & {
  file: string
  dir?: string
}

function writeFile(dir, fileName, contents) {
  const outFile = `${dir}${fileName}`
  fs.mkdir(dirname(outFile), { recursive: true }, function (err) {
    if (err) {
      console.error(
        'Error creating directory for file',
        fileName,
        `(${outFile})`,
        err,
      )
    } else {
      fs.writeFile(outFile, contents, (err) => {
        if (err) {
          console.error('Error generating file', fileName, `(${outFile})`, err)
        } else {
          console.log('\u2714 Generated file', fileName, `(${outFile})`)
        }
      })
    }
  })
}

function generateJsonFile(opts: FileOptions & FileOptionsJson) {
  const data = Array.isArray(opts.data) ? { data: opts.data } : opts.data
  const contents = JSON.stringify(data, null, opts.minify ? null : 2)
  const filename = `${opts.file}${opts.minify ? '.min' : ''}.json`
  writeFile(opts.dir, filename, contents)
}

function generateExportDefaultFile(
  opts: FileOptions & FileOptionsExportDefault,
) {
  const { file, data, dir } = opts
  const filename = `${file}.ts`
  const dataStr = JSON.stringify(data, null, 2)
  const exportName = convertIdToModuleName(data.id)
  const contents = [
    `import type { Icon } from '../../../src/lib/types'`,
    `export const ${exportName}: Icon = ${dataStr}`,
    `export default ${exportName}`,
  ].join('\r\n')
  writeFile(dir, filename, contents)
}

function generateExportDefaultArray(
  opts: FileOptions & FileOptionsExportDefaultArray,
) {
  const filename = `${opts.file}.ts`
  const imports = []
  const names = opts.data
    .map((icon) => {
      const name = convertIdToModuleName(icon.id)
      imports.push(`import ${name} from '${opts.importDir}${icon.id}'`)
      return name
    })
    .join(',\r\n  ')
  const contents = [
    `${imports.join('\r\n')}`,
    `export default [\r\n  ${names}\r\n]`,
  ].join(`\r\n`)
  writeFile(opts.dir, filename, contents)
}

function generateExportNamedFile(opts: FileOptions & FileOptionsExportName) {
  const filename = `${opts.file}.ts`
  const contents = opts.data
    .map((icon) => {
      return `export * from '${opts.importDir}${icon.id}'`
    })
    .join('\r\n')
  writeFile(opts.dir, filename, contents)
}

export function generateFile(opts: FileOptions): void {
  try {
    switch (opts.type) {
      case 'json':
        generateJsonFile(opts)
        break
      case 'module':
        generateExportDefaultFile(opts)
        break
      case 'module-array':
        generateExportDefaultArray(opts)
        break
      case 'named':
        generateExportNamedFile(opts)
        break
    }
  } catch (e) {
    console.error(e)
  }
}
export default generateFile
