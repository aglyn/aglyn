package com.aglyn.plugins.crm

import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The bar over a CRM list decides what it writes and what it names as the console's bulk bars do. */
class CrmBulkTest {
  private fun row(id: String, tags: List<String> = emptyList(), company: String? = null, status: String? = null, converted: Boolean = false) =
    CrmBulkRow(id, "$id@example.com", tags = tags, companyId = company, status = status, converted = converted)

  @Test
  fun eachListOffersTheConsolesActsInOrder() {
    assertEquals(
      listOf(CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG, CrmBulkAction.OWNER, CrmBulkAction.STAGE, CrmBulkAction.COMPANY, CrmBulkAction.REMOVE_FROM_SITE),
      crmBulkActions(CrmKind.CONTACT, workspaceWide = false),
    )
    // At the workspace's level there is no site to remove a person from.
    assertEquals(CrmBulkAction.COMPANY, crmBulkActions(CrmKind.CONTACT, workspaceWide = true).last())
    assertEquals(listOf(CrmBulkAction.OWNER, CrmBulkAction.STATUS, CrmBulkAction.UNQUALIFY), crmBulkActions(CrmKind.LEAD, false))
    assertEquals(listOf(CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG, CrmBulkAction.OWNER, CrmBulkAction.DELETE), crmBulkActions(CrmKind.COMPANY, false))
    assertEquals(listOf(CrmBulkAction.STAGE, CrmBulkAction.OWNER, CrmBulkAction.LOST, CrmBulkAction.DELETE), crmBulkActions(CrmKind.DEAL, false))
    assertEquals(listOf(CrmBulkAction.COMPLETE, CrmBulkAction.ASSIGN, CrmBulkAction.DUE, CrmBulkAction.DELETE), CRM_BULK_TASK_ACTIONS)
  }

  @Test
  fun aTagIsNormalizedAsTheConsoleDoes() {
    assertEquals("vip customer", crmBulkTag("  VIP Customer "))
    assertNull(crmBulkTag("   "))
    assertEquals(60, crmBulkTag("a".repeat(80))?.length)
  }

  @Test
  fun addingATagSkipsHoldersSilentlyAndNamesRowsAtTheCap() {
    val full = (0 until CRM_BULK_TAGS_CAP).map { "t$it" }
    val plan = crmBulkPlanAddTag(listOf(row("a", tags = listOf("VIP")), row("b"), row("c", tags = full)), "vip")
    assertEquals(listOf("b"), plan.rows.map { it.id })
    assertEquals(listOf(CrmBulkSkip("c@example.com", "already has 20 tags")), plan.skipped)
    assertEquals(listOf("a"), crmBulkPlanRemoveTag(listOf(row("a", tags = listOf("VIP")), row("b")), "vip").rows.map { it.id })
  }

  @Test
  fun setCompanyLeavesContactsAlreadyFiledThere() {
    assertEquals(listOf("b", "c"), crmBulkPlanSetCompany(listOf(row("a", company = "acme"), row("b", company = "other"), row("c")), "acme").rows.map { it.id })
    assertEquals(listOf("a"), crmBulkPlanSetCompany(listOf(row("a", company = "acme"), row("c")), null).rows.map { it.id })
  }

  @Test
  fun leadStatusAndUnqualifyNameWhatTheyLeave() {
    val label = crmLeadStatusText("working")
    val status = crmBulkPlanLeadStatus(listOf(row("a", status = "new"), row("b", status = "working"), row("c", status = "new", converted = true)), "working", label)
    assertEquals(listOf("a"), status.rows.map { it.id })
    assertEquals(listOf("already $label", "was converted"), status.skipped.map { it.reason })
    val unqualify = crmBulkPlanUnqualify(listOf(row("a", status = "new"), row("b", status = "unqualified"), row("c", converted = true)))
    assertEquals(listOf("a"), unqualify.rows.map { it.id })
    assertEquals(listOf("is already closed", "was converted"), unqualify.skipped.map { it.reason })
  }

  @Test
  fun setStageNeedsOnePipeline() {
    fun deal(pipeline: String?) = CrmBulkRow("d", "Deal", pipelineId = pipeline)
    assertEquals(CrmBulkPipeline(true, "p1"), crmBulkPipeline(listOf(deal("p1"), deal("p1"))))
    assertEquals(CrmBulkPipeline(true, null), crmBulkPipeline(listOf(deal(null))))
    assertEquals(false, crmBulkPipeline(listOf(deal("p1"), deal("p2"))).one)
  }

