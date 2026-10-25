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
    "screens" to listOf("ai.jobs", "ai.job", "ai.credits", "ai.member", "ai.staffOrg", "ai.staffUser", "ai.signals", "ai.staffRequests", "ai.requests", "ai.request", "ai.orgsSpendColumn", "ai.hostMember", "ai.allotment", "ai.import.productCopy", "ai.create"),
    "widgets" to listOf(
      "ai.seo-audit", "ai.seo-start", "ai.site-memory",
      "ai.create-page", "ai.create-template", "ai.create-layout", "ai.create-form", "ai.create-component",
      "ai.needs-you", "ai.assist-panel", "ai.insight-ask", "ai.org-insight-ask",
    ),
    "quickActions" to listOf("ai.open"),
    "deepLinks" to listOf("ai.jobs.link", "ai.job.link", "ai.signals.link"),
  )

  @Test
  fun registersExactlyWhatItDeclaresAndItsLinksResolve() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("ai", declared, ::registerAINative)))
    assertEquals(emptyList(), result.failed)
    // What it adds to Setup → SEO and Business profile sits in those pages' slots, and never on Home.
    assertEquals(listOf("ai.seo-audit", "ai.seo-start"), registry.widgets(slot = "hostSeo").map { it.id })
    assertEquals(listOf("ai.site-memory"), registry.widgets(slot = "hostBusinessProfile").map { it.id })
    // "Ask AI about these numbers" is Home's and Analytics' glance on a site, and the workspace Home's card.
    assertEquals(listOf("ai.insight-ask"), registry.widgets().map { it.id })
    assertEquals(listOf("ai.org-insight-ask"), registry.widgets(slot = "orgDashboard").map { it.id })
    // Create with AI is in each list's create zone, under the console's zone names.
    assertEquals(listOf("ai.create-page"), registry.widgets(slot = "hostScreens").map { it.id })
    assertEquals(listOf("ai.create-template"), registry.widgets(slot = "hostTemplates").map { it.id })
    assertEquals(listOf("ai.create-layout"), registry.widgets(slot = "hostLayouts").map { it.id })
    assertEquals(listOf("ai.create-form"), registry.widgets(slot = "hostForms").map { it.id })
    assertEquals(listOf("ai.create-component"), registry.widgets(slot = "hostComponents").map { it.id })
    assertEquals("Create with AI", registry.screen("ai.create")?.title)
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

  private val auditJobs = kotlinx.serialization.json.Json.parseToJsonElement(
    """{"jobs":[
      {"id":"s2","kind":"seo","hostId":"other","status":"done","outputs":[{"resource":"seo","proposal":{"kind":"audit","pages":[],"queue":[],"batchSize":3,"siteProposal":false}}]},
      {"id":"s1","kind":"seo","hostId":"h1","status":"running","creditsSpent":4,"outputs":[
        {"resource":"seo","proposal":{"kind":"audit","pages":[
          {"screenId":"p1","name":"Home","path":"/","versionId":"v1"},
          {"screenId":"p2","name":"About","path":"/about","versionId":null},
          {"screenId":"p3","name":"Menu","path":"/menu","versionId":"v3"}],"queue":["p1","p2","p3"],"batchSize":2,"siteProposal":true}},
        {"resource":"seo","proposal":{"kind":"fixes","batch":1,"fixes":[
          {"screenId":"p1","values":{"title":"Home | Joe","description":"Fresh bread."},"content":[{"kind":"image-alt","nodeId":"a","alt":"Loaf"},{"kind":"image-alt","nodeId":"b","alt":"Oven"},{"kind":"h1-insert","text":"Joe's"}],"guidance":["Add a link to About."]},
          {"screenId":"p2","values":{},"content":[],"guidance":[]}]}},
        {"resource":"seo","proposal":{"kind":"site","site":{"values":{"seo.entity.type":"1","seo.agent.whenToUse":"Order bread."},"llmsPreview":"# Joe","notes":["From your pages."]}}},
        {"resource":"page","proposal":{"kind":"audit"}}
      ]}
    ]}""",
  )

  @Test
  fun anAuditIsPutBackTogetherFromAJobsOutputs() {
    val (job, view) = aiLatestSeoAudit(auditJobs, "h1")!!
    assertEquals("s1", (job["id"] as kotlinx.serialization.json.JsonPrimitive).content)
    assertEquals(listOf("p1", "p2", "p3"), view.pages.map { it.screenId })
    assertEquals(null, view.pages[1].versionId)
    assertEquals(1, view.batches)
    // Two pages a batch, three queued: two batches are owed and one is in, so the audit is not complete.
    assertEquals(2, view.owedBatches)
    assertEquals(false, view.complete)
    assertEquals(listOf("p1", "p2"), view.fixes.keys.toList())
    assertEquals("# Joe", view.site?.llmsPreview)
    assertEquals(1 to 1, aiSeoApplyCounts(view))
    assertEquals("Title: Home | Joe · Description: Fresh bread. · 2 image descriptions · One main heading · Add a link to About.", aiSeoFixSummary(view.fixes["p1"]))
    assertEquals("", aiSeoFixSummary(view.fixes["p2"]))
    assertEquals("", aiSeoFixSummary(null))
    assertEquals(null, aiLatestSeoAudit(auditJobs, "nobody"))
  }

  @Test
  fun aFinishedAuditIsCompleteOnlyWithEveryBatchAndTheSiteProposal() {
    fun view(batches: Int, site: Boolean) = AiSeoAuditView(emptyList(), listOf("a", "b", "c"), 2, true, emptyMap(), if (site) AiSeoSiteProposal(emptyMap(), "", emptyList()) else null, batches)
    assertEquals(false, view(2, false).complete)
    assertEquals(false, view(1, true).complete)
    assertEquals(true, view(2, true).complete)
    assertEquals(true, AiSeoAuditView(emptyList(), emptyList(), 2, false, emptyMap(), null, 0).complete)
  }

  @Test
  fun theAppliedAnswerIsReadForItsDraftsAndWhatWasSkipped() {
    val result = aiSeoApplyResultOf(
      kotlinx.serialization.json.Json.parseToJsonElement(
        """{"job":{},"versions":[{"screenId":"p1","versionId":"v9","name":"Home","fixes":3},{"screenId":"x"}],"staged":["p1","p2"],"skipped":[{"screenId":"p3","reason":"Already has a draft"}]}""",
      ),
    )
    assertEquals(listOf(AiSeoApplyResult.AppliedVersion("p1", "v9", "Home")), result.versions)
    assertEquals(listOf("p1", "p2"), result.staged)
    assertEquals(listOf("p3" to "Already has a draft"), result.skipped)
    assertEquals(emptyList(), aiSeoApplyResultOf(null).versions)
  }

  @Test
  fun aJobEndsOnADoneFailedOrCanceledStatus() {
    fun job(status: String) = kotlinx.serialization.json.Json.parseToJsonElement("""{"id":"j","status":"$status"}""") as kotlinx.serialization.json.JsonObject
    assertEquals(listOf(true, true, true, false, false), listOf("done", "failed", "canceled", "running", "queued").map { aiJobIsTerminal(job(it)) })
    val jobs = kotlinx.serialization.json.Json.parseToJsonElement("""{"jobs":[{"id":"a"},{"id":"b"}]}""")
    assertEquals("b", (aiJobById(jobs, "b")?.get("id") as? kotlinx.serialization.json.JsonPrimitive)?.content)
    assertEquals(null, aiJobById(jobs, "c"))
  }

  // ── Create with AI ──

  private fun json(text: String) = kotlinx.serialization.json.Json.parseToJsonElement(text)

  private val pageDoor = json(
    """{"kind":"page","door":"create","label":"Create with AI","briefMaxChars":4000,
     "copy":{"title":"Describe a page","briefLabel":"What is the page for?","placeholder":"A landing page","next":"A plan comes first.",
             "submit":"Plan the page","started":"The page is being planned.","failed":"The page could not be started. Try again."},
     "choices":[{"key":"pageType","label":"Page type (optional)","required":false,
                 "options":[{"id":"landing","label":"Landing"},{"id":"about","label":"About"}]}],
     "collections":null,"credits":{"text":"6,500 of 7,500 AI credits left this month.","exhausted":false},
     "building":null,"upsell":null}""",
  )

  private val templateDoor = json(
    """{"kind":"template","door":"create","label":"Create with AI","briefMaxChars":4000,
     "copy":{"title":"Describe a page template","briefLabel":"q","placeholder":"x","next":"y","submit":"Plan the template","started":"z","failed":"w"},
     "choices":[{"key":"subject","label":"One page for each (required)","required":true,
                 "options":[{"id":"entry","label":"Collection entry"},{"id":"product","label":"Product"}]}],
     "collections":{"when":"entry","label":"Collection","options":[{"id":"c1","name":"Team"}],"helper":"h"},
     "credits":null,"building":null,"upsell":null}""",
  )

  @Test
  fun theBriefSendsWhatTheConsoleDialogSends() {
    val page = aiCreateDoorOf(pageDoor)!!
    assertEquals(true, page.drawn)
    assertEquals("Plan the page", page.copy?.submit)
    assertEquals("6,500 of 7,500 AI credits left this month.", page.credits?.text)
    // An optional page type: none sends no inputs, a pick sends it, and a value the door did not offer is not sent.
    assertEquals(emptyMap(), aiCreateInputs(page, emptyMap(), null))
    assertEquals(mapOf("pageType" to "about"), aiCreateInputs(page, mapOf("pageType" to "about"), null))
    assertEquals(emptyMap(), aiCreateInputs(page, mapOf("pageType" to "nope"), null))
    assertEquals(
      json("""{"orgId":"o1","hostId":"h1","kind":"page","brief":"A spring offer","inputs":{"pageType":"about"}}"""),
      aiCreateJobBody("o1", "h1", AiCreateKind.PAGE, "  A spring offer  ", mapOf("pageType" to "about")),
    )
    // A template needs its subject, and a collection entry's page its collection.
    val template = aiCreateDoorOf(templateDoor)!!
    assertEquals(null, aiCreateInputs(template, emptyMap(), null))
    assertEquals(mapOf("subject" to "product"), aiCreateInputs(template, mapOf("subject" to "product"), null))
    assertEquals(null, aiCreateInputs(template, mapOf("subject" to "entry"), null))
    assertEquals(null, aiCreateInputs(template, mapOf("subject" to "entry"), "gone"))
    assertEquals(mapOf("subject" to "entry", "collectionId" to "c1"), aiCreateInputs(template, mapOf("subject" to "entry"), "c1"))
    assertEquals(4000, aiCreateClamped("a".repeat(4010), 4000).length)
  }

  @Test
  fun aHiddenDoorDrawsNoEntryAndAnUpsellDoes() {
    val hidden = aiCreateDoorOf(json("""{"kind":"form","door":"hidden","label":"Create with AI","briefMaxChars":4000,"copy":null,"choices":[],"collections":null,"credits":null,"building":null,"upsell":null}"""))!!
    assertEquals(false, hidden.drawn)
    val upsell = aiCreateDoorOf(
      json("""{"kind":"form","door":"upsell","label":"Create with AI","briefMaxChars":4000,"copy":null,"choices":[],"collections":null,"credits":null,"building":null,
        "upsell":{"title":"Create a form with AI","does":"d","offer":"o","canManageBilling":false,"action":null,"dismiss":"Close"}}"""),
    )!!
    assertEquals(true, upsell.drawn)
    assertEquals(null, upsell.upsell?.action)
    assertEquals(null, aiCreateDoorOf(json("""{"nope":true}""")))
  }

  @Test
  fun outOfCreditsIsTheLadderQuotaRefusal() {
    assertEquals(true, aiCreateOutOfCredits(com.aglyn.core.ConsoleApiError("used", 429, json("""{"reason":"quota"}"""))))
    assertEquals(true, aiCreateOutOfCredits(com.aglyn.core.ConsoleApiError("stop", 402, null)))
    assertEquals(false, aiCreateOutOfCredits(com.aglyn.core.ConsoleApiError("slow", 429, json("""{"reason":"rate"}"""))))
    assertEquals(false, aiCreateOutOfCredits(com.aglyn.core.ConsoleApiError("no", 403, null)))
    assertEquals(false, aiCreateOutOfCredits(IllegalStateException("x")))
  }

  @Test
  fun theFollowViewReadsAndOpensTheConsoleAddress() {
    val view = aiFollowViewOf(
      json(
        """{"job":{"id":"j1"},"view":{"id":"j1","kind":"page","status":"needs_review","hostId":"h1","phase":"plan-ready","phaseLabel":"Plan ready",
         "line":{"tone":"warning","text":"Your plan is ready."},"moving":false,"settled":false,"steps":"1 of 2 steps",
         "plan":{"heading":"Proposed plan","lines":["Builds the page Spring offer at /spring"]},"findings":[],"detail":null,
         "estimate":"Estimated cost: About 30 credits (up to 60).","retryRefusal":null,"confirm":{"label":"Confirm plan","enabled":true},
         "building":null,"problem":null,"spent":"Used 4 credits so far.","open":null}}""",
      ),
    )!!
    assertEquals(com.aglyn.ui.StatusTone.WARNING, view.tone)
    assertEquals(listOf("Builds the page Spring offer at /spring"), view.planLines)
    assertEquals("Confirm plan", view.confirmLabel)
    assertEquals(true, view.confirmEnabled)
    assertEquals(null, view.open)
    val done = aiFollowViewOf(
      json(
        """{"view":{"id":"j1","kind":"layout","status":"done","phase":"done","phaseLabel":"Done","line":{"tone":"success","text":"Done."},
         "moving":false,"settled":true,"findings":[],"confirm":null,
         "open":{"label":"Open Site frame","detail":"/acme/hosts/roofs/layouts/l1","besigner":"/acme/hosts/roofs/layouts/l1/versions/v1/besigner"}}}""",
      ),
    )!!
    // The console's own addresses, which the app's link resolver opens natively (and the Besigner in its web view).
    assertEquals(AiFollowView.Open("Open Site frame", "/acme/hosts/roofs/layouts/l1", "/acme/hosts/roofs/layouts/l1/versions/v1/besigner"), done.open)
    assertEquals(true, done.settled)
  }
}

