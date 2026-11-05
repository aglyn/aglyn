package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the CRM's ports, and checks the list plans. */
class CrmCasesTest {
  private val functions = Json.parseToJsonElement(File("../../../../native/contracts/function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(element: JsonElement?) = plain(element) as? Map<String, Any?>

  private fun group(element: JsonElement): ConsentGroup {
    val o = element.jsonObject
    return ConsentGroup(
      o.getValue("hostId").jsonPrimitive.content,
      o.getValue("groupId").jsonPrimitive.content,
      (o["name"] as? JsonPrimitive)?.contentOrNull,
      o.getValue("hostIds").jsonArray.map { it.jsonPrimitive.content },
      o.getValue("declared").jsonPrimitive.booleanOrNull == true,
    )
  }

  @Test
  fun consentGroupForHostCases() = cases("consentGroupForHost").forEach { (args, result) ->
    val got = consentGroupForHost(map(args[0]), args[1].jsonPrimitive.content)
    assertEquals(group(result), got, args.toString())
  }

  @Test
  fun theDefaultScopeIsTheConsoles() {
    cases("crmDefaultScopeOf").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.contentOrNull, crmDefaultScopeOf(map(args[0])), args.toString())
    }
  }

  @Test
  fun theActivityCompanyIsTheConsoles() {
    cases("crmActivityCompanyId").forEach { (args, result) ->
      val link = map(args[0])
      val sources = map(args[1])
      @Suppress("UNCHECKED_CAST")
      assertEquals(
        (result as? JsonPrimitive)?.contentOrNull,
        crmActivityCompanyId(link?.get("companyId") as? String, sources?.get("deal") as? Map<String, Any?>, sources?.get("contact") as? Map<String, Any?>, sources?.get("groupId") as? String, sources?.get("org") as? Map<String, Any?>),
        args.toString(),
      )
    }
  }

