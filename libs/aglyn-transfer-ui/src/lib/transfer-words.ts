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

/*==========================================
 * THE KIT'S WORDS — every core code as the sentence a person reads.
 *
 * The core speaks in codes (`overwriteNonBlank`, `fillBlanks`,
 * `ambiguousUnresolved`); every screen of the kit names them through these
 * tables, so the export dialog, the wizard and a plugin's own surface say
 * the same thing the same way.
 *=========================================*/

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type {
  HeaderMatchReason,
  MatchNormalizer,
  RowMatchOutcome,
  TransferBlankMeans,
  TransferFieldMode,
  TransferOnAmbiguous,
  TransferOnMatch,
  TransferOnNew,
  TransferPolicySource,
  TransferRowOutcome,
  TransferRowReason,
  TransferRowVerdict,
  TransferWarningClass,
} from '@aglyn/aglyn/data-transfer'

export const WARNING_CLASS_WORDS: Readonly<
  Record<TransferWarningClass, { title: string; description: string }>
> = {
  derivation: {
    title: 'Values read differently from how they were typed',
    description:
      'A cell was reformatted to fit its field: a date put in order, a number read with its separators, a name split.',
  },
  ambiguousDate: {
    title: 'Dates that read either way',
    description:
      'Day and month could be swapped; they are read in the order you chose.',
  },
  unmatchedPicklist: {
    title: 'Values a list does not hold',
    description:
      'These values are mapped to another value, left blank, or refuse their rows, as you chose.',
  },
  newPicklistValue: {
    title: 'New list values',
    description:
      'These values are added to the organization’s list for everyone.',
  },
  unresolvedLookup: {
    title: 'References that name no record',
    description: 'Created, mapped, left blank or refused, as you chose.',
  },
  ambiguousMatch: {
    title: 'Rows that match more than one record',
    description: 'They are skipped unless you chose the record they update.',
  },
  duplicateInFile: {
    title: 'Rows repeated in the file',
    description: 'A later row with the same key as an earlier one is skipped.',
  },
  lockedRule: {
    title: 'Values a rule holds back',
    description: 'The owning feature never lets a file set these values.',
  },
  droppedCell: {
    title: 'Cells that could not be read',
    description: 'These cells are dropped; the rest of each row is imported.',
  },
  overwriteNonBlank: {
    title: 'Existing values that will be replaced',
    description:
      'Records already hold a value here, and the file’s value replaces it.',
  },
  clearValue: {
    title: 'Existing values that will be cleared',
    description: 'A blank cell clears what the record holds, as you chose.',
  },
  planLimit: {
    title: 'Rows past what your plan allows',
    description: 'These rows fail; the rest are imported.',
  },
  screening: {
    title: 'What this import’s own checks found',
    description:
      'The feature you are importing into checked the file for signs of trouble. Each item says what it found and what happens to it.',
  },
  resourceRule: {
    title: 'Rows the feature asks you to check',
    description:
      'The feature that owns these records flags them; each says why. A row it refuses fails, and the rest are imported.',
  },
}

export const VERDICT_WORDS: Readonly<Record<TransferRowVerdict, string>> = {
  create: 'Create',
  update: 'Update',
  unchanged: 'Unchanged',
  skip: 'Skip',
  fail: 'Fail',
}

export const OUTCOME_WORDS: Readonly<Record<TransferRowOutcome, string>> = {
  created: 'Created',
  updated: 'Updated',
  unchanged: 'Unchanged',
  skipped: 'Skipped',
  failed: 'Failed',
}

export const REASON_WORDS: Readonly<Record<TransferRowReason, string>> = {
  matchedSkipped: 'Matched a record, and matched rows are skipped',
  newSkipped: 'Matched nothing, and new rows are skipped',
  skippedByChoice: 'You chose to skip it',
  ambiguousSkipped: 'Matched more than one record',
  ambiguousUnresolved: 'Matched more than one record, and none was chosen',
  duplicateInFile: 'Repeats an earlier row',
  missingRequired: 'A required field is blank',
  refusedValue: 'A value refuses the row',
  matchedRecordMissing: 'The matched record no longer exists',
  planLimit: 'Past what your plan allows',
  resourceRule: 'Refused by a rule of the feature that owns it',
}

export const MODE_WORDS: Readonly<
  Record<TransferFieldMode, { label: string; description: string }>
> = {
  overwrite: {
    label: 'Overwrite',
    description: 'The file’s value replaces the record’s.',
  },
  fillBlanks: {
    label: 'Fill blanks',
    description: 'Written only where the record has no value.',
  },
  keepExisting: {
    label: 'Keep existing',
    description: 'Never changed on an existing record.',
  },
  append: {
    label: 'Append',
    description: 'The file’s items are added to the list.',
  },
}

export const BLANK_WORDS: Readonly<
  Record<TransferBlankMeans, { label: string; description: string }>
> = {
  leave: {
    label: 'Leave the value',
    description: 'A blank cell changes nothing.',
  },
  clear: {
    label: 'Clear the value',
    description: 'A blank cell empties the field.',
  },
}

export const ON_MATCH_WORDS: Readonly<Record<TransferOnMatch, string>> = {
  update: 'Update the record',
  skip: 'Skip the row',
  duplicate: 'Create a duplicate anyway',
}

export const ON_NEW_WORDS: Readonly<Record<TransferOnNew, string>> = {
  create: 'Create a record',
  skip: 'Skip the row',
}

export const ON_AMBIGUOUS_WORDS: Readonly<Record<TransferOnAmbiguous, string>> =
  {
    ask: 'Let me choose for each row',
    skip: 'Skip the row',
  }

export const SOURCE_WORDS: Readonly<Record<TransferPolicySource, string>> = {
  locked: 'Locked rule',
  row: 'This row',
  field: 'This field',
  type: 'List default',
  default: 'Default',
}

export const MATCH_KIND_WORDS: Readonly<
  Record<RowMatchOutcome['kind'], string>
> = {
  new: 'New',
  matched: 'Matched',
  ambiguous: 'Ambiguous',
  duplicateInFile: 'Repeated in the file',
}

export const MATCH_REASON_WORDS: Readonly<Record<HeaderMatchReason, string>> = {
  exactAlias: 'Same name',
  normalizedAlias: 'Same name, spelled differently',
  fuzzy: 'Similar name',
  typeInference: 'Looks like this kind of value',
}

export const NORMALIZER_WORDS: Readonly<Record<MatchNormalizer, string>> = {
  exact: 'exactly',
  trim: 'ignoring spaces at either end',
  caseless: 'ignoring case',
  email: 'by email address',
  domain: 'by web domain',
  name: 'by name, ignoring case and punctuation',
  slug: 'by slug',
  phone: 'by phone number',
  externalId: 'by external ID',
  aglynId: `by ${PLATFORM_BRAND_NAME} ID`,
  instant: 'at the same moment, to the minute',
}

/** A field value as one line of text. */
export function displayTransferValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => displayTransferValue(item)).join(', ')
      : '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A row number as a person counts: the first data row is row 1. */
export function rowNumber(index: number): number {
  return index + 1
}

/** `n thing` or `n things`. */
export function countOf(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}
