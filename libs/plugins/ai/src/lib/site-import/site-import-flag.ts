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
 * The release flag every "Bring my site" surface closes on (AGL-3974,
 * AGL-3976): the ownership and crawl doors, the import job's admission and
 * each of its waves, and the console's choice card. Off by default; a
 * module of its own so the job and the doors read it without each other.
 */
export const SITE_IMPORT_RELEASE_FLAG = 'release_ai_site_import' as const
