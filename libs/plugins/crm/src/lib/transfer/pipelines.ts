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
 * PIPELINES AND FIELD DEFINITIONS, AS FILES (AGL-3528) — `crm.pipelines`
 * and `crm.fields`, exported.
 *
 * The shape of the CRM rather than its records: each pipeline with its
 * stages in order (one row per stage — its kind, its probability, its
 * forecast category), and every custom field the organization defined, on
 * which kind of record, of what type, with its choices. Taken out to
 * document a setup or to rebuild it elsewhere; both are edited on their
 * own pages, so neither is imported (`directions: ["export"]`).
 *=========================================*/

import {
  CRM_COLLECTIONS,
  CRM_FIELD_OBJECT_LABELS,
  CRM_FORECAST_CATEGORY_LABELS,
  type ContactFieldDefinition,
  type CrmDealStage,
  type CrmPipeline,
  dealStageForecastCategory,
  fieldDefinitionObject,
  isPipelineArchived,
} from '@aglyn/aglyn/server'
import { TRANSFER_ID_FIELD, matchLookupKey } from '@aglyn/aglyn/data-transfer'
import type {
  TransferReadOptions,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  crmTransferEnv,
  type CrmTransferEnv,
  isoOf,
  pickValues,
  requireCrmRecords,
  textOf,
  type TransferExportHooks,
  visibleIn,
} from './common'
import {
  CRM_TIMESTAMP_FIELDS,
  FIELD_DEFINITION_TRANSFER_FIELDS,
  PIPELINE_TRANSFER_FIELDS,
  PIPELINE_TRANSFER_GROUPS,
} from './fields'

/** How a stage's kind reads in a file. */
const STAGE_KINDS: Readonly<Record<string, string>> = { open: 'Open', won: 'Won', lost: 'Lost' }

/** How a custom field's type reads in a file. */
const FIELD_TYPES: Readonly<Record<string, string>> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  url: 'Link',
}

/** A whole collection as rows, read once: what these small exports page over. */
interface RowSource {
  rows(env: CrmTransferEnv, options: TransferReadOptions | undefined): Promise<Array<Record<string, unknown>>>
}

/** Pages `rows` by offset, honoring a selection by row id. */
function pagedHooks(source: RowSource): Pick<TransferExportHooks, 'count' | 'readPage' | 'lookup' | 'matchKeys'> {
  const selected = async (ctx: TransferResourceContext, options: TransferReadOptions | undefined) => {
    const env = await crmTransferEnv(ctx)
    requireCrmRecords(env, 'the CRM’s setup')
    const rows = await source.rows(env, options)
    const ids = options?.ids ? new Set(options.ids) : null
    return ids ? rows.filter((row) => ids.has(String(row[TRANSFER_ID_FIELD]))) : rows
  }
  return {
    matchKeys: [{ fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' }],
    async count(ctx, options) {
      return (await selected(ctx, options)).length
    },
    async readPage(ctx, cursor, fieldIds, options) {
      const rows = await selected(ctx, options)
      const start = Number(cursor ?? 0) || 0
      const size = Math.min(options?.pageSize ?? 500, 500)
      return {
        rows: rows.slice(start, start + size).map((row) => pickValues(row, fieldIds)),
        next: start + size < rows.length ? String(start + size) : null,
      }
    },
    async lookup(ctx, requests) {
      const rows = await selected(ctx, undefined)
      const lookup = new Map<string, string[]>()
      const records = new Map<string, Readonly<Record<string, unknown>>>()
      for (const request of requests) {
        if (request.fieldId !== TRANSFER_ID_FIELD) continue
        for (const value of request.values) {
          const row = rows.find((entry) => entry[TRANSFER_ID_FIELD] === value)
          if (!row) continue
          lookup.set(matchLookupKey(request.fieldId, value), [value])
          records.set(value, row)
        }
      }
      return { lookup, records }
    },
  }
}

/** One row per stage, pipeline by pipeline, in the order the board shows them. */
const PIPELINE_ROWS: RowSource = {
  async rows(env, options) {
    const snapshot = await env.orgRef.collection(CRM_COLLECTIONS.pipelines).get()
    return snapshot.docs
      .map((doc) => ({ id: doc.id, pipeline: doc.data() as CrmPipeline }))
      .filter((entry) => visibleIn(env, entry.pipeline.visibleTo, options?.scopeTokens))
      .sort((a, b) => Number(Boolean(b.pipeline.isDefault)) - Number(Boolean(a.pipeline.isDefault)) || textOf(a.pipeline.name).localeCompare(textOf(b.pipeline.name)))
      .flatMap(({ id, pipeline }) =>
        [...(pipeline.stages ?? [])]
          .sort((a, b) => a.order - b.order)
          .map((stage: CrmDealStage, position) => ({
            pipeline: textOf(pipeline.name) || null,
            pipelineId: id,
            isDefault: pipeline.isDefault === true,
            archived: isPipelineArchived(pipeline),
            stage: textOf(stage.name) || null,
            stageId: stage.id,
            position: position + 1,
            kind: STAGE_KINDS[stage.kind] ?? stage.kind,
            probability: typeof stage.probability === 'number' ? stage.probability : null,
            forecastCategory: CRM_FORECAST_CATEGORY_LABELS[dealStageForecastCategory(stage)],
            createdAt: isoOf(pipeline.createdAt),
            updatedAt: isoOf(pipeline.updatedAt),
            [TRANSFER_ID_FIELD]: `${id}:${stage.id}`,
          })),
      )
  },
}

/** Every custom field, by the record it describes and then its order. */
const FIELD_ROWS: RowSource = {
  async rows(env, options) {
    const snapshot = await env.orgRef.collection(CRM_COLLECTIONS.contactFields).limit(500).get()
    return snapshot.docs
      .map((doc) => ({ id: doc.id, field: doc.data() as ContactFieldDefinition }))
      .filter((entry) => entry.field.key && visibleIn(env, entry.field.visibleTo, options?.scopeTokens))
      .map((entry) => ({ ...entry, object: fieldDefinitionObject(entry.field) }))
      .sort((a, b) => a.object.localeCompare(b.object) || Number(a.field.order ?? 0) - Number(b.field.order ?? 0))
      .map(({ id, field, object }) => ({
        label: textOf(field.label) || field.key,
        key: field.key,
        object: CRM_FIELD_OBJECT_LABELS[object] ?? object,
        type: FIELD_TYPES[field.type] ?? field.type,
        options: Array.isArray(field.options) ? field.options.map(String) : [],
        required: field.required === true,
        position: typeof field.order === 'number' ? field.order : null,
        retired: typeof field.retiredAt === 'number' && field.retiredAt > 0,
        createdAt: isoOf(field.createdAt),
        updatedAt: isoOf(field.updatedAt),
        [TRANSFER_ID_FIELD]: id,
      }))
  },
}

/** The `crm.pipelines` hooks. */
export function pipelinesTransferResource(): TransferExportHooks {
  return {
    fields: () => ({ standard: PIPELINE_TRANSFER_FIELDS, system: CRM_TIMESTAMP_FIELDS, groups: PIPELINE_TRANSFER_GROUPS }),
    ...pagedHooks(PIPELINE_ROWS),
  }
}

/** The `crm.fields` hooks. */
export function fieldDefinitionsTransferResource(): TransferExportHooks {
  return {
    fields: () => ({ standard: FIELD_DEFINITION_TRANSFER_FIELDS, system: CRM_TIMESTAMP_FIELDS }),
    ...pagedHooks(FIELD_ROWS),
  }
}
