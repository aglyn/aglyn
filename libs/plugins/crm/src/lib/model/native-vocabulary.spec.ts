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

import {
  mdiFacebookMessenger,
  mdiInstagram,
  mdiLinkedin,
  mdiWhatsapp,
} from '@aglyn/shared-data-mdi'
import { NATIVE_CRM_ACTIVITY_ICON_PATHS } from './native-vocabulary'

describe('NATIVE_CRM_ACTIVITY_ICON_PATHS', () => {
  it('holds the glyphs the console timeline draws, byte for byte', () => {
    expect(NATIVE_CRM_ACTIVITY_ICON_PATHS).toEqual({
      whatsapp: mdiWhatsapp.path,
      messenger: mdiFacebookMessenger.path,
      instagram: mdiInstagram.path,
      linkedin: mdiLinkedin.path,
    })
  })
})
