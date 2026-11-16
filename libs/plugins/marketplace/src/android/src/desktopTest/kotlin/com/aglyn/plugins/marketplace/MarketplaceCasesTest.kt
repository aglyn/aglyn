package com.aglyn.plugins.marketplace

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.InstallTarget
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.plainJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own answers (function-cases.generated.json) for the marketplace's rules. */
class MarketplaceCasesTest {
  private val functions = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun str(json: JsonElement?): String? = (json as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun browseBaseCases() = cases("browseBase").forEach { (args, result) ->
    val expected = ContractJsonFormat.decodeFromJsonElement(ListSerializer(ListQueryFilter.serializer()), result)
    assertEquals(expected, browseBase(str(args[0]), str(args.getOrNull(1))), args.toString())
  }

  @Test
  fun artifactTypeAndBrowsableCases() {
    cases("listingArtifactType").forEach { (args, result) ->
      val listing = args[0].jsonObject
      assertEquals(result.jsonPrimitive.content, listingArtifactType(str(listing["artifactType"]), str(listing["type"]), str(listing["kind"])), args.toString())
    }
    cases("isListingBrowsable").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      val listing = ListingRow.from(FirestoreDoc("l", "marketplaceListings/l", plainJson(args[0]) as Map<String, Any?>))
      assertEquals(result.jsonPrimitive.content.toBoolean(), isListingBrowsable(listing), args.toString())
    }
  }

