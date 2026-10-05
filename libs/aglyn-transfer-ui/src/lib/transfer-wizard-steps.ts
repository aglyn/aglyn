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
 * STEPS A PLUGIN ADDS — a consent attestation, a list to add people to.
 *
 * A plugin that owns a resource can put its own step into the import
 * wizard after any built-in step before the review. The step renders what
 * it needs, keeps its answer in the draft's `extras` under its id (sent to
 * the server with the plan), and says what still blocks Next.
 *
 * Steps arrive two ways: the `extraSteps` prop of a wizard a plugin renders
 * itself, or {@link registerTransferWizardStep} from a plugin's console
 * registrar for a wizard another surface renders. The registry lives on
 * `globalThis` under a symbol, so two copies of this module in one page
 * share one list.
 *=========================================*/

import type { ReactNode } from 'react'

import type { TransferAnalysis, TransferResourceInfo } from './transfer-client'
import type {
  TransferWizardDraft,
  TransferWizardStepId,
} from './transfer-wizard-state'

/** What a plugin step is given to render with. */
export interface TransferWizardStepContext {
  resource: TransferResourceInfo
  draft: TransferWizardDraft
  analysis: TransferAnalysis | null
  /** This step's answer, from `draft.extras[step.id]`. */
  value: unknown
  setValue(value: unknown): void
}

/** A step a plugin adds to the import wizard. */
export interface TransferWizardExtraStep {
  /** Unique across steps; the key its answer is kept under. */
  id: string
  label: string
  /** The built-in step it follows. Answers reach the server with the plan, so it comes before the review. */
  after: Exclude<TransferWizardStepId, 'dryRun' | 'apply' | 'results'>
  render(context: TransferWizardStepContext): ReactNode
  /** Sentences that block Next; none means the step is complete. */
  problems?(context: TransferWizardStepContext): string[]
}

const REGISTRY = Symbol.for('aglyn.transfer-ui.wizard-steps')

type StepRegistry = Map<string, TransferWizardExtraStep[]>

function registry(): StepRegistry {
  const holder = globalThis as unknown as Record<
    symbol,
    StepRegistry | undefined
  >
  holder[REGISTRY] ??= new Map()
  return holder[REGISTRY] as StepRegistry
}

/** Adds a step to every import wizard for `resource`; returns the call that removes it. */
export function registerTransferWizardStep(
  resource: string,
  step: TransferWizardExtraStep,
): () => void {
  const steps = registry().get(resource) ?? []
  registry().set(resource, [
    ...steps.filter((entry) => entry.id !== step.id),
    step,
  ])
  return () => {
    registry().set(
      resource,
      (registry().get(resource) ?? []).filter((entry) => entry !== step),
    )
  }
}

/** The steps registered for `resource`, in registration order. */
export function transferWizardStepsFor(
  resource: string,
): TransferWizardExtraStep[] {
  return [...(registry().get(resource) ?? [])]
}

/** The built-in steps with the extra steps placed after the ones they follow. */
export function orderTransferWizardSteps(
  builtIn: readonly { id: TransferWizardStepId; label: string }[],
  extra: readonly TransferWizardExtraStep[],
): { id: string; label: string; extra?: TransferWizardExtraStep }[] {
  return builtIn.flatMap((step) => [
    { id: step.id, label: step.label },
    ...extra
      .filter((entry) => entry.after === step.id)
      .map((entry) => ({ id: entry.id, label: entry.label, extra: entry })),
  ])
}
