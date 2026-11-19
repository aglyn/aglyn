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

/**
 * How a screen's `seo` map is rebuilt from a partial edit (AGL-1437) now
 * lives in the shared app utilities (AGL-4235), where the public API's page
 * search listing save reads the same rules the two console panels do. This
 * file keeps the console's imports where they were.
 */
export {
  buildScreenSeoUpdate,
  type ScreenSeoEdits,
  type ScreenSocialImageDraft,
} from '@aglyn/aglyn/app-utils/screen-seo-update'
export { buildScreenSeoUpdate as default } from '@aglyn/aglyn/app-utils/screen-seo-update'
