package com.aglyn.plugins.workflows

import com.aglyn.contracts.OrgAutomationRead
import com.aglyn.contracts.readOrgAutomation
import com.aglyn.contracts.siteInteractionDocument
import com.aglyn.contracts.validateHostAction
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreTimestamp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AutomationDataTest {
  private fun doc(id: String, data: Map<String, Any?>, path: String = "hosts/h1/x/$id") = FirestoreDoc(id, path, data)

  @Test
  fun workflowRowsReadAsTheConsoleListsThem() {
    val docs = listOf(
      doc("w2", mapOf("name" to "beta", "steps" to listOf(mapOf("functionName" to "double"), mapOf("type" to "notifyAdmins", "title" to "x")), "trigger" to mapOf("event" to "lead"))),
      doc("w1", mapOf("name" to "Alpha", "steps" to listOf(mapOf("functionName" to "quote")), "trigger" to null)),
      doc("w3", mapOf("name" to "Gone", "steps" to emptyList<Any>(), "deletedAt" to FirestoreTimestamp(1))),
    )
    val rows = visibleWorkflows(docs)
    assertEquals(listOf("Alpha", "beta"), rows.map { it.name })
    assertEquals("1 step · quote", rows[0].caption)
    // An Actions step has no function name, and JavaScript joins it as nothing.
    assertEquals("2 steps · on New lead · double → ", rows[1].caption)
    assertTrue(workflowNameTaken(rows, " alpha ", null))
    assertFalse(workflowNameTaken(rows, "Alpha", "w1"))
  }

  @Test
  fun actionsLeaveElementInteractionsOutAndCountThem() {
    val docs = listOf(
      doc("a1", mapOf("name" to "Zeta", "trigger" to mapOf("event" to "formSubmission"), "steps" to listOf(mapOf("type" to "sendEmail", "subject" to "Hi [name]", "body" to "x")))),
      doc("a2", mapOf("name" to "Menu", "trigger" to mapOf("event" to "elementClick", "selector" to "[data-aglyn=\"leaf:menu\"]"), "steps" to listOf(mapOf("type" to "toggleMenu")))),
      doc("a3", mapOf("name" to "Alpha", "enabled" to false, "trigger" to mapOf("event" to "booking"), "steps" to listOf(mapOf("type" to "wait", "delayMinutes" to 5L), mapOf("type" to "exitFlow")))),
    )
    val list = actionListOf(docs)
    assertEquals(listOf("Alpha", "Zeta"), list.actions.map { it.name })
    assertEquals(1, list.elementInteractions)
    assertEquals("on New booking · Wait → End the flow here", list.actions[0].caption)
    assertFalse(list.actions[0].enabled)
    assertEquals(1, list.actions[1].placeholders)
    assertEquals("1 placeholder to fill in", placeholderLine(1))
    assertEquals("3 placeholders to fill in", placeholderLine(3))
    assertTrue(elementInteractionLine(2)!!.startsWith("2 interactions are set up on their own elements — open the element"))
  }

  @Test
  fun queriesTakeTheConsolesShapes() {
    val ceiling = ceilingQuery("hosts/h1/workflows", WORKFLOW_CEILING)
    assertEquals(101, ceiling.limit)
    assertEquals(listOf(FirestoreOrder("__name__")), ceiling.orderBy)

    val siteOrg = siteOrgAutomationsQuery("o1", "h1")
    assertEquals("orgs/o1/automations", siteOrg.collectionPath)
    assertEquals(
      listOf(FirestoreFilter("deletedAt", FilterOp.EQ, null), FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("org", "host:h1"))),
      siteOrg.filters,
    )
    assertEquals(101, siteOrg.limit)
    assertEquals(listOf(FirestoreOrder("__name__")), orgAutomationsQuery("o1").orderBy)
    assertEquals(listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("org", "host:h1"))), siteDatasetsQuery("o1", "h1").filters)
  }

  @Test
  fun runHistoryQueryScopesToRunsAndGrowsByPage() {
    val first = runHistoryQuery("h1", "w1", RunFilters(), pageSize = 10, page = 0)
    assertEquals("hosts/h1/activity", first.collectionPath)
    assertEquals(
      listOf(FirestoreFilter("target.id", FilterOp.EQ, "w1"), FirestoreFilter("result", FilterOp.IN, listOf("succeeded", "failed", "skipped"))),
      first.filters,
    )
    assertEquals(listOf(FirestoreOrder("createdAt", descending = true)), first.orderBy)
    assertEquals(11, first.limit)
    assertEquals(31, runHistoryQuery("h1", "w1", RunFilters(), 10, 2).limit)

    // A Result asked for replaces the runs-only clause; a search asks for its first word's token.
    val filtered = runHistoryQuery("h1", "w1", RunFilters(result = "failed", trigger = "lead", search = "Sent Email"), 10, 0)
    assertEquals(
      listOf(
        FirestoreFilter("target.id", FilterOp.EQ, "w1"),
        FirestoreFilter("trigger", FilterOp.EQ, "lead"),
        FirestoreFilter("result", FilterOp.EQ, "failed"),
        FirestoreFilter("summaryTokens", FilterOp.ARRAY_CONTAINS, "sent"),
      ),
      filtered.filters,
    )
    val (rows, more) = pageOf((1..11).toList(), 10, 0)
    assertEquals(10, rows.size)
    assertTrue(more)
    assertEquals(listOf(11) to false, pageOf((1..11).toList(), 10, 1))
  }

  @Test
  fun runRowsSayWhatHappened() {
    val row = runRowOf(
      doc(
        "r1",
        mapOf(
          "action" to "Action ran on lead with errors: webhook 500",
          "trigger" to "lead",
          "triggeredBy" to mapOf("kind" to "apiKey", "apiKeyName" to "Zapier"),
          "durationMs" to 75L,
          "createdAt" to FirestoreTimestamp(1_700_000_000),
        ),
      ),
    )
    assertEquals("failed", row.result)
    assertEquals("New lead", row.triggerLabel)
    assertEquals("API key Zapier", row.who)
    assertEquals("webhook 500 · 75ms", row.summaryLine)
    assertEquals(1_700_000_000_000, row.createdAtMs)
  }

  @Test
  fun routeBodiesAreTheConsoles() {
    fun json(text: String) = Json.parseToJsonElement(text)
    assertEquals(
      json("""{"hostId":"h1","resource":"workflow","data":{"name":"W","steps":[],"returnValue":"","trigger":null}}"""),
      createWorkflowBody("h1", workflowFields(WorkflowDraft(id = null, name = " W ", steps = emptyList()))),
    )
    assertEquals(
      json("""{"hostId":"h1","resource":"workflow","action":"duplicate","sourceId":"w1","name":"Copy of W","attemptKey":"k"}"""),
      duplicateWorkflowBody("h1", "w1", "Copy of W", "k"),
    )
    assertEquals(json("""{"hostId":"h1","resource":"action","id":"a1","data":{"name":"A"}}"""), createActionShellBody("h1", "a1", "A"))
    assertEquals(
      json("""{"hostId":"h1","resource":"webhook","id":"k1","data":{"name":"Hook","direction":"inbound","workflowName":"W","secret":"s","enabled":true}}"""),
      createWebhookBody("h1", "k1", " Hook ", "inbound", "https://x", " W ", "s"),
    )
    assertEquals(json("""{"hostId":"h1","kind":"workflow","id":"w1","name":"W"}"""), whereUsedBody("h1", "w1", "W"))
    assertEquals(json("""{"hostId":"h1","actionId":"a1"}"""), testRunBody("h1", "a1"))
    assertEquals(json("""{"hostId":"h1","automationId":"o1","paused":true}"""), pauseBody("h1", "o1", true))
    assertEquals(json("""{"orgId":"o","action":"setEnabled","automationId":"a","enabled":false}"""), manageBody("o", "setEnabled", "a", enabled = false))
    assertEquals(json("""{"orgId":"o","action":"delete","automationId":"a"}"""), manageBody("o", "delete", "a"))
  }

  @Test
  fun quotaAndPlanWords() {
    assertEquals("1,480 action runs this month · 5,000 included", runQuotaLine(RunCounter.ACTION_RUNS, 1480, 5000))
    assertEquals("312 workflow runs this month · no monthly limit", runQuotaLine(RunCounter.WORKFLOW_RUNS, 312, null))
    assertEquals("3/25 workflows on your plan", quotaReadout(3, 25, ready = true, noun = "workflow"))
    assertEquals("3/∞ workflows on your plan", quotaReadout(3, null, ready = true, noun = "workflow"))
    assertEquals("1 workflow · checking your plan…", quotaReadout(1, null, ready = false, noun = "workflow"))
    val plan = entitlementsOf(Json.parseToJsonElement("""{"features":{"actions":true,"webhooks":false},"quotas":{"workflowsPerHost":25,"actionRunsPerMonth":null}}"""))
    assertTrue(plan.has("actions"))
    assertFalse(plan.has("webhooks"))
    assertEquals(25L, plan.limit("workflowsPerHost"))
    assertNull(plan.limit("actionRunsPerMonth"))
    assertEquals("2026-10", utcMonthKey(1_791_417_600_000))
    assertEquals("orgs/o/counters/actionRuns", runCounterPath(RunCounter.ACTION_RUNS, "o", "h"))
    assertEquals("hosts/h/counters/workflowRuns", runCounterPath(RunCounter.WORKFLOW_RUNS, null, "h"))
  }

  @Test
  fun whereUsedAndDuplicateWords() {
    val scan = whereUsedOf(Json.parseToJsonElement("""{"dependents":[{"type":"screen"},{"type":"screen"},{"type":"variable"}],"total":3}"""))
    assertEquals("2 pages, 1 variable", summarizeDependents(scan))
    assertEquals("\"Quote\" computes 2 pages, 1 variable — those variables will fall back to their stored values.", workflowDeleteBody("Quote", scan))
    assertEquals("\"Quote\" will no longer be runnable.", workflowDeleteBody("Quote", WhereUsed(emptyList(), 0)))
    assertEquals("\"Quote\" is not referenced by anything published", workflowUsageLine("Quote", WhereUsed(emptyList(), 0)))
    assertEquals("Copy of Quote", duplicateDisplayName("Quote"))
    assertEquals("Copy of Quote", duplicateDisplayName("Copy of Quote"))
    assertEquals("Copy of Untitled", duplicateDisplayName(" "))
  }

  @Test
  fun testRunWords() {
    assertEquals("Test ran — first alert: Hi", testRunMessage(Json.parseToJsonElement("""{"ok":true,"alerts":[{"message":"Hi","severity":"info"}]}""")))
    assertEquals("Test ran — server steps executed (see Runs)", testRunMessage(Json.parseToJsonElement("""{"ok":true,"alerts":[]}""")))
    assertEquals("Switch the action on to test it", testRunRefusal(409))
    assertEquals("The test run could not be completed. Try again.", testRunRefusal(500))
  }

  @Test
  fun webhookRowsAndOrigin() {
    val inbound = webhookRowOf(doc("k1", mapOf("name" to "Quotes", "direction" to "inbound", "workflowName" to "Party quote", "secret" to "s")))
    assertEquals("https://demo.aglyn.app", hostPublicOrigin(mapOf("subdomain" to "demo")))
    assertEquals("https://shop.example.com", hostPublicOrigin(mapOf("subdomain" to "demo", "cname" to "shop.example.com")))
    assertEquals("inbound · https://demo.aglyn.app/api/hooks/h1/k1 → Party quote", inbound.caption("https://demo.aglyn.app", "h1"))
    val outbound = webhookRowOf(doc("k2", mapOf("name" to "CRM", "direction" to "outbound", "url" to "https://x.example/hook")))
    assertEquals("outbound · https://x.example/hook", outbound.caption("", "h1"))
    assertEquals("Outbound URLs must be public https addresses", webhookDraftProblem(WebhookDraft(name = "A", url = "https://192.168.1.4/x", secret = "s")))
    assertNull(webhookDraftProblem(WebhookDraft(name = "A", url = "https://hooks.example.com/x", secret = "s")))
    assertEquals("Pick the workflow this endpoint runs", webhookDraftProblem(WebhookDraft(name = "A", direction = "inbound", secret = "s")))
  }

  @Test
  fun orgRowsPlacementAndHubLists() {
    val sites = listOf(OrgSite("h1", "Demo", "demo"), OrgSite("h2", "Shop", "shop"))
    val everywhere = orgAutomationRowOf(doc("o1", mapOf("name" to "Welcome", "trigger" to mapOf("event" to "lead"), "steps" to listOf(mapOf("type" to "sendEmail")), "visibleTo" to listOf("org"), "pausedHostIds" to listOf("h1"))))
    val chosen = orgAutomationRowOf(doc("o2", mapOf("name" to "Won", "enabled" to false, "trigger" to mapOf("event" to "dealWon"), "steps" to emptyList<Any>(), "visibleTo" to listOf("host:h2"))))
    assertEquals("Runs on every site", placementLine(everywhere, sites))
    assertEquals("Runs on Shop", placementLine(chosen, sites))
    assertEquals(listOf("h1", "h2"), placedSiteIds(everywhere, sites))
    assertEquals(SitePlacement.PAUSED, sitePlacement(everywhere, "h1"))
    assertEquals(SitePlacement.RUNS, sitePlacement(everywhere, "h2"))
    assertEquals(SitePlacement.OFF, sitePlacement(chosen, "h2"))
    assertEquals("on New lead · Send an email", everywhere.caption)

    val rows = siteListRows(
      SiteListKind.WORKFLOWS,
      listOf(doc("w1", mapOf("name" to "Quote", "trigger" to null)), doc("w2", mapOf("name" to "Lead", "trigger" to mapOf("event" to "lead")))),
    )
    assertEquals(listOf(SiteListRow("w1", "Quote", "Run by other automations", "Ready"), SiteListRow("w2", "Lead", "New lead", "Ready")), rows)
    val actions = siteListRows(
      SiteListKind.ACTIONS,
      listOf(doc("a1", mapOf("name" to "Off one", "enabled" to false, "trigger" to mapOf("event" to "booking"))), doc("a2", mapOf("name" to "Leaf", "trigger" to mapOf("event" to "elementClick", "selector" to "[data-aglyn=\"leaf:x\"]")))),
    )
    assertEquals(listOf(SiteListRow("a1", "Off one", "New booking", "Off")), actions)
    assertEquals("Inbound", siteListRows(SiteListKind.WEBHOOKS, listOf(doc("k", mapOf("direction" to "inbound"))))[0].trigger)
  }

  @Test
  fun pickerOptionsNameRecordsAsTheirOwners() {
    assertEquals(
      listOf(PickOption("d1", "d1"), PickOption("d2", "Leads")),
      datasetOptions(listOf(doc("d1", emptyMap()), doc("d2", mapOf("displayName" to "Leads")), doc("d3", mapOf("name" to "Gone", "deletedAt" to 1L)))),
    )
    assertEquals(listOf(PickOption("v1", "Spring sale")), overlayOptions(listOf(doc("v1", mapOf("bar" to mapOf("text" to "Spring sale"))))))
    assertEquals(listOf(PickOption("f1", "Contact")), formOptions(listOf(doc("f1", mapOf("displayName" to "Contact")), doc("f2", mapOf("archivedAt" to 1L)))))
    assertEquals(listOf(PickOption("k1", "Out")), webhookOptions(listOf(doc("k1", mapOf("name" to "Out", "direction" to "outbound")), doc("k2", mapOf("name" to "In", "direction" to "inbound")))))
    assertTrue(scopeCovers(listOf("org"), listOf("host:h1")))
    assertFalse(scopeCovers(listOf("host:h1"), listOf("org")))
    assertTrue(scopeCovers(listOf("host:h1", "host:h2"), listOf("host:h1")))
    assertFalse(scopeCovers(null, listOf("host:h1")))
  }

  @Test
  fun actionDraftsRoundTripAndSaveTheStoredShape() {
    val stored = mapOf(
      "name" to "Pricing nudge",
      "trigger" to mapOf("event" to "scrollDepth", "threshold" to 60L, "pathPattern" to "/pricing", "oncePerSession" to true, "conditions" to listOf(mapOf("field" to "formId", "op" to "equals", "value" to "f1")), "combinator" to "or"),
      "steps" to listOf(mapOf("type" to "siteAlert", "message" to "Hi", "severity" to "info", "extra" to "kept")),
      "enabled" to false,
      "recipe" to "crm.welcome",
    )
    val draft = actionDraftOf(stored, "a1")
    assertEquals("session", draft.frequency)
    assertEquals(listOf(ConditionRow(FORM_IS_OP, FORM_ID_FIELD, "f1")), draft.conditionRows)
    val candidate = actionCandidate(draft)
    assertNull(validateHostAction(candidate))
    val document = siteInteractionDocument(candidate)
    @Suppress("UNCHECKED_CAST")
    val trigger = document["trigger"] as Map<String, Any?>
    assertEquals(60.0, trigger["threshold"])
    assertEquals(true, trigger["oncePerSession"])
    assertEquals(false, trigger["oncePerVisitor"])
    assertEquals(null, trigger["cooldownMinutes"])
    assertEquals(listOf(mapOf("field" to "formId", "op" to "equals", "value" to "f1")), trigger["conditions"])
    assertEquals("or", trigger["combinator"])
    assertEquals("crm.welcome", document["recipe"])
    assertEquals("kept", ((document["steps"] as List<*>)[0] as Map<*, *>)["extra"])

    val custom = actionDraftOf(mapOf("name" to "C", "trigger" to mapOf("event" to "lead-scored"), "steps" to listOf(mapOf("type" to "exitFlow"))), "a2")
    assertEquals(CUSTOM_EVENT_VALUE, custom.event)
    assertEquals("lead-scored", actionCandidate(custom).let { (it["trigger"] as Map<*, *>)["event"] })
    assertFalse(actionCandidate(custom).containsKey("recipe"))

    val cooled = ActionDraft(id = null).withFrequency("cooldown")
    assertEquals(60.0, cooled.cooldownMinutes)
    assertEquals("Step 1: enter the alert message", validateHostAction(actionCandidate(ActionDraft(id = null, name = "New", conditionRows = listOf(EMPTY_CONDITION_ROW)))))
    assertEquals(emptyMap(), conditionsFromRows(listOf(EMPTY_CONDITION_ROW), "and"))
    assertEquals(ConditionRow("notEmpty", "", ""), withOp(ConditionRow(FORM_IS_OP, FORM_ID_FIELD, "f1"), "notEmpty"))
  }

  @Test
  fun orgDraftsSaveWhatTheRouteReads() {
    val draft = orgAutomationDraftOf(
      mapOf("name" to "Welcome", "trigger" to mapOf("event" to "lead", "conditions" to null), "steps" to listOf(mapOf("type" to "sendEmail", "subject" to "Hi", "body" to "B")), "visibleTo" to listOf("host:h1", "host:h2")),
      "o1",
    )
    assertEquals("sites", draft.placement)
    assertEquals(listOf("h1", "h2"), draft.siteIds)
    val read = readOrgAutomation(orgAutomationBody(draft))
    assertIs<OrgAutomationRead.Ok>(read)
    assertEquals(listOf("host:h1", "host:h2"), read.value["visibleTo"])
    assertEquals(
      "Choose every site, or up to 30 sites, for it to run on",
      (readOrgAutomation(orgAutomationBody(draft.copy(siteIds = emptyList()))) as OrgAutomationRead.Refused).problem,
    )
    assertIs<OrgAutomationRead.Ok>(readOrgAutomation(orgAutomationBody(OrgAutomationDraft(id = null, name = "N", steps = listOf(defaultStep("notifyAdmins") + ("title" to "T"))))))
  }

  @Test
  fun stepEditsKeepTheConsolesShape() {
    val owner = defaultStep("assignContactOwner")
    assertEquals(mapOf("type" to "assignContactOwner", "ownerEmail" to "a@b.co"), owner.withMemberRef("owner", "a@b.co"))
    assertEquals(mapOf("type" to "assignContactOwner", "ownerUid" to "u1"), owner.withMemberRef("owner", " u1 "))
    assertEquals(mapOf("type" to "assignContactOwner"), owner.withMemberRef("owner", ""))
    val guarded = defaultStep("sendEmail").withGuardOp("equals").withGuardField("field", "plan")
    assertEquals(mapOf("conditions" to listOf(mapOf("op" to "equals", "field" to "plan", "value" to ""))), guarded["when"])
    assertNull(guarded.withGuardOp("")["when"])
    assertTrue(guarded.withGuardOp("").containsKey("when"))
    val call = mapOf("type" to "logCrmActivity", "kind" to "call", "direction" to "internal", "body" to "x")
    assertFalse(call.withActivityKind("email").containsKey("direction"))
    assertEquals("inbound", (call + ("direction" to "inbound")).withActivityKind("email")["direction"])
    assertEquals("step2_", resultNameOf("step 2!_"))
    assertTrue(isInteractionAttributeAllowed("aria-expanded"))
    assertFalse(isInteractionAttributeAllowed("onclick"))
    for (type in com.aglyn.contracts.HOST_ACTION_STEP_LABELS.keys) assertEquals(type, defaultStep(type)["type"], type)
    assertEquals(
      mapOf("name" to "W", "steps" to emptyList<Any>(), "returnValue" to "", "trigger" to mapOf("event" to "lead", "filter" to "")),
      workflowFields(withWorkflowTrigger(WorkflowDraft(id = null, name = "W", steps = emptyList()), "lead")),
    )
    assertNull(withWorkflowTrigger(WorkflowDraft(id = null, trigger = mapOf("event" to "lead")), "").trigger)
  }

  @Test
  fun jsonOfWritesWholeNumbersAsIntegers() {
    assertEquals(Json.parseToJsonElement("""{"a":1,"b":1.5,"c":[true,null],"d":"x"}"""), jsonOf(mapOf("a" to 1.0, "b" to 1.5, "c" to listOf(true, null), "d" to "x")) as JsonObject)
  }

  @Test
  fun screensForTargets() {
    assertEquals(WORKFLOW_SCREEN to mapOf("id" to "new"), screenFor(AutomationTarget.Workflow(null)))
    assertEquals(RUNS_SCREEN to mapOf("targetId" to "o1", "name" to "N", "hostScope" to "site"), screenFor(AutomationTarget.Runs("o1", "N", siteScope = true)))
  }
}
