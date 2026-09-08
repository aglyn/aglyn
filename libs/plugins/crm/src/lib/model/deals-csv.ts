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
 * The deals CSV — one file from the table's Export button and the bulk
 * bar's (AGL-2621).
 *
 * A deal names its stage, its owner, its contact and its company by id, and
 * an id is nothing a spreadsheet can read: the stage and the pipeline are
 * written by NAME, resolved through the caller's pipelines, the owner by
 * address, and the contact and the company by the names the deal already
 * carries as captions. The amount is written in major units (`1250.00`),
 * with the currency beside it, because a column of cents is a column
 * somebody will sum wrongly.
 *
 * There is no deals import, so the header is free to read well; it stays
 * in the table's column order so the file and the screen agree.
 */

/*
 * The columns and the cells moved to `@aglyn/aglyn` under AGL-2662 so the
 * server's whole-collection export can write the same file: the console
 * app may not import a feature plugin, and one feature must not have two
 * file formats. This module keeps its name and its callers.
 */
export {
  csvAmount,
  csvInstant,
  DEAL_CSV_COLUMNS,
  dealsCsv,
  type DealCsvOptions,
  type DealCsvRow,
} from '@aglyn/aglyn'
