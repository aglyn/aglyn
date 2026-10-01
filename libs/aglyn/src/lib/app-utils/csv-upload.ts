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
 * The most characters one uploaded CSV may carry, whoever reads it.
 *
 * A file a person uploads is parsed in one pass by `parseCsv` (`dataset-csv.ts`), in the
 * browser that picked it and again on the server that imports it. This bounds
 * that pass: it is checked before the parse rather than after, because the
 * parse is what the ceiling is protecting — a refusal answered on the byte
 * count costs nothing, where discovering the file was too big by
 * materializing all of its cells has already spent the memory the limit
 * exists to bound. Every importer that reads a CSV in one go shares it, so a
 * file one importer accepts is never one another refuses for its size.
 */
export const CSV_UPLOAD_MAX_CHARACTERS = 8_000_000
