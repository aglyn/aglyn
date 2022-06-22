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
import { registerBundle, registerComponent } from '@aglyn/core-data-app'
import { samplePageData } from '@aglyn/besigner-feature-app'
import { createAglynComponent } from '@aglyn/core-feature-renderer'
import { IS_PRODUCTION } from '@aglyn/shared-data-enums'

const c1 = createAglynComponent(
  {
    componentId: 'sample-element',
    displayName: 'Sample Element',
    title: 'Sample Element',
  },
  'div',
)

const c2 = createAglynComponent(
  {
    componentId: 'sample-element-1',
    displayName: 'Sample Element 1',
    title: 'Sample Element 1',
  },
  'div',
)

const c3 = createAglynComponent(
  {
    componentId: 'sample-element-2',
    displayName: 'Sample Element 2',
    title: 'Sample Element 2',
  },
  'div',
)

const c4 = createAglynComponent(
  {
    componentId: 'sample-element-3',
    displayName: 'Sample Element 3',
    title: 'Sample Element 3',
  },
  'span',
)

const c5 = createAglynComponent(
  {
    componentId: 'sample-element-4',
    displayName: 'Sample Element 4',
    title: 'Sample Element 4',
    templates: [
      {
        id: 'sample-element-4',
        label: 'Sample Element 4',
        data: {
          componentId: 'sample-element-4',
          props: {
            children: 'Sample Element 4',
          },
        },
      },
    ],
  },
  'div',
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
    console.log('initialize app', app)

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
