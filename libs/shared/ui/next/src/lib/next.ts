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

// The Pages Router `_app` / `_document` pieces are intentionally NOT
// re-exported here: `_emotion-document.component` imports `next/document`,
// which webpack cannot resolve in an App Router production build, so any
// App Router consumer that value-imports this barrel (e.g. a feature plugin
// pulled into the tenant/console app graph) would fail to build. The only
// consumer is `apps/www` (Pages Router), which deep-imports them directly
// from `./components/_app.component` and `./components/_emotion-document.component`.
export * from './components/hub-tabs'
export * from './components/image'
export * from './components/page-decorated'

export * from './contexts/next-page-title-provider'
