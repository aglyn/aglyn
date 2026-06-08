/**
 * @license
 * Copyright 2023 Aglyn LLC
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

const fs = require('fs')
const path = require('path')
const toIco = require('to-ico')

const staticDir = path.join(__dirname, 'static')
const join = (file) => path.join(staticDir, file)

const files = [
  // Aglyn v2 branding
  {
    name: join('./icons/aglyn-2/icon-32x32.png'),
    out: join('./icons/aglyn-2/icon-32x32.ico'),
  },
]

async function convertFiles(files) {
  for await (const { name, out } of files) {
    try {
      console.log('Reading file:', name)
      const file = await fs.readFileSync(name)
      console.log('Converting png to ico:', name)
      await toIco([file])
        .then(async (buf) => {
          console.log('Writing file:', `${name} => ${out}`)
          await fs.writeFileSync(out, buf)
          console.log('New file:', out)
        })
        .catch((e) => {
          console.error(e)
        })
    } catch (e) {
      console.error(e)
    }
  }
}

convertFiles(files).then(() => console.log('DONE!'))
