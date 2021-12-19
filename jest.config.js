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

const {getJestProjects} = require('@nrwl/jest')

module.exports = {
  projects: [
    ...getJestProjects(),
    // '<rootDir>/libs/addons/ui/mui-bundle',
    // '<rootDir>/libs/core/data/framework',
    // '<rootDir>/libs/core/feature/besigner',
    // '<rootDir>/libs/core/feature/renderer',
    // '<rootDir>/libs/shared/data/brand',
    // '<rootDir>/libs/shared/data/mdi',
    // '<rootDir>/libs/shared/data/types',
    // '<rootDir>/libs/shared/feature/themes',
    // '<rootDir>/libs/shared/ui/jsx',
    // '<rootDir>/libs/shared/ui/mdi-jsx',
    // '<rootDir>/libs/shared/ui/next',
    // '<rootDir>/libs/shared/util/dom',
    // '<rootDir>/libs/shared/util/emitter',
    // '<rootDir>/libs/shared/util/errors',
    // '<rootDir>/libs/shared/util/guards',
    // '<rootDir>/libs/shared/util/logger',
    // '<rootDir>/libs/shared/util/timestamp',
    // '<rootDir>/libs/shared/util/tools',
    // '<rootDir>/libs/shared/util/vendor',
  ],
}
