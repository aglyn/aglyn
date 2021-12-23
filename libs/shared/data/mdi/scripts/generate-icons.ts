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
import path from 'path'
import generateFile from './utils/generate-file'
import mapIconData from './utils/map-icon-data'


const outDir = path.join(__dirname, '../generated/')
const version = util.getVersion()
const meta = util.getMeta(true)
const icons = meta.map(icon => mapIconData(icon))
const dir = (name?) => `${outDir}${version}/${name ? `${name}/` : ''}`


function writeModuleFiles() {
  // Generate icons isolated module files
  icons.forEach((icon) => {
    generateFile({data: icon, file: `mdi-${icon.id}`, dir: dir('icons'), type: 'module'})
  })

  // Generate json files
  // generateFile({data: icons, file: 'mdi-icons', dir: dir('json'), type: 'json'})
  generateFile({data: icons, file: 'mdi-icons', dir: dir(), type: 'json', minify: true})

  // Generate default exported module array files
  // generateFile({data: icons, file: `mdi-icons-array`, dir: dir(), importDir: './modules/mdi-',
  // type: 'module-array'})

  // Generate named module file
  generateFile({data: icons, file: 'mdi-icons', dir: dir(), type: 'named', importDir: './icons/mdi-'})
}

;(function() {
  writeModuleFiles()
})()
module.exports = {}
