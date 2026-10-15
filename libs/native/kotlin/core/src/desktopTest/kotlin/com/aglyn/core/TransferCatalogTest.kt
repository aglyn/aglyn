package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The export picker's catalog, search, presets and reorder, replayed from the cases the console's own functions answer
 * (`libs/native/contracts/transfer-catalog-cases.json`; the Apple kit replays the same file).
 */
class TransferCatalogTest {
  private val file: JsonObject =
    Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "transfer-catalog-cases.json").readText()) as JsonObject

  private fun list(value: JsonElement?): List<JsonElement> = (value as? JsonArray).orEmpty()
  private fun strings(value: JsonElement?): List<String> = list(value).mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  private fun fields(value: JsonElement?) = list(value).mapNotNull { (it as? JsonObject)?.let(TransferFieldInfo::decode) }
  private fun groups(value: JsonElement?) = list(value).mapNotNull { entry ->
    (entry as? JsonObject)?.let { obj -> (obj["id"] as? JsonPrimitive)?.contentOrNull?.let { TransferFieldGroupInfo(it, (obj["label"] as? JsonPrimitive)?.contentOrNull ?: it) } }
  }

  private val catalog = TransferFieldCatalog(fields(file["fields"]), groups(file["groups"]))

  @Test
  fun theFieldsComeInTheConsolesOrderUnderItsGroups() {
    val expected = file["catalog"] as JsonObject
    assertEquals(strings(expected["fieldIds"]), catalog.fields.map { it.id })
    assertEquals(groups(expected["groups"]), catalog.groups)
    // The Aglyn id is added when the resource does not name it, and never twice when it does.
    assertEquals("Aglyn ID", catalog.field("id")?.label)
    assertTrue(catalog.field("id")?.matchKey == true)
    val withId = file["withId"] as JsonObject
    val named = TransferFieldCatalog(fields(withId["standard"]), groups(file["groups"]))
    assertEquals(strings(withId["fieldIds"]), named.fields.map { it.id })
    assertEquals(groups(withId["groups"]), named.groups)
    assertEquals("Record ID", named.field("id")?.label)
  }

  @Test
  fun searchGroupingSelectionPresetsAndReorderReplayTheConsolesAnswers() {
    assertTrue(list(file["search"]).size > 5)
    for (one in list(file["search"]).map { it as JsonObject }) {
      val query = (one["query"] as JsonPrimitive).content
      assertEquals(strings(one["ids"]), catalog.search(query).map { it.id }, query)
    }
    for (one in list(file["group"]).map { it as JsonObject }) {
      val narrowed = (one["fieldIds"] as? JsonArray)?.let { strings(it) }
      val got = catalog.grouped(narrowed)
      val want = list(one["groups"]).map { it as JsonObject }
      assertEquals(want.map { ((it["group"] as JsonObject)["id"] as JsonPrimitive).content }, got.map { it.first.id })
      assertEquals(want.map { strings(it["ids"]) }, got.map { pair -> pair.second.map { it.id } })
    }
    for (one in list(file["selection"]).map { it as JsonObject }) {
      val got = catalog.resolveSelection(strings(one["selected"]), strings(one["ensure"]))
      val expect = one["expect"] as JsonObject
      assertEquals(strings(expect["fieldIds"]), got.fieldIds)
      assertEquals(strings(expect["unknown"]), got.unknown)
    }
    for (one in list(file["preset"]).map { it as JsonObject }) {
      val hintsJson = one["hints"] as? JsonObject
      val hints = TransferPresetHints(strings(hintsJson?.get("matchKeyFieldIds")), strings(hintsJson?.get("minimalFieldIds")))
      val saved = one["saved"] as? JsonObject
      val got = if (saved != null) {
        catalog.resolve(TransferSavedPreset("s", "S", strings(saved["fieldIds"])))
      } else {
        catalog.resolve(TransferPreset.entries.first { it.wire == (one["preset"] as JsonPrimitive).content }, hints)
      }
      val expect = one["expect"] as JsonObject
      assertEquals(strings(expect["fieldIds"]), got.fieldIds, one.toString())
      assertEquals(strings(expect["unknown"]), got.unknown, one.toString())
    }
    for (one in list(file["move"]).map { it as JsonObject }) {
      assertEquals(
        strings(one["expect"]),
        moveTransferField(strings(one["ids"]), (one["from"] as JsonPrimitive).content.toInt(), (one["to"] as JsonPrimitive).content.toInt()),
      )
    }
  }

  @Test
  fun theFieldsAnswerCarriesWhatTheDialogNeeds() {
    val answer = Json.parseToJsonElement(
      """{"resource":{"label":"Contacts","formats":["csv","json","other"],"exportOnly":true},
         "groups":[{"id":"contact","label":"Contact"}],
         "fields":[{"id":"email","label":"Email","group":"contact","matchKey":true,"aliases":["mail"]},
                   {"id":"custom:vip","label":"VIP","custom":true},{"id":"createdAt","system":true,"readOnly":true}],
         "presetHints":{"matchKeyFieldIds":["email"],"minimalFieldIds":["phone"]},
         "resourcePresets":[{"id":"mailchimp","label":"Mailchimp","description":"Their layout","fieldIds":["email"],"headers":{"email":"Email Address"}}],
         "prefs":{"presets":[{"id":"preset-1","label":"Mine","fieldIds":["email","createdAt"]}],
                  "export":{"presetId":"preset-1","fieldIds":["email"],"format":"json","bom":true,"scope":"filter"}}}""",
    ) as JsonObject
    val decoded = TransferFields.decode(answer)
    assertEquals("Contacts", decoded.resourceLabel)
    assertEquals(listOf(TransferFormat.CSV, TransferFormat.JSON), decoded.formats) // a format the app does not know is left out
    assertTrue(decoded.exportOnly)
    assertEquals(listOf(null, "Custom", "System"), decoded.fields.map { it.kind })
    assertEquals(listOf("mail"), decoded.fields.first().aliases)
    assertEquals(TransferPresetHints(listOf("email"), listOf("phone")), decoded.presetHints)
    assertEquals(mapOf("email" to "Email Address"), decoded.resourcePresets.first().headers)
    assertEquals("Their layout", decoded.resourcePresets.first().description)
    assertEquals(listOf("Mine"), decoded.savedPresets.map { it.label })
    assertEquals(TransferExportPrefs("preset-1", listOf("email"), TransferFormat.JSON, true, "filter"), decoded.lastExport)
    // No resource block means a CSV, importable, with nothing remembered.
    val bare = TransferFields.decode(Json.parseToJsonElement("""{"fields":[{"id":"a"}]}""") as JsonObject)
    assertEquals(listOf(TransferFormat.CSV), bare.formats)
    assertFalse(bare.exportOnly)
    assertNull(bare.lastExport)
    assertNotNull(bare.fields.firstOrNull())
  }

  private fun contacts(last: TransferExportPrefs? = null, exportOnly: Boolean = false): Pair<TransferFields, TransferFieldCatalog> {
    val info = TransferFields(
      groups(file["groups"]), fields(file["fields"]), "Contacts", listOf(TransferFormat.CSV, TransferFormat.JSON), exportOnly,
      TransferPresetHints(listOf("name", "email"), listOf("phone")),
      listOf(TransferSavedPreset("mailchimp", "Mailchimp", listOf("email", "name"), "Their layout", mapOf("email" to "Email Address"))),
      listOf(TransferSavedPreset("preset-1", "Mine", listOf("notes", "gone", "email"))), last,
    )
    return info to TransferFieldCatalog(info.fields, info.groups)
  }

  @Test
  fun theDialogOpensOnReimportableOrWhereThePersonLeftOff() {
    var (info, catalog) = contacts()
    val first = TransferExportChoice.opening(info, catalog)
    assertEquals("reimportable", first.presetId)
    assertEquals(listOf("id", "name", "email", "phone", "notes", "orphan", "custom:vip", "tail"), first.fieldIds)
    assertEquals(Triple(TransferFormat.CSV, false, "all"), Triple(first.format, first.bom, first.scope))
    // A resource nothing is imported into opens on Everything, since none of its fields could be written back.
    contacts(exportOnly = true).let { (i, c) -> assertEquals("everything", TransferExportChoice.opening(i, c).presetId) }
    // The resource's own preset asked for wins over the last choice.
    val asked = TransferExportChoice.opening(info, catalog, preset = "mailchimp")
    assertEquals(listOf("mailchimp", "email", "name"), listOf(asked.presetId) + asked.fieldIds)
    // The last choice comes back, ids that no longer exist set aside, a format the resource lacks replaced by its first.
    contacts(TransferExportPrefs(null, listOf("phone", "gone", "email"), TransferFormat.NDJSON, true, "filter")).let { (i, c) ->
      val again = TransferExportChoice.opening(i, c, hasFilter = true)
      assertEquals("custom", again.presetId)
      assertEquals(listOf("phone", "email"), again.fieldIds)
      assertEquals(listOf("gone"), again.unknown)
      assertEquals(Triple(TransferFormat.CSV, true, "filter"), Triple(again.format, again.bom, again.scope))
      // A selection leads, then the filter.
      assertEquals("selection", TransferExportChoice.opening(i, c, selectionCount = 3, hasFilter = true).scope)
    }
    // A last scope of "all" keeps the filter off.
    contacts(TransferExportPrefs("everything", listOf("email"), TransferFormat.JSON, false, "all")).let { (i, c) ->
      assertEquals("all", TransferExportChoice.opening(i, c, hasFilter = true).scope)
      assertEquals("all", TransferExportChoice.opening(i, c, hasFilter = false).scope)
    }
  }

  @Test
  fun choosingAPresetFillsTheFieldsAndChangingThemMakesTheListHandPicked() {
    val (info, catalog) = contacts()
    var choice = TransferExportChoice.opening(info, catalog)
    choice = choice.choose("minimal", catalog, info, info.savedPresets)
    assertEquals(listOf("id", "name", "email", "phone"), choice.fieldIds)
    choice = choice.choose("preset-1", catalog, info, info.savedPresets)
    assertEquals(listOf("notes", "email"), choice.fieldIds)
    assertEquals(listOf("gone"), choice.unknown)
    choice = choice.choose("mailchimp", catalog, info, info.savedPresets)
    assertEquals(mapOf("email" to "Email Address"), choice.headers(info))
    assertEquals(emptyMap(), choice.copy(format = TransferFormat.JSON).headers(info)) // only a CSV carries them
    choice = choice.pick(listOf("email", "name"))
    assertEquals("custom", choice.presetId)
    assertEquals(emptyMap(), choice.headers(info)) // the columns are the fields' labels once a field changes
    assertEquals(emptyList(), choice.unknown)
    assertNull(choice.prefs.presetId)
    assertEquals(listOf("email", "name"), choice.choose("custom", catalog, info, emptyList()).fieldIds)
  }

  @Test
  fun thePresetPickerListsTheConsolesEntriesInItsOrder() {
    val (info, _) = contacts()
    val options = TransferExportChoice.presetOptions(info, info.savedPresets)
    assertEquals(listOf("Everything", "Re-importable", "Minimal", "Mailchimp", "Mine", "Hand-picked"), options.map { it.label })
    assertEquals("The Aglyn ID, the match keys and every field an import can write.", options[1].description)
    assertEquals("Their layout", options[3].description)
    assertEquals("3 fields", options[4].description)
    assertEquals("The fields as you chose them below.", options.last().description)
    assertEquals(listOf("Everything", "Minimal"), TransferExportChoice.presetOptions(contacts(exportOnly = true).first, emptyList()).take(2).map { it.label })
  }

  @Test
  fun aSavedPresetNeedsANameAndFieldsAndIsRememberedAsTheConsoleRemembersIt() {
    val (info, catalog) = contacts()
    var choice = TransferExportChoice.opening(info, catalog)
    assertNull(choice.saving("   ", "p"))
    val kept = choice.saving("  Weekly sync  ", "preset-x")
    assertEquals(TransferSavedPreset("preset-x", "Weekly sync", choice.fieldIds), kept)
    choice = choice.pick(emptyList())
    assertNull(choice.saving("Empty", "p"))
    choice = choice.pick(listOf("email")).copy(bom = true, format = TransferFormat.CSV)
    assertEquals(
      Json.parseToJsonElement("""{"presetId":null,"fieldIds":["email"],"format":"csv","bom":true,"scope":"all"}"""),
      choice.prefs.json(),
    )
  }
}
