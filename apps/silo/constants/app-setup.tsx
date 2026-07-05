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

import {
  doesBesignerAppExist,
  initializeBesignerApp,
} from '@aglyn/besigner'
import { IS_PRODUCTION } from '@aglyn/shared-data-enums'

try {
  if (!doesBesignerAppExist() && typeof window !== 'undefined') {
    const app = initializeBesignerApp({ logLevel: 'debug' })
    if (!IS_PRODUCTION) console.info('initialize app', app)

    if (typeof window !== 'undefined' && !IS_PRODUCTION) {
      window['__AGLYN_APP__'] = app
    }
  }
} catch (e) {
  console.error(e, 'initialize aglyn app')
}

export {}
