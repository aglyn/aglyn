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
 * THE HUB'S WORDS (AGL-3535) — a workspace package's codes as the
 * sentences the Import & export hub shows.
 *=========================================*/

import type {
  PackageItemDecision,
  PackageItemStatus,
  TransferJobStatus,
  TransferPackageDependencyAction,
  TransferPackageItemReason,
  TransferPackageVerdict,
  TransferPackageWarningClass,
} from '@aglyn/aglyn/data-transfer'

export const DECISION_WORDS: Readonly<Record<PackageItemDecision, { label: string; description: string }>> = {
  create: { label: 'Create', description: 'Add it to this workspace.' },
  replace: { label: 'Replace yours', description: 'Write the package’s version over the one you have. Undo puts yours back for seven days.' },
  keepBoth: { label: 'Keep both', description: 'Add it as a copy beside yours, and point the package’s other items at the copy.' },
  skip: { label: 'Skip', description: 'Leave it out; anything in the package that names it uses yours.' },
  merge: { label: 'Merge', description: 'Fill in what yours has not set.' },
}

export const STATUS_WORDS: Readonly<Record<PackageItemStatus, string>> = {
  new: 'New',
  identical: 'Same as yours',
  differs: 'Differs from yours',
  missingDependency: 'Needs something missing',
}

export const VERDICT_WORDS: Readonly<Record<TransferPackageVerdict, string>> = {
  create: 'Creates',
  replace: 'Replaces',
  keepBoth: 'Adds a copy',
  skip: 'Skipped',
  fail: 'Fails',
}

export const REASON_WORDS: Readonly<Record<TransferPackageItemReason, string>> = {
  unknownKind: 'Nothing in this workspace imports this kind — a plugin it does not run.',
  chosen: 'You chose to skip it.',
  identical: 'It is the same as the one you have.',
  missingDependency: 'Something it needs was set to skip what needs it.',
  problems: 'Its plugin would refuse it.',
}

export const DEPENDENCY_WORDS: Readonly<Record<TransferPackageDependencyAction, { label: string; description: string }>> = {
  import: { label: 'Import the package’s copy', description: 'Create the one the package carries.' },
  mapTo: { label: 'Use one you have', description: 'Point every item that names it at one of yours.' },
  dropReference: { label: 'Leave it out', description: 'Remove the reference from every item that names it.' },
  skipItem: { label: 'Skip what needs it', description: 'Skip every item that names it.' },
}

export const PACKAGE_WARNING_WORDS: Readonly<Record<TransferPackageWarningClass, { title: string; description: string }>> = {
  replace: {
    title: 'Items you have are replaced',
    description: 'The items set to Replace are overwritten with the package’s version. Undo puts them back for seven days.',
  },
  dropReference: {
    title: 'References are left out',
    description: 'What you chose to leave out is removed from every item that names it.',
  },
  failed: {
    title: 'Some items are not imported',
    description: 'The items marked Fails are refused by their plugin and are left out; the rest are imported.',
  },
}

export const JOB_STATUS_WORDS: Readonly<Record<TransferJobStatus | 'refused', { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }>> = {
  draft: { label: 'Uploaded', color: 'default' },
  analyzed: { label: 'Being set up', color: 'default' },
  planned: { label: 'Ready to import', color: 'info' },
  applying: { label: 'Importing', color: 'info' },
  applied: { label: 'Imported', color: 'success' },
  failed: { label: 'Stopped', color: 'error' },
  undone: { label: 'Undone', color: 'warning' },
  refused: { label: 'Refused', color: 'error' },
}
