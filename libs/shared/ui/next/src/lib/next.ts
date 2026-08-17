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

// This barrel serves App Router consumers only. The Pages Router `_app` /
// `_document` components that once lived beside these were deleted with
// `apps/www`, the last Pages Router app (AGL-1833): their `next/document`
// import cannot resolve in an App Router production build, so nothing here
// may ever re-export a module that touches it.
export * from './components/hub-tabs'
export * from './components/image'
export * from './components/page-decorated'

export * from './contexts/next-page-title-provider'
