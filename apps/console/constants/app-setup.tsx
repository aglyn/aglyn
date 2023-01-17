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

import * as Aglyn from '@aglyn/aglyn'
import {
  doesBesignerAppExist,
  getBesignerApp,
  IBesignerAppController,
  initializeBesignerApp,
} from '@aglyn/besigner-data-app'
import { samplePageData } from '@aglyn/besigner-ui'
import { registerBundle, registerComponent } from '@aglyn/core-data-app'
import { createAglynComponent } from '@aglyn/core-feature-renderer'
import { bundle as muiBundle } from '@aglyn/plugins-ui-mui'
import { IS_PRODUCTION } from '@aglyn/shared-data-enums'

const c1 = createAglynComponent(
  {
    $id: 'sample-element',
    displayName: 'Sample Element',
    title: 'Sample Element',
  },
  'div',
)

const c2 = createAglynComponent(
  {
    $id: 'sample-element-1',
    displayName: 'Sample Element 1',
    title: 'Sample Element 1',
  },
  'div',
)

const c3 = createAglynComponent(
  {
    $id: 'sample-element-2',
    displayName: 'Sample Element 2',
    title: 'Sample Element 2',
  },
  'div',
)

const c4 = createAglynComponent(
  {
    $id: 'sample-element-3',
    displayName: 'Sample Element 3',
    title: 'Sample Element 3',
  },
  'span',
)

const c5 = createAglynComponent(
  {
    $id: 'sample-element-4',
    displayName: 'Sample Element 4',
    title: 'Sample Element 4',
    presets: [
      {
        $id: 'sample-element-4',
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

components.forEach((i) => {
  Aglyn.components.registerComponent(i.component, i.schema)
})

declare global {
  // eslint-disable-next-line no-var
  var Aglyn: IBesignerAppController
  // eslint-disable-next-line no-var
  // var Aglyn: AglynAppControllerT

  interface Window {
    Aglyn?: IBesignerAppController
  }
}

const hasWindow = typeof window !== 'undefined'
let _Aglyn = globalThis.Aglyn

try {
  if (!_Aglyn && !doesBesignerAppExist() && hasWindow) {
    _Aglyn = globalThis.Aglyn = initializeBesignerApp({
      logLevel: 'debug',
      modulesOptions: {
        canvas: {
          defaults: {
            present: samplePageData,
          },
        },
      },
    })
    console.log('set global Aglyn', _Aglyn, globalThis)
    if (!IS_PRODUCTION) {
      // @ts-ignore
      window.Aglyn = Aglyn
    }

    components.forEach((i) => registerComponent(_Aglyn, i))
    registerBundle(_Aglyn, muiBundle)
  } else if (!_Aglyn && doesBesignerAppExist() && hasWindow) {
    _Aglyn = getBesignerApp()
  }
} catch (e) {
  console.error(e, 'initialize aglyn app')
}

export { _Aglyn as Aglyn }
