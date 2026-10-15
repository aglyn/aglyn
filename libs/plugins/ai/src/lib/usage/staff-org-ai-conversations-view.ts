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

import type {
  StaffAiAssistRow,
  StaffAiConversationPerson,
  StaffAiJobResult,
  StaffAiJobRow,
} from './staff-org-ai-conversations'

/*
 * THE AI REQUESTS CARD, AS IT PRINTS (AGL-3667).
 *
 * The staff card lists what people typed to Aglyn AI and what came back. The
 * words themselves are the rows' own; what the card adds is who asked (an
 * email, else a name, else the uid), the chips under each row (the route and
 * model and cost of an Assist turn, the kind and status and credits of a job),
 * the fields filled in beside a brief, the result a job kept, and what it made.
 * The staff apps read the same rows through
 * `/api/ai/admin/conversations?view=prepared`, which sends each row with that
 * `view`, so those lines are decided once, and the card imports them too.
 */

export const who = (person: StaffAiConversationPerson): string =>
  person.email ?? person.name ?? (person.uid ? `uid ${person.uid}` : 'Unknown member')

export const money = (value: number | null): string | null =>
  value === null ? null : `$${value.toFixed(value < 1 ? 4 : 2)}`

/** What a job kept beside it, as the label above it and the words under it. */
export function jobResultText(result: StaffAiJobResult): { label: string; text: string } {
  switch (result.kind) {
    case 'insight':
      return {
        label: 'Answer',
        text: [...result.insights, ...(result.gap ? [`Not answered: ${result.gap}`] : [])].join('\n\n'),
      }
    case 'crm-record':
      return {
        label: 'Summary',
        text: [result.summary, result.standing, result.nextStep ? `Next step: ${result.nextStep}` : null]
          .filter(Boolean)
          .join('\n\n'),
      }
    case 'crm-email':
      return { label: 'Email draft', text: `Subject: ${result.subject}\n\n${result.body}` }
    case 'crm-mapping':
      return { label: 'Column matches', text: result.matches.join('\n') }
  }
}

/** The chips under an Assist turn: where it was asked, the model, the cost, the thumbs. */
export function assistChips(row: StaffAiAssistRow): string[] {
  return [row.route, row.model, money(row.estCostUsd), row.feedback ? `Rated ${row.feedback}` : null].filter(
    (chip): chip is string => Boolean(chip),
  )
}

/** The chips under a job: its kind, its status, what it spent. */
export function jobChips(row: StaffAiJobRow): string[] {
  return [row.kind, row.status, `${row.credits.toLocaleString('en-US')} credits`]
}

/** What a job made, one line each. */
export function jobMadeText(row: StaffAiJobRow): string {
  return row.outputs.map((output) => [output.label, output.note].filter(Boolean).join(' — ')).join('\n')
}

/** The fields filled in beside a brief, one line each. */
export function jobFilledInText(row: StaffAiJobRow): string {
  return (row.inputs ?? []).map((input) => `${input.label}: ${input.value}`).join('\n')
}

export interface StaffAiRowView {
  who: string
  /** The chips joined into the one line under a list row. */
  meta: string
  chips: string[]
  /** Empty for an Assist turn and for a job with nothing filled in. */
  filledIn: string
  resultLabel: string
  /** Empty when the kind keeps nothing beside the job, or the result has expired. */
  resultText: string
  made: string
}

export function staffAiAssistRowView(row: StaffAiAssistRow): StaffAiRowView {
  const chips = assistChips(row)
  return { who: who(row.by), meta: chips.join(' · '), chips, filledIn: '', resultLabel: '', resultText: '', made: '' }
}

export function staffAiJobRowView(row: StaffAiJobRow): StaffAiRowView {
  const chips = jobChips(row)
  const result = row.result ? jobResultText(row.result) : null
  return {
    who: who(row.by),
    meta: chips.join(' · '),
    chips,
    filledIn: jobFilledInText(row),
    resultLabel: result?.label ?? '',
    resultText: result?.text ?? '',
    made: jobMadeText(row),
  }
}

/** A page with each row's `view` beside it. */
export function withRowViews<T extends { kind: 'assist' | 'jobs'; rows: StaffAiAssistRow[] | StaffAiJobRow[] }>(
  page: T,
): T {
  return {
    ...page,
    rows:
      page.kind === 'assist'
        ? (page.rows as StaffAiAssistRow[]).map((row) => ({ ...row, view: staffAiAssistRowView(row) }))
        : (page.rows as StaffAiJobRow[]).map((row) => ({ ...row, view: staffAiJobRowView(row) })),
  }
}
