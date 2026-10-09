package com.aglyn.plugins.funnels

import com.aglyn.contracts.DropOffAction
import com.aglyn.contracts.FunnelDefinition
import com.aglyn.contracts.FunnelInventory
import com.aglyn.contracts.FunnelInventoryItem
import com.aglyn.contracts.FunnelPageMatch
import com.aglyn.contracts.FunnelResult
import com.aglyn.contracts.FunnelStep
import com.aglyn.contracts.SiteJourneyStepType
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val INVENTORY = FunnelInventory(
  forms = listOf(FunnelInventoryItem("f1", "Contact")),
  overlays = emptyList(),
  pages = listOf("/", "/pricing"),
  products = emptyList(),
  services = listOf(FunnelInventoryItem("s1", "Intro call")),
)

private class FakeApi : FunnelsApi {
  val calls = mutableListOf<String>()
  val saved = mutableListOf<FunnelDefinition>()
  var fail: Throwable? = null
  var recordingChanged = false
  var proposal = FunnelProposal(FunnelDefinition("Idea", listOf(FunnelStep("/pricing", match = FunnelPageMatch.EXACT, type = SiteJourneyStepType.PAGE), FunnelStep("s1", type = SiteJourneyStepType.BOOKING))), listOf("No page at /nope"))

  private fun check() { fail?.let { throw it } }
  override suspend fun inventory(): FunnelInventory { calls += "inventory"; check(); return INVENTORY }
  override suspend fun result(funnelId: String, from: String, to: String, fresh: Boolean): FunnelResult { calls += "result $funnelId $from $to $fresh"; check(); error("unused") }
  override suspend fun save(funnel: FunnelDefinition, funnelId: String?): FunnelSaved { calls += "save $funnelId"; check(); saved += funnel; return FunnelSaved(funnelId ?: "new1", recordingChanged) }
  override suspend fun activate(funnelId: String): FunnelSaved { calls += "activate $funnelId"; check(); return FunnelSaved(funnelId, recordingChanged) }
  override suspend fun delete(funnelId: String): FunnelSaved { calls += "delete $funnelId"; check(); return FunnelSaved(funnelId, recordingChanged) }
  override suspend fun propose(brief: String): FunnelProposal { calls += "propose $brief"; check(); return proposal }
  override suspend fun draftDropOff(funnelId: String, step: Int, afterHours: Int, action: DropOffAction): DropOffDrafted {
    calls += "act $funnelId $step $afterHours ${action.raw}"; check(); return DropOffDrafted("a1", "Follow up: Signup step 1", false)
  }
  override suspend fun announceSiteWide() { calls += "announce" }
}

private fun row(id: String = "fn1", draft: Boolean = false) = FunnelRow(
  id,
  FunnelDefinition("Signup", listOf(FunnelStep("/pricing", match = FunnelPageMatch.EXACT, type = SiteJourneyStepType.PAGE), FunnelStep("f1", type = SiteJourneyStepType.FORM))),
  draft,
)

class FunnelsNativeTest {
  @Test
  fun registersEveryDeclaredId() {
    val registry = NativePluginRegistry()
    val declared = mapOf("screens" to listOf(FUNNELS_LIST_SCREEN), "quickActions" to listOf("funnels.open"), "deepLinks" to listOf("funnels.page"))
    val result = registry.load(listOf(NativePluginManifestEntry("funnels", declared, ::registerFunnelsNative)))
    assertEquals(listOf("funnels"), result.loaded, result.failed.toString())
    assertTrue(registry.screen(FUNNELS_LIST_SCREEN)!!.requiresSite)
    assertEquals("/funnels", registry.deepLinks().single().path)
  }

  @Test
  fun aStoredFunnelReadsAsTheCardReadsIt() {
    val doc = FirestoreDoc(
      "fn1",
      "hosts/h/funnels/fn1",
      mapOf(
        "name" to "Signup",
        "status" to "draft",
        "createdAt" to 5L,
        "steps" to listOf(
          mapOf("type" to "page", "key" to "/pricing", "match" to "prefix"),
          mapOf("type" to "form", "key" to "f1", "label" to "Contact"),
        ),
      ),
    )
    val parsed = assertNotNull(FunnelRow.from(doc))
    assertTrue(parsed.draft)
    assertEquals(2, parsed.steps.size)
    assertEquals(FunnelPageMatch.PREFIX, parsed.steps[0].match)
  }

  @Test
  fun aDocumentThatIsNotAValidFunnelIsDropped() {
    val one = FirestoreDoc("a", "hosts/h/funnels/a", mapOf("name" to "One step", "steps" to listOf(mapOf("type" to "page", "key" to "/"))))
    val future = FirestoreDoc("b", "hosts/h/funnels/b", mapOf("name" to "Future", "steps" to listOf(mapOf("type" to "page", "key" to "/"), mapOf("type" to "hologram", "key" to "x"))))
    assertNull(FunnelRow.from(one))
    assertNull(FunnelRow.from(future))
  }

  @Test
  fun funnelsListByNameWithoutCase() {
    val names = inListOrder(listOf(row("1").copy(definition = row().definition.copy(name = "beta")), row("2").copy(definition = row().definition.copy(name = "Alpha")))).map { it.name }
    assertEquals(listOf("Alpha", "beta"), names)
  }

  @Test
  fun aRangeEndsTodayInUtcDays() {
    // 2026-10-08T12:00:00Z
    val now = 1_791_460_800_000L
    assertEquals("2026-10-02" to "2026-10-08", recentRange(7, now))
    assertEquals("2026-07-11" to "2026-10-08", recentRange(90, now))
  }

