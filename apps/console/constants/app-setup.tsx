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

import {bundle as muiBundle} from '@aglyn/addons-ui-mui-bundle'
import {doesBesignerAppExist, initializeBesignerApp} from '@aglyn/core-data-besigner'
import {registerBundle, registerComponent} from '@aglyn/core-data-framework'
import {createAglynComponent} from '@aglyn/core-feature-renderer'
import {IS_PRODUCTION} from '@aglyn/shared-data-enums'
import {samplePageData} from './sample-data'


const c1 = createAglynComponent(
  {
    componentId: 'root',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c2 = createAglynComponent(
  {
    componentId: 'root1',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c3 = createAglynComponent(
  {
    componentId: 'root2',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'div',
)

const c4 = createAglynComponent(
  {
    componentId: 'root3',
    displayName: 'Root Element',
    title: 'Root element',
  },
  'span',
)

const c5 = createAglynComponent(
  {
    componentId: 'root4',
    displayName: 'Root Element',
    title: 'Root element',
    templates: [
      {
        id: 'root4:1',
        label: 'Root 4',
        data: {
          componentId: 'root4',
          props: {
            children: 'First Root4',
          },
        },
      },
    ],
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
    console.log('initialize app', app)

    if (typeof window !== 'undefined' && !IS_PRODUCTION) {
      window['__AGLYN_APP__'] = app
    }

    components.forEach((i) => registerComponent(app, i))
    registerBundle(app, muiBundle)
  }
}
catch (e) {
  console.error(e, 'initialize aglyn app')
}

export {}
