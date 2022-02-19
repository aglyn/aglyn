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

import {NsErrorFactory} from './ns-error-factory'


describe('namespaced-error', () => {
  // Closure enum for type-safe error codes
  // at-enum {string}
  enum Err {
    UNKNOWN = 'unknown',
    FILE_NOT_FOUND = 'file-not-found',
  }

  const errors: Record<Err, string> = {
    [Err.UNKNOWN]: 'Unknown error',
    [Err.FILE_NOT_FOUND]: 'Could not find file: {$file}',
  }
  // Type-safe function - must pass a valid error code as param.
  const error = new NsErrorFactory<Err>('service', 'Service', errors)

  function getMissingFile() {
    try {
      // Service: Could not file file: foo.txt (service/file-not-found).
      throw error.create(Err.FILE_NOT_FOUND, {file: 'fileName.txt'})
    }
    catch (e) {
      if (e['code'] === 'service/file-not-found') {
        console.log('Could not read file: ' + e['file'])
      }
    }
  }

  it('should work', () => {
    expect(getMissingFile()).toThrowError(NsErrorFactory)
  })
})