  @Test
  fun sentencesAndReportsReadAsTheConsoles() {
    val contacts = CrmBulkNoun.of(CrmKind.CONTACT)
    assertEquals("Tagged 1 contact", crmBulkDoneSentence(CrmBulkAction.ADD_TAG, contacts, 1))
    assertEquals("3 contacts removed from this site", crmBulkDoneSentence(CrmBulkAction.REMOVE_FROM_SITE, contacts, 3))
    assertEquals("Owner cleared on 2 leads", crmBulkDoneSentence(CrmBulkAction.OWNER, CrmBulkNoun.of(CrmKind.LEAD), 2, cleared = true))
    assertEquals("Moved 2 deals to Proposal", crmBulkDoneSentence(CrmBulkAction.STAGE, CrmBulkNoun.of(CrmKind.DEAL), 2, named = "Proposal"))
    assertEquals("Deleted 1,200 companies", crmBulkDoneSentence(CrmBulkAction.DELETE, CrmBulkNoun.of(CrmKind.COMPANY), 1200))
    assertEquals("Due date cleared on 1 task", crmBulkDoneSentence(CrmBulkAction.DUE, CrmBulkNoun.TASK, 1, cleared = true))
    assertEquals("Nothing was changed", crmBulkSentence(CrmBulkOutcome(), 2) { "" })
    assertEquals("Nothing to change", crmBulkSentence(CrmBulkOutcome(), 0) { "" })
    assertNull(CrmBulkReport.of(emptyList(), contacts))
    val one = CrmBulkReport.of(listOf(CrmBulkSkip("a@example.com", "not permitted")), contacts)
    assertEquals("One contact was not changed:", one?.heading)
    assertEquals(listOf("a@example.com — not permitted"), one?.lines)
    assertEquals("2 tasks were not changed:", CrmBulkReport.of(listOf(CrmBulkSkip("x", "y"), CrmBulkSkip("z", "w")), CrmBulkNoun.TASK)?.heading)
  }

  @Test
  fun destructiveActsAskInTheConsolesWords() {
    assertEquals("Delete company", crmBulkConfirm(CrmBulkAction.DELETE, CrmBulkNoun.of(CrmKind.COMPANY), 1)?.button)
    assertEquals("Delete 3 deals?", crmBulkConfirm(CrmBulkAction.DELETE, CrmBulkNoun.of(CrmKind.DEAL), 3)?.title)
    assertEquals("Remove contacts", crmBulkConfirm(CrmBulkAction.REMOVE_FROM_SITE, CrmBulkNoun.of(CrmKind.CONTACT), 2)?.button)
    assertEquals("Delete this task?", crmBulkConfirm(CrmBulkAction.DELETE, CrmBulkNoun.TASK, 1)?.title)
    assertNull(crmBulkConfirm(CrmBulkAction.OWNER, CrmBulkNoun.TASK, 1))
  }

  @Test
  fun aBatchNamesEveryRowItDidNotWrite() = runBlocking {
    val rows = listOf(row("a"), row("b"), row("c"))
    val outcome = crmBulkBatch(rows, chunk = 2) { ids ->
      if ("a" in ids) listOf(CrmBulkAnswer("a", true), CrmBulkAnswer("b", false, "not on this site")) else emptyList()
    }
    assertEquals(1, outcome.done)
    assertEquals(listOf(CrmBulkSkip("b@example.com", "not on this site"), CrmBulkSkip("c@example.com", "the write failed")), outcome.refused)
    val whole = crmBulkBatch(rows) { throw ConsoleApiError("You can't edit contacts here.", 403, null) }
    assertEquals(List(3) { "You can't edit contacts here." }, whole.refused.map { it.reason })
  }

  @Test
  fun eachRowsRefusalIsNamed() = runBlocking {
    val outcome = crmBulkEach(listOf(row("a"), row("b"))) { if (it.id == "b") throw ConsoleApiError("", 409, null) }
    assertEquals(CrmBulkOutcome(1, listOf(CrmBulkSkip("b@example.com", "the write failed"))), outcome)
  }

  @Test
  fun routeAnswersAreReadPerContact() {
    val answer = JsonObject(
      mapOf(
        "results" to JsonArray(
          listOf(
            JsonObject(mapOf("contactId" to JsonPrimitive("a"), "ok" to JsonPrimitive(true))),
            JsonObject(mapOf("contactId" to JsonPrimitive("b"), "ok" to JsonPrimitive(false), "error" to JsonPrimitive("no longer exists"))),
          ),
        ),
      ),
    )
    assertEquals(listOf(CrmBulkAnswer("a", true), CrmBulkAnswer("b", false, "no longer exists")), crmBulkAnswers(answer))
  }

  @Test
  fun aContactIsWrittenThroughItsHoldersSite() {
    val org = mapOf(
      "hosts" to mapOf("s1" to true, "s2" to true, "s3" to true),
      "consentGroups" to mapOf("brand" to mapOf("name" to "Brand", "hostIds" to listOf("s2", "s3"))),
    )
    assertEquals("s1", crmHolderSite("s1", org))
    assertEquals("s2", crmHolderSite("brand", org))
    assertNull(crmHolderSite("org", org))
    assertNull(crmHolderSite("", org))
  }
}
