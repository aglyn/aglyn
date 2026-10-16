// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.crm

import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals

/** A deal's row names its stage, never the stage's id: the Deals list and a contact's Deals card read it from the pipelines. */
class CrmDealStageTest {
  private val scope = CrmScope("o1", "h1", "h1", "u1", "owner", true, listOf("org", "host:h1"), listOf("host:h1"), true, emptyMap())

  private fun reference(pipelines: List<Pipeline>) = CrmReference(emptyList(), Picklists(emptyMap()), emptyList(), pipelines, emptyList(), emptyList())

  private fun deal(vararg fields: Pair<String, Any?>) = crmRow(CrmKind.DEAL, FirestoreDoc("d1", "orgs/o1/deals/d1", mapOf("title" to "Weekly bread", "amountCents" to 1_250_000L, *fields)), scope)

  @Test
  fun aDealRowNamesItsStageFromItsPipeline() {
    val custom = Pipeline("wholesale", "Wholesale", listOf(Stage("tasting", "Tasting booked", 1, 20, "open", null)), isDefault = false, archived = false)
    val withPipelines = reference(listOf(custom))
    assertEquals("$12,500 · Proposal/Price Quote", deal("pipelineId" to "default", "stageId" to "proposal-price-quote").listSubtitle(withPipelines))
    assertEquals("$12,500 · Tasting booked", deal("pipelineId" to "wholesale", "stageId" to "tasting").listSubtitle(withPipelines))
    // No pipeline named: the one a deal falls back to.
    assertEquals("$12,500 · Negotiation/Review", deal("stageId" to "negotiation-review").listSubtitle(reference(emptyList())))
    // A stage no pipeline has keeps its id rather than vanishing.
    assertEquals("$12,500 · gone", deal("pipelineId" to "default", "stageId" to "gone").listSubtitle(withPipelines))
  }
}
