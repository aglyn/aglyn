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
 * The first-party starter definitions, where the console's gallery, its
 * seed and their specs import them from.
 *
 * The definitions themselves live in the core package, because the AI
 * plugin's page template generator shows them to a model as examples and a
 * plugin never imports an app. This module stays a leaf on both graphs for
 * the reason the definitions give: the core module imports only other leaves.
 */
export * from '@aglyn/aglyn/app-utils/starter-templates'
