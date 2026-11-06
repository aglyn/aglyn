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

import { createContext } from 'react'
import type { PluginConnectionRecordsPageData } from './plugin-connection-records'

/*
 * The React half of `plugin-connection-records.ts` (AGL-4195), apart so the
 * server enricher that writes the page prop never loads a module that calls
 * `createContext` (AGL-405). Not on the realm host surface: a bundle reads the
 * records through `usePluginConnectionRecord` alone.
 */

/**
 * The page's records. The published page provides its prop; a surface with
 * none (the Besigner, Preview, an email) provides nothing, and every element
 * reads `null` — the same answer as a site that has not connected yet.
 */
export const PluginConnectionRecordsContext = createContext<PluginConnectionRecordsPageData | undefined>(undefined)
PluginConnectionRecordsContext.displayName = 'PluginConnectionRecordsContext'

