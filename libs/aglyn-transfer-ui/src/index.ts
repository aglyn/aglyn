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
 * The import and export UI kit (AGL-3526): the export dialog, the eight-step
 * import wizard, and the pieces both are built from — the diff table, the
 * warning acknowledgements and the choice controls — over the domain-neutral
 * core in `@aglyn/aglyn/data-transfer`.
 *
 * The kit talks to the server only through a `TransferClient` the surface
 * hands it; `createMemoryTransferClient` runs the core in memory for specs,
 * stories and resources with no server half yet.
 */

export * from './lib/transfer-client'
export * from './lib/transfer-file'
export * from './lib/transfer-words'
export * from './lib/transfer-wizard-state'
export * from './lib/transfer-wizard-steps'
export * from './lib/memory-transfer-client'
export {
  TransferChoiceSelect,
  type TransferChoiceOption,
  type TransferChoiceSelectProps,
} from './lib/transfer-choice-select.component'
export {
  TransferDiffTable,
  VERDICT_COLORS,
  planRowsToDiffRows,
  type TransferDiffChange,
  type TransferDiffFilter,
  type TransferDiffRow,
  type TransferDiffTableProps,
} from './lib/transfer-diff-table.component'
export {
  TransferAcknowledgementList,
  transferWarningItems,
  type TransferAcknowledgementItem,
  type TransferAcknowledgementListProps,
} from './lib/transfer-acknowledgement-list.component'
export {
  TransferFieldPicker,
  type TransferFieldPickerProps,
} from './lib/transfer-field-picker.component'
export {
  TransferExportDialog,
  downloadTransferFile,
  type TransferExportDialogProps,
} from './lib/transfer-export-dialog.component'
export {
  TransferWizardNav,
  type TransferWizardNavProps,
} from './lib/transfer-wizard-nav.component'
export {
  TransferImportWizard,
  type TransferImportWizardProps,
} from './lib/transfer-import-wizard.component'
export type { TransferImportMappingZone } from './lib/import-mapping-step.component'
export { transferResultsCsv } from './lib/import-results-step.component'
export {
  useTransferImportWizard,
  type TransferApplyState,
  type TransferImportWizardController,
  type UseTransferImportWizardOptions,
} from './lib/use-transfer-import-wizard'
