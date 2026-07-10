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

import { defineConfig } from 'cypress'

// Migrated from the legacy cypress.json (Cypress ≤9) the scaffold shipped
// with — Cypress 15 requires this format and the suite had never actually
// run under it.
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'src/integration/**/*.spec.ts',
    supportFile: 'src/support/index.ts',
    fixturesFolder: 'src/fixtures',
    video: false,
    screenshotsFolder: '../../dist/cypress/apps/console-e2e/screenshots',
    chromeWebSecurity: false,
    // Page shells are client-rendered; first compile in dev can be slow.
    defaultCommandTimeout: 15000,
    pageLoadTimeout: 120000,
  },
})
