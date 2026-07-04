/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { bundle as muiBundle } from '@aglyn/plugins-ui-mui'
import {
  doesBesignerAppExist,
  initializeBesignerApp,
} from '@aglyn/besigner-data-app'
import { registerBundle, registerComponent } from '@aglyn/aglyn'
import { createAglynComponent } from '@aglyn/aglyn-node-renderer'
import { IS_PRODUCTION } from '@aglyn/shared-data-enums'
import { samplePageData } from './sample-data'

const c1 = createAglynComponent(
  {
    $id: 'root',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c2 = createAglynComponent(
  {
    $id: 'root1',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c3 = createAglynComponent(
  {
    $id: 'root2',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c4 = createAglynComponent(
  {
    $id: 'root3',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'span',
)

const c5 = createAglynComponent(
  {
    $id: 'root4',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'span',
)
const components = [c1, c2, c3, c4, c5]

try {
  if (!doesBesignerAppExist() && typeof window !== 'undefined') {
    const app = initializeBesignerApp({
      logLevel: 'debug',
      modulesOptions: {
        canvas: {
          defaults: {
            present: samplePageData,
          },
        },
      },
    })
    if (!IS_PRODUCTION) console.info('initialize app', app)

    if (typeof window !== 'undefined' && !IS_PRODUCTION) {
      window['__AGLYN_APP__'] = app
    }

    components.forEach((i) => registerComponent(app, i))
    registerBundle(app, muiBundle)
  }
} catch (e) {
  console.error(e, 'initialize aglyn app')
}

export {}