  @Test
  fun updateReviewOfACopy() {
    cases("resolveProvenance").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      val doc = plainJson(args[0]) as Map<String, Any?>?
      val got = resolveProvenance(doc, args.getOrNull(1)?.let { str(it) })
      val want = result.jsonObject
      assertEquals(str(want["state"]), got.state, args.toString())
      assertEquals(str(want["listingId"]), got.listingId, args.toString())
      assertEquals(str(want["version"]), got.version, args.toString())
      assertEquals(str(want["sha256"]), got.sha256, args.toString())
      assertEquals(str(want["artifactType"]), got.artifactType, args.toString())
      assertEquals(str(want["publisherOrgId"]), got.publisherOrgId, args.toString())
      assertEquals(want.getValue("updatable").jsonPrimitive.content.toBoolean(), got.updatable, args.toString())
    }
    cases("describeChange").forEach { (args, result) ->
      val change = args[0].jsonObject
      assertEquals(result.jsonPrimitive.content, describeChange(str(change["path"]).orEmpty(), change["added"]?.jsonPrimitive?.content == "true", change["removed"]?.jsonPrimitive?.content == "true"), args.toString())
    }
    cases("summarizeValue").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, summarizeValue(args[0]), args.toString()) }
    assertEquals("—", summarizeValue(null))
    assertEquals("update-available", copyUpdateState(mapOf("marketplace" to mapOf("listingId" to "l1", "version" to "1.0.0")), "1.2.0", "component").first)
    assertEquals("current", copyUpdateState(mapOf("marketplace" to mapOf("listingId" to "l1", "version" to "1.2.0")), "1.2.0", "component").first)
    assertEquals("unknown", copyUpdateState(mapOf("marketplace" to mapOf("listingId" to "l1")), "1.2.0", "component").first)
    assertEquals("Installed (v1.2.0)", copyInstallLabel("current", "1.2.0", "1.2.0"))
    assertEquals("Review update to v1.2.0", copyInstallLabel("update-available", "1.0.0", "1.2.0"))
    assertEquals("Review this version", copyInstallLabel("unknown", null, "1.2.0"))
    val preview = ArtifactUpdatePreview.from(
      Json.parseToJsonElement(
        """{"installedVersion":"1.0.0","availableVersion":"1.2.0","mergeable":true,"identical":false,"unchanged":4,
          "safe":[{"path":"a","current":1,"incoming":2}],"kept":[],"conflicts":[{"path":"b","current":null,"incoming":"x"},{"path":"c","added":true}],
          "schema":{"added":["f"],"removed":["g"],"retyped":[],"additiveOnly":false,"recordCount":12}}""",
      ),
    )
    assertEquals("You have v1.0.0; v1.2.0 is available.", preview.versionLine)
    assertEquals(listOf("b", "c"), preview.conflicts.map { it.path })
    assertEquals("null", summarizeValue(preview.conflicts[0].current))
    assertEquals("—", summarizeValue(preview.conflicts[1].current))
    assertEquals(true, preview.destructive)
    assertEquals(12, preview.schema?.recordCount)
    assertEquals("Apply safe changes", preview.applyLabel(0))
    assertEquals("Apply (2 taken from publisher)", preview.applyLabel(2))
    assertEquals("Take v3 (no content changes)", ArtifactUpdatePreview.from(Json.parseToJsonElement("""{"identical":true,"availableVersion":"3"}""")).applyLabel(1))
    assertEquals("v3 is available.", ArtifactUpdatePreview.from(Json.parseToJsonElement("""{"availableVersion":3}""")).versionLine)
    assertEquals(
      "Updated to v1.2.0 — 3 change(s) applied, 1 of yours kept, 1 conflict(s) left as yours.",
      artifactUpdateSummary("merge", Json.parseToJsonElement("""{"version":"1.2.0","applied":3,"keptLocal":1,"skipped":["b"]}""")),
    )
    assertEquals("Now on v1.2.0 — this version changes nothing in your copy.", artifactUpdateSummary("merge", Json.parseToJsonElement("""{"version":"1.2.0"}""")))
    assertEquals(
      "Installed v2 as a new copy — your customized version is kept, no longer linked to the listing.",
      artifactUpdateSummary("copy", Json.parseToJsonElement("""{"version":2}""")),
    )
  }

  @Test
  fun templateUpdateChipWords() {
    val (title, body) = templateReplaceQuestion("Bakery")
    assertEquals("Replace your edited copy?", title)
    assertEquals(true, body.startsWith("You have edited \"Bakery\" since installing it."))
    assertEquals("Updated to v3 — pages you already created are unchanged.", templateUpdatedMessage("3"))
    val source = mapOf("source" to mapOf("type" to "marketplace", "listingId" to "l1", "version" to "2"))
    assertEquals("update-available", copyUpdateState(source, "3", "template").first)
    assertEquals("current", copyUpdateState(source, "2", "template").first)
    assertEquals(
      mapOf("hostId" to "h1", "templateId" to "t1", "displayName" to "Bakery", "sourceType" to "marketplace", "listingId" to "l1", "version" to "2", "edited" to "true"),
      com.aglyn.site.artifacts.templateInstallStatusProps(
        com.aglyn.site.artifacts.ArtifactRow(
          id = "t1", name = "Bakery", description = null, kind = "page", versionId = null, parentLayoutId = null, sourceType = "marketplace",
          sourceListingId = "l1", sourceVersion = "2", edited = true, starterId = null, starterName = null, starterOrder = null,
          libraryRow = true, updatedAt = null, createdAt = null,
        ),
        "h1",
      ),
    )
    assertEquals(false, com.aglyn.site.artifacts.isInstalledTemplateSource("authored"))
    assertEquals(true, com.aglyn.site.artifacts.isInstalledTemplateSource("marketplace"))
  }

  @Test
  fun installStateCases() = cases("resolvePluginInstallState").forEach { (args, result) ->
    fun pin(json: JsonElement) = (json as? JsonObject)?.let { obj -> obj["version"]?.let { (it as JsonPrimitive).content } }
    val state = resolvePluginInstallState(str(args[0]), pin(args[1]), args[1] is JsonObject, pin(args[2]), args[2] is JsonObject)
    val expected = result.jsonObject
    assertEquals(str(expected["installedVersion"]), state.installedVersion, args.toString())
    assertEquals(str(expected["scope"]), state.scope?.raw, args.toString())
    assertEquals(expected.getValue("shadowed").jsonPrimitive.content.toBoolean(), state.shadowed, args.toString())
    assertEquals(expected.getValue("updateAvailable").jsonPrimitive.content.toBoolean(), state.updateAvailable, args.toString())
  }

  @Test
  fun installRouteCases() {
    cases("marketplaceInstallEndpoint").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, marketplaceInstallEndpoint(args[0].jsonPrimitive.content), args.toString()) }
    cases("marketplaceLandingMessage").forEach { (args, result) ->
      assertEquals(str(result), marketplaceLandingMessage(args[0].jsonPrimitive.content, args[1].jsonPrimitive.content), args.toString())
    }
  }

  /* ---- What a plugin's page says about its installs (marketplace-catalog.ts, replayed) ---- */

  private fun obj(json: JsonElement?): JsonObject = json as? JsonObject ?: JsonObject(emptyMap())

  private fun version(json: JsonElement?): String? = (json as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  private fun flag(json: JsonElement?): Boolean = (json as? JsonPrimitive)?.content == "true"

  private fun site(json: JsonElement) = obj(json).let {
    OrgInstallSite(
      str(it["hostId"]).orEmpty(), str(it["label"]).orEmpty(), version(it["version"]),
      if (str(it["pinnedBy"]) == "host") InstallTarget.HOST else InstallTarget.ORG, flag(it["shadowed"]), flag(it["switchedOff"]),
    )
  }

  private fun summary(json: JsonElement) = obj(json).let { o ->
    OrgInstallSummary(
      flag(o["orgWide"]), version(o["orgVersion"]), (o["sites"] as? JsonArray).orEmpty().map(::site),
      (o["hostPinnedIds"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }, (o["availableHostIds"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content },
      flag(o["installedAnywhere"]),
    )
  }

  private fun statusJson(status: UpdateStatus): Map<String, String?> = buildMap {
    put("state", status.state.raw)
    put("installedVersion", status.installedVersion)
    put("availableVersion", status.availableVersion)
    status.unknownReason?.let { put("unknownReason", it.raw) }
  }

  @Test
  fun versionsAreOrderedAsTheConsoleOrdersThem() = cases("compareArtifactVersions").forEach { (args, result) ->
    val order = compareArtifactVersions(version(args[0]), version(args[1]))
    assertEquals(if (result is JsonNull) null else result.jsonPrimitive.content.toInt(), order, args.toString())
  }

  @Test
  fun updateStatesAreWordedAsTheConsoleWordsThem() = cases("updateStateLabel").forEach { (args, result) ->
    val json = obj(args[0])
    val status = UpdateStatus(
      UpdateState.entries.first { it.raw == str(json["state"]) }, str(json["installedVersion"]), str(json["availableVersion"]),
      UnknownReason.entries.firstOrNull { it.raw == str(json["unknownReason"]) },
    )
    assertEquals(result.jsonPrimitive.content, updateStateLabel(status), args.toString())
  }

  @Test
  fun whatAListingOffersAndWhetherAnInstallIsBehindIt() {
    cases("pluginOfferedVersion").forEach { (args, result) ->
      val revoked: Revoked? = when (val second = args[1]) {
        is JsonNull -> null
        is JsonPrimitive -> if (second.content == "all") Revoked.All else Revoked.Versions(emptyList())
        is JsonArray -> Revoked.Versions(second.map { it.jsonPrimitive.content })
        else -> null
      }
      assertEquals(str(result), pluginOfferedVersion(version(args[0]), revoked), args.toString())
    }
    cases("pluginUpdateStatus").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      val pin = if (args[0] is JsonNull) null else UpdateComparablePin(plainJson(args[0]) as Map<String, Any?>)
      val expected = result.jsonObject.mapValues { str(it.value) }
      assertEquals(expected, statusJson(pluginUpdateStatus(pin, str(args[1]))), args.toString())
    }
  }

  @Test
  fun theWorkspacesPicturePicksUpEverySitesPin() = cases("resolveOrgInstallSummary").forEach { (args, result) ->
    val hosts = args[0].jsonArray.map {
      SiteChoice(str(it.jsonObject["id"]).orEmpty(), str(it.jsonObject["label"]).orEmpty(), (it.jsonObject["disabledPlugins"] as? JsonArray)?.map { id -> id.jsonPrimitive.content })
    }
    val pins = obj(args[1]).filterValues { it !is JsonNull }.mapValues { PinVersion(version(obj(it.value)["version"])) }
    val org = if (args[2] is JsonNull) null else PinVersion(version(obj(args[2])["version"]))
    assertEquals(summary(result), resolveOrgInstallSummary(hosts, pins, org, args.getOrNull(3)?.let(::str)), args.toString())
  }

  @Test
  fun anUninstallTouchesTheSitesTheConsoleSaysItTouches() {
    cases("resolveUninstallTargets").forEach { (args, result) ->
      val scope = if (str(args[1]) == "org") InstallTarget.ORG else InstallTarget.HOST
      val expected = result.jsonArray.map { UninstallTarget(str(it.jsonObject["hostId"]).orEmpty(), str(it.jsonObject["label"]).orEmpty(), flag(it.jsonObject["stillCovered"])) }
      assertEquals(expected, resolveUninstallTargets(summary(args[0]), scope, args.getOrNull(2)?.let(::str)), args.toString())
    }
    cases("staleSites").forEach { (args, result) ->
      assertEquals(result.jsonArray.map(::site), staleSites(args[0].jsonArray.map(::site), version(args[1])), args.toString())
    }
  }

  @Test
  fun thePageSaysWhatTheConsoleSays() {
    cases("pluginSiteSetSummary").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, pluginSiteSetSummary(summary(args[0]), args[1].jsonPrimitive.content.toInt()), args.toString()) }
    cases("pluginUpdatePrompt").forEach { (args, result) ->
      val input = obj(args[0])
      val prompt = pluginUpdatePrompt(str(input["name"]).orEmpty(), str(input["latestVersion"]).orEmpty(), str(input["label"]).orEmpty(), flag(input["singleSite"]))
      val expected = result.jsonObject
      assertEquals(str(expected["title"]), prompt.title)
      assertEquals(str(expected["body"]), prompt.body)
      assertEquals(str(expected["others"]), prompt.others)
      assertEquals(str(expected["note"]), prompt.note)
    }
    cases("pluginUpdateAll").forEach { (args, result) ->
      val all = pluginUpdateAll(summary(args[0]), args[1].jsonArray.map(::site), str(args[2]).orEmpty())
      val expected = result.jsonObject
      assertEquals(str(expected["label"]), all.label)
      assertEquals(str(expected["target"]), all.target)
      assertEquals((expected["hostIds"] as? JsonArray)?.map { it.jsonPrimitive.content }, all.hostIds, args.toString())
    }
    cases("installedPluginCaption").forEach { (args, result) ->
      val input = obj(args[0])
      assertEquals(
        result.jsonPrimitive.content,
        installedPluginCaption(
          version(input["version"]), flag(input["orgWide"]), (input["siteLabels"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content },
          (input["switchedOff"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }, input["siteCount"]?.jsonPrimitive?.content?.toInt(),
        ),
        args.toString(),
      )
    }
    cases("installPictureReadPhase").forEach { (args, result) ->
      val input = obj(args[0])
      val pin = input["orgPin"]
      val pending = (pin as? JsonPrimitive)?.content == "pending"
      val read = (pin as? JsonObject)?.let { InstallPinRead(it["data"] != null && it["data"] !is JsonNull, str(it["status"]), flag(it["fromCache"])) }
      assertEquals(result.jsonPrimitive.content, installPictureReadPhase(pending, read, str(input["sitePins"]).orEmpty()), args.toString())
    }
    cases("installPlanOutcome").forEach { (args, result) ->
      val input = obj(args[0])
      val outcome = installPlanOutcome(
        str(input["name"]).orEmpty(), input["installed"]?.jsonPrimitive?.content?.toInt() ?: 0, (input["errors"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content },
        flag(input["orgWide"]), flag(input["updating"]), version(input["version"]), flag(input["saved"]),
        input["leftOut"]?.jsonPrimitive?.content?.toInt() ?: 0,
      )
      assertEquals(str(result.jsonObject["tone"]), outcome.tone, args.toString())
      assertEquals(str(result.jsonObject["text"]), outcome.text, args.toString())
    }
  }

  @Test
  fun theUninstallDialogSaysWhatTheConsoleSaysAndAsksForTheWordWhereItShould() = cases("uninstallImpactView").forEach { (args, result) ->
    val input = obj(args[0])
    val targets = (input["targets"] as? JsonArray).orEmpty().map { UninstallTarget(str(it.jsonObject["hostId"]).orEmpty(), str(it.jsonObject["label"]).orEmpty(), flag(it.jsonObject["stillCovered"])) }
    val impact = uninstallImpactFrom(input["impact"])
    val view = uninstallImpactView(
      str(input["name"]).orEmpty(), if (str(input["scope"]) == "org") InstallTarget.ORG else InstallTarget.HOST, str(input["pluginId"]).orEmpty(), targets, impact, flag(input["failed"]),
    )
    val expected = result.jsonObject
    assertEquals(str(expected["title"]), view.title, args.toString())
    assertEquals(str(expected["confirmLabel"]), view.confirmLabel, args.toString())
    assertEquals(flag(expected["scanning"]), view.scanning, args.toString())
    assertEquals(flag(expected["needsAcknowledgement"]), view.needsAcknowledgement, args.toString())
    assertEquals(str(expected["note"]), view.note, args.toString())
    assertEquals(expected.getValue("alerts").jsonArray.map { str(it.jsonObject["tone"]) to str(it.jsonObject["text"]) }, view.alerts.map { it.tone to it.text }, args.toString())
    assertEquals(
      expected.getValue("sites").jsonArray.map { Triple(str(it.jsonObject["label"]), str(it.jsonObject["pages"]), it.jsonObject.getValue("chips").jsonArray.joinToString("|") { c -> c.jsonPrimitive.content }) },
      view.sites.map { Triple(it.label, it.pages, it.chips.joinToString("|")) },
      args.toString(),
    )
  }

  /** Numbers compare by value (5 and 5.0 are the same JSON number). */
  private fun normalize(value: JsonElement): JsonElement = when (value) {
    is JsonPrimitive -> if (value.isString || value is JsonNull || value.content == "true" || value.content == "false") value else JsonPrimitive(value.content.toDouble())
    is JsonArray -> JsonArray(value.map { normalize(it) })
    is JsonObject -> JsonObject(value.mapValues { normalize(it.value) })
  }

  @Test
  fun aPluginsSettingsAreDrawnFromItsManifestAsTheConsoleDrawsThem() = cases("manifestSettingsScreen").forEach { (args, result) ->
    val screen = manifestSettingsScreen(str(args[0]).orEmpty(), str(args[1]).orEmpty(), args[2])
    if (result is JsonNull) {
      assertEquals(null, screen, args.toString())
    } else {
      assertEquals(normalize(result), normalize(screen!!), args.toString())
      assertEquals(true, com.aglyn.screens.ScreenSpec.parse(screen) != null, args.toString())
    }
  }
}
