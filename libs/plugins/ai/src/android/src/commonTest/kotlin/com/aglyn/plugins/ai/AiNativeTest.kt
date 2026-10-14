package com.aglyn.plugins.ai

import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class AiNativeTest {
  private val declared = mapOf(
    "screens" to listOf("ai.jobs", "ai.job", "ai.credits", "ai.member", "ai.staffOrg", "ai.staffUser", "ai.signals", "ai.staffRequests", "ai.requests", "ai.request", "ai.orgsSpendColumn", "ai.hostMember", "ai.allotment", "ai.import.productCopy"),
    "widgets" to listOf("ai.seo-start", "ai.site-memory"),
    "quickActions" to listOf("ai.open"),
    "deepLinks" to listOf("ai.jobs.link", "ai.job.link", "ai.signals.link"),
  )

  @Test
  fun registersExactlyWhatItDeclaresAndItsLinksResolve() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("ai", declared, ::registerAINative)))
    assertEquals(emptyList(), result.failed)
    // What it adds to Setup → SEO and Business profile sits in those pages' slots, and never on Home.
    assertEquals(listOf("ai.seo-start"), registry.widgets(slot = "hostSeo").map { it.id })
    assertEquals(listOf("ai.site-memory"), registry.widgets(slot = "hostBusinessProfile").map { it.id })
    assertEquals(emptyList(), registry.widgets().map { it.id })
    val target = DeepLinks.resolve("/acme/hosts/shop/ai-jobs/j1", registry.deepLinks())
    assertIs<NativeLinkTarget.Screen>(target)
    assertEquals("ai.job", target.screen)
    assertEquals("j1", target.params["jobId"])
  }

  @Test
  fun aStoredPreferenceIsReadAsTheConsoleReadsIt() {
    val long = "x".repeat(200)
    val read = aiSitePreferenceOf("tone-casual", mapOf("text" to "  Prefers a casual tone  ", "count" to 3L, "lastSeenAtMs" to 1700000000000.0))
    assertEquals(AiSitePreference("tone-casual", "Prefers a casual tone", 3, 1700000000000.0), read)
    assertEquals(120, aiSitePreferenceOf("a", mapOf("text" to long))?.text?.length)
    // A count that is not a positive number is one edit; a missing time is the epoch.
    assertEquals(1, aiSitePreferenceOf("a", mapOf("text" to "t", "count" to 0L))?.count)
    assertEquals(1, aiSitePreferenceOf("a", mapOf("text" to "t", "count" to "many"))?.count)
    assertEquals(2, aiSitePreferenceOf("a", mapOf("text" to "t", "count" to 2.7))?.count)
    assertEquals(0.0, aiSitePreferenceOf("a", mapOf("text" to "t"))?.lastSeenAtMs)
    // A row with no words, or none at all, is not a preference.
    assertEquals(null, aiSitePreferenceOf("a", mapOf("text" to "   ")))
    assertEquals(null, aiSitePreferenceOf("a", null))
    assertEquals("Seen in 1 applied edit", aiSitePreferenceSeen(1))
    assertEquals("Seen in 4 applied edits", aiSitePreferenceSeen(4))
  }

  @Test
  fun preferencesListMostRepeatedThenMostRecent() {
    val rows = listOf(
      com.aglyn.core.FirestoreDoc("a", "hosts/h/aiMemory/a", mapOf("text" to "A", "count" to 1L, "lastSeenAtMs" to 5.0)),
      com.aglyn.core.FirestoreDoc("b", "hosts/h/aiMemory/b", mapOf("text" to "B", "count" to 3L, "lastSeenAtMs" to 1.0)),
      com.aglyn.core.FirestoreDoc("c", "hosts/h/aiMemory/c", mapOf("text" to "C", "count" to 1L, "lastSeenAtMs" to 9.0)),
      com.aglyn.core.FirestoreDoc("d", "hosts/h/aiMemory/d", mapOf("count" to 9L)),
    )
    assertEquals(listOf("b", "c", "a"), aiSitePreferences(rows).map { it.id })
  }

  private val jobs = kotlinx.serialization.json.Json.parseToJsonElement(
    """{"jobs":[
      {"id":"j3","kind":"seo","hostId":"h1","outputs":[]},
      {"id":"j2","kind":"site","hostId":"other","outputs":[{"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Other","seo.description":"Other site"}}}]},
      {"id":"j1","kind":"site","hostId":"h1","outputs":[
        {"resource":"page","proposal":{}},
        {"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Hair by Ana","seo.description":"Cuts and color in Austin."},"notes":["Written from your answers."]}}]},
      {"id":"j0","kind":"site","hostId":"h1","outputs":[{"resource":"seo","proposal":{"kind":"site-listing","values":{"seo.title":"Old","seo.description":"Older"}}}]}
    ]}""",
  )

  @Test
  fun theLatestGuidedStartListingIsFoundForThisSite() {
    val (jobId, proposal) = aiLatestSiteListing(jobs, "h1")!!
    assertEquals("j1", jobId)
    assertEquals(AiSiteSeoProposal("Hair by Ana", "Cuts and color in Austin.", listOf("Written from your answers.")), proposal)
    assertEquals(mapOf("seo.title" to "Hair by Ana", "seo.description" to "Cuts and color in Austin."), proposal.values)
    assertEquals(null, aiLatestSiteListing(jobs, "nobody"))
    assertEquals(null, aiLatestSiteListing(null, "h1"))
  }

  @Test
  fun aProposalWithoutTwoWordsIsNoProposal() {
    fun outputs(values: String) = kotlinx.serialization.json.Json.parseToJsonElement("""[{"resource":"seo","proposal":{"kind":"site-listing","values":$values}}]""")
    assertEquals(null, aiSiteSeoProposalOf(outputs("""{"seo.title":"T"}""")))
    assertEquals(null, aiSiteSeoProposalOf(outputs("""{"seo.title":"T","seo.description":"  "}""")))
    assertEquals(null, aiSiteSeoProposalOf(outputs("""{"seo.title":1,"seo.description":"D"}""")))
    assertEquals("T", aiSiteSeoProposalOf(outputs("""{"seo.title":"T","seo.description":"D"}"""))?.title)
  }

  @Test
  fun aListingTheSettingsAlreadySayIsNotOfferedAgain() {
    val proposal = AiSiteSeoProposal("Hair by Ana", "Cuts and color.", emptyList())
    assertEquals(true, aiSiteSeoAlreadySaid(proposal, mapOf("title" to " Hair by Ana ", "description" to "Cuts and color.")))
    // One of two matching still leaves something to take.
    assertEquals(false, aiSiteSeoAlreadySaid(proposal, mapOf("title" to "Hair by Ana", "description" to "Rewritten")))
    assertEquals(false, aiSiteSeoAlreadySaid(proposal, null))
  }
}