  @Test
  fun activityTitlesAreTheConsoles() {
    cases("crmActivityKindTitle").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, crmActivityKindTitle(args[0].jsonPrimitive.content, (args.getOrNull(1) as? JsonPrimitive)?.contentOrNull), args.toString())
    }
    assertEquals("Outbound WhatsApp message", crmActivityKindTitle("whatsapp", "outbound"))
  }

  @Test
  fun scopeTokenCases() {
    cases("crmScopeTokens").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, crmScopeTokens(map(args[0]), group(args[1])), args.toString())
    }
    cases("crmReadTokens").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, crmReadTokens(group(args[0])), args.toString())
    }
  }

  @Test
  fun fieldListFieldCases() = cases("crmFieldListFields").forEach { (args, result) ->
    val definition = map(args[0]).orEmpty()
    val got = fieldListFields(definition["key"] as String, definition["label"] as String, definition["required"] == true, (definition["object"] as? String) ?: "contact")
    assertEquals(map(result), got, args.toString())
  }

  private fun pipeline(element: JsonElement) = Pipeline(
    "p", "P",
    element.jsonObject.getValue("stages").jsonArray.map {
      val s = it.jsonObject
      Stage(s.getValue("id").jsonPrimitive.content, s.getValue("name").jsonPrimitive.content, s.getValue("order").jsonPrimitive.longOrNull ?: 0, s.getValue("probability").jsonPrimitive.longOrNull ?: 0, s.getValue("kind").jsonPrimitive.content, null)
    },
    false, false,
  )

  @Test
  fun pipelineTotalsCases() = cases("pipelineTotals").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST") val deals = plain(args[0]) as List<Map<String, Any?>>
    val got = pipelineTotals(deals, pipeline(args[1]))
    val want = result.jsonObject
    assertEquals(want.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.count, args.toString())
    assertEquals(want.getValue("amountCents").jsonPrimitive.longOrNull, got.amountCents)
    assertEquals(want.getValue("weightedCents").jsonPrimitive.longOrNull, got.weightedCents)
    assertEquals(want.getValue("unplaced").jsonObject.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.unplacedCount)
    want.getValue("stages").jsonArray.forEachIndexed { index, stage ->
      val row = stage.jsonObject
      assertEquals(row.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.stages[index].count)
      assertEquals(row.getValue("weightedCents").jsonPrimitive.longOrNull, got.stages[index].weightedCents)
    }
  }

  @Test
  fun leadFunnelCases() = cases("leadFunnel").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST") val leads = plain(args[0]) as List<Map<String, Any?>>
    val got = leadFunnel(leads)
    val want = result.jsonObject
    assertEquals(want.getValue("total").jsonPrimitive.longOrNull?.toInt(), got.total)
    assertEquals(want.getValue("open").jsonPrimitive.longOrNull?.toInt(), got.open)
    assertEquals(want.getValue("byStatus").jsonObject.mapValues { it.value.jsonPrimitive.longOrNull?.toInt() }, got.byStatus)
    assertEquals(want.getValue("reasons").jsonArray.map { it.jsonObject.getValue("label").jsonPrimitive.content to it.jsonObject.getValue("count").jsonPrimitive.longOrNull?.toInt() }, got.reasons)
  }

  private fun role(element: Any?): CrmContactRole {
    val o = element as Map<*, *>
    return CrmContactRole(o["contactId"] as String, o["role"] as? String, o["primary"] == true)
  }

  private fun roles(element: JsonElement?): List<CrmContactRole> = (plain(element) as? List<*>).orEmpty().map(::role)

  private fun picklistValues(element: JsonElement): List<Pair<String, Boolean>> =
    (map(element)?.get("values") as? List<*>).orEmpty().map { val o = it as Map<*, *>; (o["label"] as String) to (o["active"] == true) }

  private fun picks(element: JsonElement): CrmActivityPicks {
    val o = map(element).orEmpty()
    val related = o["related"] as? Map<*, *>
    return CrmActivityPicks(o["contactId"] as? String, related?.let { CrmRelated(it["kind"] as String, it["id"] as String) })
  }

  private fun docs(value: Any?): List<com.aglyn.core.FirestoreDoc> =
    (value as? List<*>).orEmpty().map { val o = it as Map<*, *>; @Suppress("UNCHECKED_CAST") com.aglyn.core.FirestoreDoc(o["\$id"] as String, "", o as Map<String, Any?>) }

  @Test
  fun theLogFieldsOpenAsTheConsolesDo() = cases("crmActivityPicksFrom").forEach { (args, result) ->
    assertEquals(picks(result), crmActivityPicksFrom(map(args[0]).orEmpty(), (args.getOrNull(1) as? JsonPrimitive)?.contentOrNull), args.toString())
  }

  @Test
  fun thePicksWriteTheConsolesLinks() = cases("crmActivityLinkFromPicks").forEach { (args, result) ->
    assertEquals(map(result), crmActivityLinkFromPicks(picks(args[0]), (args.getOrNull(1) as? JsonPrimitive)?.contentOrNull), args.toString())
  }

  @Test
  fun relatedToListsWhatTheConsoleLists() = cases("crmRelatedToOptions").forEach { (args, result) ->
    val input = map(args[0]).orEmpty()
    val want = (plain(result) as List<*>).map { val o = it as Map<*, *>; CrmPickOption("${o["kind"]}:${o["id"]}", o["label"] as String, o["group"] as String) }
    assertEquals(want, crmRelatedToOptions(docs(input["linkedDeals"]), docs(input["deals"]), docs(input["companies"])), args.toString())
  }

  @Test
  fun nameLeadsWithTheDealsRoles() {
    val contacts = listOf(com.aglyn.ui.FieldOption("c2", "Pat Lee"), com.aglyn.ui.FieldOption("c1", "Jordan Lee"), com.aglyn.ui.FieldOption("c3", "acme buyer"))
    val pinned = crmNameOptions(listOf(CrmPickOption("c1", "Jordan Lee", "")), contacts)
    assertEquals(listOf("c1", "c3", "c2"), pinned.map { it.key })
    assertEquals(listOf("On this deal", "All contacts", "All contacts"), pinned.map { it.group })
    assertEquals(listOf("", "", ""), crmNameOptions(emptyList(), contacts).map { it.group })
    assertEquals(CrmRelated("deal", "d1"), CrmRelated.ofKey("deal:d1"))
    assertEquals(null, CrmRelated.ofKey("lead:l1"))
  }

  @Test
  fun contactRolesReadAsTheConsoleReadsThem() {
    cases("dealContactRolesOf").forEach { (args, result) -> assertEquals(roles(result), dealContactRolesOf(map(args[0]).orEmpty()), args.toString()) }
    cases("companyContactRolesOf").forEach { (args, result) -> assertEquals(roles(result), companyContactRolesOf(map(args[0]).orEmpty()), args.toString()) }
  }

  @Test
  fun eachRoleEditMakesTheConsolesList() {
    cases("dealContactRolesWithPrimary").forEach { (args, result) ->
      assertEquals(roles(result), contactRolesWithPrimary(roles(args[0]), (args[1] as? JsonPrimitive)?.contentOrNull), args.toString())
    }
    cases("dealContactRolesWithout").forEach { (args, result) -> assertEquals(roles(result), contactRolesWithout(roles(args[0]), args[1].jsonPrimitive.content), args.toString()) }
    cases("dealContactRolesWithRole").forEach { (args, result) ->
      assertEquals(roles(result), contactRolesWithRole(roles(args[0]), args[1].jsonPrimitive.content, args[2].jsonPrimitive.content), args.toString())
    }
    cases("dealContactRolesAdded").forEach { (args, result) ->
      val added = map(args[1]).orEmpty()
      assertEquals(roles(result), contactRolesAdded(roles(args[0]), added["contactId"] as String, added["role"] as? String, added["primary"] == true), args.toString())
    }
    cases("dealContactRoleAddProblem").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.contentOrNull, contactRoleAddProblem(roles(args[0]), args[1].jsonPrimitive.content, args[2].jsonPrimitive.content), args.toString())
    }
  }

  @Test
  fun aRoleSaveWritesWhatTheConsoleWrites() {
    cases("dealContactRolesSave").forEach { (args, result) ->
      val want = map(result).orEmpty()
      val got = dealContactRolesSave(map(args[0]).orEmpty(), roles(args[1]), picklistValues(args[2]))
      if (want["ok"] == true) {
        val write = got.getOrThrow()
        assertEquals(roles(result.jsonObject["contactRoles"]), write.contactRoles, args.toString())
        assertEquals(want["contactId"] as? String, write.contactId, args.toString())
        assertEquals(want["primaryChanged"], write.primaryChanged, args.toString())
      } else {
        assertEquals(want["error"], got.exceptionOrNull()?.message, args.toString())
      }
    }
    cases("companyContactRolesSave").forEach { (args, result) ->
      val want = map(result).orEmpty()
      val got = companyContactRolesSave(map(args[0]).orEmpty(), roles(args[1]), picklistValues(args[2]))
      if (want["ok"] == true) {
        val judged = got.getOrThrow()
        assertEquals(roles(result.jsonObject["contactRoles"]), judged, args.toString())
        val list = contactRoleListFields(judged, null)
        assertEquals(want["contactRoleContactIds"], list.ids, args.toString())
        assertEquals(want["contactRoleKeys"], list.keys, args.toString())
      } else {
        assertEquals(want["error"], got.exceptionOrNull()?.message, args.toString())
      }
    }
  }

  @Test
  fun theRoleListFieldsAreTheConsoles() = cases("crmDealContactRoleListFields").forEach { (args, result) ->
    val deal = map(args[0]).orEmpty()
    val want = map(result).orEmpty()
    val got = contactRoleListFields(dealContactRolesOf(deal), deal["visibleTo"])
    assertEquals(want["contactRoleContactIds"], got.ids, args.toString())
    assertEquals(want["scopedContactRoleContactIds"], got.scoped, args.toString())
    assertEquals(want["contactRoleKeys"], got.keys, args.toString())
  }

  @Test
  fun thePicklistOffersItsValuesWithWhetherTheyAreActive() {
    val stored = Picklists(mapOf(CRM_CONTACT_ROLE_PICKLIST to listOf("Evaluator" to true, "Champion" to false)))
    assertEquals(listOf("Evaluator", "Champion"), stored.values(CRM_CONTACT_ROLE_PICKLIST).map { it.first })
    assertEquals(listOf("Evaluator"), stored.labels(CRM_CONTACT_ROLE_PICKLIST))
    assertTrue(Picklists(emptyMap()).values(CRM_CONTACT_ROLE_PICKLIST).all { it.second })
    assertTrue("Decision Maker" in Picklists(emptyMap()).labels(CRM_CONTACT_ROLE_PICKLIST))
  }

  @Test
  fun theOptInSentenceAndItsKeyAreTheConsoles() {
    cases("consentGroupDisclosure").forEach { (args, result) -> assertEquals((result as? JsonPrimitive)?.contentOrNull, consentGroupDisclosure(group(args[0])), args.toString()) }
    cases("consentGroupDisclosureKey").forEach { (args, result) -> assertEquals((result as? JsonPrimitive)?.contentOrNull, consentGroupDisclosureKey(group(args[0])), args.toString()) }
  }

  @Test
  fun theOptInSaysWhyItIsOffAndWhatNoSiteMeans() {
    val declared = ConsentGroup("h1", "brands", "North Brands", listOf("h1", "h2"), true)
    assertEquals("Add an email first: there is nowhere to send marketing without one.", contactConsentHelp(false, declared))
    assertEquals("You'll receive marketing email from North Brands, which covers 2 sites. Tick it only if they agreed. Adding a contact is never itself consent.", contactConsentHelp(true, declared))
    assertEquals("With no source site, this records it on every site. Tick it only if they agreed. Adding a contact is never itself consent.", contactConsentHelp(true, null))
    assertEquals("Tick it only if they agreed. Adding a contact is never itself consent.", contactConsentHelp(true, soloConsentGroup("h1")))
  }

  @Test
  fun theCreateSendsTheBoxAndTheSentencesKey() {
    val declared = ConsentGroup("h1", "brands", "North Brands", listOf("h1", "h2"), true)
    assertEquals(mapOf("marketingConsent" to true, "disclosedConsentGroup" to consentGroupDisclosureKey(declared)), contactConsentFields(mapOf("email" to "pat@example.com", CONTACT_CONSENT_KEY to "true"), declared))
    assertEquals(mapOf<String, Any?>("marketingConsent" to true), contactConsentFields(mapOf("email" to "pat@example.com", CONTACT_CONSENT_KEY to "true"), soloConsentGroup("h1")))
    assertEquals(mapOf<String, Any?>("marketingConsent" to false), contactConsentFields(mapOf("email" to "pat@example.com", CONTACT_CONSENT_KEY to "false"), declared))
    assertEquals(mapOf<String, Any?>("marketingConsent" to false), contactConsentFields(mapOf("email" to " ", CONTACT_CONSENT_KEY to "true"), declared))
  }

  private val owner = CrmScope("o1", "h1", "h1", "u1", "owner", true, listOf("org", "host:h1"), listOf("host:h1"), true, emptyMap())
  private val collaborator = owner.copy(role = "editor", orgWide = false)

  @Test
  fun listsAreScopedByTheReadersTokens() {
    val query = crmListQuery(CrmKind.LEAD, owner, crmFilters(CrmKind.LEAD, owner).first(), "", 25)
    assertEquals("orgs/o1/leads", query.collectionPath)
    assertTrue(query.filters.any { it.field == "visibleTo" && it.op == FilterOp.ARRAY_CONTAINS_ANY })
    assertTrue(query.filters.any { it.field == "status" && it.op == FilterOp.IN })
    assertEquals("lastSeenAtMs", query.orderBy.single().field)
  }

  @Test
  fun anOrgWideReadersFacetClauseStandsInForTheScope() {
    val mine = crmFilters(CrmKind.CONTACT, owner).first { it.key == "mine" }
    val query = crmListQuery(CrmKind.CONTACT, owner, mine, "", 25)
    assertTrue(query.filters.none { it.field == "visibleTo" })
    assertTrue(query.filters.any { it.field == "facetKeys" && it.value == "h1:owner=u1" })
    // A collaborator keeps the scope clause; the facet clause cannot join it.
    val scoped = crmListQuery(CrmKind.CONTACT, collaborator, crmFilters(CrmKind.CONTACT, collaborator).first { it.key == "mine" }, "", 25)
    assertTrue(scoped.filters.any { it.field == "visibleTo" })
  }

  @Test
  fun anEditWritesOnlyWhatChangedAndDeletesWhatWasCleared() {
    val fields = listOf(
      CrmField(com.aglyn.ui.FieldSpec("name", "Name")),
      CrmField(com.aglyn.ui.FieldSpec("amount", "Amount", com.aglyn.ui.FieldKind.MONEY), "amountCents", Stored.CENTS),
      CrmField(com.aglyn.ui.FieldSpec("custom.size", "Size"), "custom.size"),
      CrmField(com.aglyn.ui.FieldSpec("phone", "Phone")),
    )
    val before = formValues(fields, mapOf("name" to "A", "amountCents" to 1250L, "custom" to mapOf("size" to "M"), "phone" to "1"))
    assertEquals(mapOf("name" to "A", "amount" to "12.5", "custom.size" to "M", "phone" to "1"), before)
    val changes = changedFields(fields, before, before + mapOf("amount" to "20", "custom.size" to "L", "phone" to ""))
    assertEquals(mapOf("amountCents" to 2000L, "custom" to mapOf("size" to "L"), "phone" to FirestoreDelete), changes)
  }

  @Test
  fun theSuiteFollowsTheRules() {
    assertTrue(crmSuiteCarried(mapOf("plan" to "pro")))
    assertEquals(false, crmSuiteCarried(mapOf("plan" to "pro", "billingStatus" to "canceled")))
    assertEquals(false, crmSuiteCarried(mapOf("plan" to "free")))
    assertTrue(crmSuiteCarried(mapOf("plan" to "free", "entitlements" to mapOf("features" to mapOf("crm" to true)))))
    assertTrue(crmSuiteCarried(mapOf("entitlements" to mapOf("planComp" to mapOf("plan" to "starter")))))
  }

  @Test
  fun leadChipsAreTheConsolesStatuses() {
    val chips = crmFilters(CrmKind.LEAD, owner)
    assertEquals(Contracts.nativeCrmLeadOpenStatuses.joinToString(","), chips.first().clauses.single().value)
    assertTrue(chips.any { it.clauses == listOf(ListFilterRequest("status", "equals", "nurturing")) })
  }

  private fun memberScope(member: Map<String, Any?>, hostId: String? = null) = crmScopeOf("o1", hostId, "u1", emptyMap(), member)

  @Test
  fun gatesAskTheirKeysOverTheRole() {
    assertTrue(memberScope(mapOf("role" to "editor")).canWrite)
    assertFalse(memberScope(mapOf("role" to "editor")).canManage)
    assertTrue(memberScope(mapOf("role" to "admin")).canManage)
    // A custom role's stamp decides, whichever role the row names.
    val granted = memberScope(mapOf("role" to "viewer", "resolvedPermissions" to mapOf("crm.settings" to true, "data.manage" to true)))
    assertTrue(granted.canManage)
    assertTrue(granted.canWrite)
    assertFalse(memberScope(mapOf("role" to "admin", "resolvedPermissions" to mapOf("crm.settings" to false))).canManage)
  }

  @Test
  fun theWorkspaceCrmAsksForReachAndManageData() {
    assertTrue(memberScope(mapOf("role" to "editor", "allHosts" to true)).opensWorkspaceCrm)
    assertFalse(memberScope(mapOf("role" to "viewer", "allHosts" to true)).opensWorkspaceCrm)
    assertFalse(memberScope(mapOf("role" to "editor", "allHosts" to false)).opensWorkspaceCrm)
    assertFalse(memberScope(mapOf("role" to "editor", "allHosts" to false, "resolvedPermissions" to mapOf("data.manage" to true))).opensWorkspaceCrm)
  }

  @Test
  fun stageMovesAskTheSiteOnASiteAndTheWorkspaceOffOne() {
    val editor = memberScope(mapOf("role" to "editor"), "h1")
    assertTrue(editor.movesStages(null))
    assertFalse(editor.movesStages(mapOf("memberRoles" to mapOf("u1" to "author"))))
    assertTrue(editor.movesStages(mapOf("memberRoles" to mapOf("u1" to "editor"))))
    assertFalse(editor.movesStages(mapOf("memberRoles" to mapOf("u1" to "editor"), "memberPermissions" to mapOf("u1" to mapOf("crm.moveStages" to false)))))
    assertTrue(memberScope(mapOf("role" to "editor")).movesStages(null))
    assertFalse(memberScope(mapOf("role" to "editor", "resolvedPermissions" to mapOf("crm.moveStages" to false))).movesStages(null))
  }
}
