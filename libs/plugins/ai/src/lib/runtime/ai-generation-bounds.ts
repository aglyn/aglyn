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
 * What one generation through the doctrine's loop may spend, kept apart from
 * the loop (AGL-3036) so the job machine and its time budget can read it
 * without loading the doctrine, its validators and the palette catalog.
 * `runtime/ai-doctrine.ts` enforces it and re-exports it.
 */

/** One answer, and one re-ask with the violations named. */
export const AI_GENERATION_MAX_ATTEMPTS = 2