  @Test
  fun accessFollowsTheRoleAndThePaidTier() {
    val pro = mapOf("plan" to "pro")
    assertTrue(funnelsAccess("admin", pro, true).canManage)
    assertTrue(funnelsAccess("editor", pro, true).entitled)
    assertFalse(funnelsAccess("author", pro, true).canManage)
    assertFalse(funnelsAccess("admin", mapOf("plan" to "starter"), true).entitled)
    assertFalse(funnelsAccess("admin", pro, false).entitled)
  }

  @Test
  fun aNewFunnelOpensOnTheSitesFirstPageThenAnyForm() = runTest {
    val editor = FunnelsEditor(FakeApi(), this)
    editor.add()
    advanceUntilIdle()
    val steps = editor.draft!!.steps
    assertEquals(listOf(SiteJourneyStepType.PAGE, SiteJourneyStepType.FORM), steps.map { it.type })
    assertEquals("/", steps[0].key)
    assertEquals("", steps[1].key)
  }

  @Test
  fun aSaveMakesTheConsolesChecksThenSavesLabelledSteps() = runTest {
    val api = FakeApi().apply { recordingChanged = true }
    val editor = FunnelsEditor(api, this)
    editor.add()
    advanceUntilIdle()
    editor.change(editor.draft!!.copy(name = " Signup ", steps = listOf(StepDraft(SiteJourneyStepType.PAGE, "pricing/"), StepDraft(SiteJourneyStepType.FORM, "f1"))))
    editor.save()
    advanceUntilIdle()
    assertEquals(listOf("inventory", "save null", "announce"), api.calls)
    val funnel = api.saved.single()
    assertEquals("Signup", funnel.name)
    assertEquals("/pricing", funnel.steps[0].key)
    assertEquals("Contact", funnel.steps[1].label)
    assertNull(editor.draft)
    assertEquals("Signup saved.", editor.notice)
  }

  @Test
  fun aStepTheSiteDoesNotHaveStopsTheSaveInTheCardsWords() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.add()
    advanceUntilIdle()
    editor.change(editor.draft!!.copy(name = "Signup", steps = listOf(StepDraft(SiteJourneyStepType.PAGE, "/pricing"), StepDraft(SiteJourneyStepType.PAGE, "/gone"))))
    editor.save()
    advanceUntilIdle()
    assertEquals("Step 2: This site has no page at /gone.", editor.error)
    assertFalse(api.calls.any { it.startsWith("save") })
    assertNotNull(editor.draft)
  }

  @Test
  fun aDraftWithTooFewStepsIsRefusedBeforeAnyCall() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.edit(row())
    advanceUntilIdle()
    editor.change(editor.draft!!.copy(steps = listOf(StepDraft(SiteJourneyStepType.PAGE, "/"))))
    editor.save()
    advanceUntilIdle()
    assertEquals("A funnel has 2 to 8 steps.", editor.error)
    assertEquals(listOf("inventory"), api.calls)
  }

  @Test
  fun anEditKeepsTheFunnelsId() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.edit(row("fn9"))
    advanceUntilIdle()
    editor.save()
    advanceUntilIdle()
    assertTrue("save fn9" in api.calls)
  }

  @Test
  fun aRefusalFromTheDoorKeepsTheEditorOpenInItsWords() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.edit(row())
    advanceUntilIdle()
    api.fail = ConsoleApiError("A site admin or editor changes what a site measures.", 403, null)
    editor.save()
    advanceUntilIdle()
    assertEquals("A site admin or editor changes what a site measures.", editor.error)
    assertNotNull(editor.draft)
  }

  @Test
  fun activatingADraftSaysItIsMeasuredAndAnnouncesARecordingChange() = runTest {
    val api = FakeApi().apply { recordingChanged = true }
    val editor = FunnelsEditor(api, this)
    editor.activate(row(draft = true))
    advanceUntilIdle()
    assertEquals(listOf("activate fn1", "announce"), api.calls)
    assertEquals("Signup is live. It is measured from now on.", editor.notice)
  }

  @Test
  fun deleteAsksFirstThenRemoves() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.askDelete(row())
    assertEquals("fn1", editor.deleting?.id)
    editor.confirmDelete()
    advanceUntilIdle()
    assertEquals(listOf("delete fn1"), api.calls)
    assertNull(editor.deleting)
  }

  @Test
  fun createWithAiOpensTheEditorOnTheProposalAndNamesWhatItLeftOut() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.askPropose()
    editor.propose("   ")
    assertEquals("Describe the funnel first.", editor.error)
    editor.propose("pricing then a call")
    advanceUntilIdle()
    assertFalse(editor.proposing)
    assertEquals("Idea", editor.draft!!.name)
    assertNull(editor.draft!!.id)
    assertEquals("Left out, because the site has no match: No page at /nope", editor.notice)
  }

  @Test
  fun actOnADropOffDraftsTheAutomationSwitchedOff() = runTest {
    val api = FakeApi()
    val editor = FunnelsEditor(api, this)
    editor.askDropOff(DropOffRequest("fn1", 1, "Viewed a page: /pricing", "Submitted a form: f1"))
    editor.draftDropOff(24, DropOffAction.TASK)
    advanceUntilIdle()
    assertEquals(listOf("act fn1 1 24 task"), api.calls)
    assertNull(editor.dropOff)
    assertEquals("Follow up: Signup step 1 is drafted, switched off. Switch it on under Automation when it reads right.", editor.notice)
  }

  @Test
  fun theWaitsTheCardOffers() {
    assertEquals(listOf(1, 24, 72, 168), dropOffWaits())
  }
}
