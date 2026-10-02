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

import type { PageRecordAnswer } from '@aglyn/aglyn/app-utils/page-record-sources'
import { createContext } from 'react'

/**
 * The record the WHOLE page on the canvas is drawn for (AGL-3475): a record
 * template, previewed with one of its records.
 *
 * Provided by the console beside the canvas from whichever page-record source
 * serves the page; the canvas lays it over every element — the layout chrome
 * included, as the published page's composition does — through
 * `RepeatRecordContext`, so a repeat inside the page still draws its own rows.
 *
 * ABSENT for every page no source serves, which is almost every page.
 */
export const CanvasPageRecordContext = createContext<
  Extract<PageRecordAnswer, { status: 'ready' }> | undefined
>(undefined)
CanvasPageRecordContext.displayName = 'CanvasPageRecordContext'

export default CanvasPageRecordContext
