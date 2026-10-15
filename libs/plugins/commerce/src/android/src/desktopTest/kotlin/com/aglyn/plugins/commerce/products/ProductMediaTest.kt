package com.aglyn.plugins.commerce.products

import com.aglyn.core.FirestoreTimestamp
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A product's images and paid delivery. The words and rules of paid media replay the console's own, from `functionCases` in
 * libs/native/contracts/function-cases.generated.json (the Apple plugin replays the same file).
 */
class ProductMediaTest {
  private val functions = Json.parseToJsonElement(File("../../../../native/contracts/function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it.isString }?.content

  private fun reference(json: JsonElement): PaidMediaReference {
    val o = json.jsonObject
    return PaidMediaReference(text(o["kind"]).orEmpty(), text(o["id"]).orEmpty(), text(o["name"]).orEmpty(), text(o["hostId"]).orEmpty(), text(o["collectionId"]))
  }

  @Test
  fun theLibraryAMediaRouteIsAskedOfIsTheConsoles() {
    val all = cases("paidMediaScopeBody")
    assertTrue(all.size > 3)
    for (case in all) {
      val expected = case.getValue("result").jsonObject.mapValues { it.value.jsonPrimitive.content }
      assertEquals(expected, paidMediaScopeBody(case.getValue("args").jsonArray[0].jsonPrimitive.content), "${case["args"]}")
    }
  }

  @Test
  fun onlyThePlacesBesideTheProductCount() {
    val all = cases("usesBesideProduct")
    assertTrue(all.size > 3)
    for (case in all) {
      val args = case.getValue("args").jsonArray
      val product = args[1].jsonObject
      val kept = usesBesideProduct(args[0].jsonArray.map(::reference), text(product["hostId"]).orEmpty(), text(product["productId"]))
      assertEquals(case.getValue("result").jsonArray.map(::reference), kept, "$args")
    }
  }

  @Test
  fun whatTheAuthorConfirmsIsTheConsolesSentence() {
    val all = cases("paidMediaConfirmation")
    assertTrue(all.size > 30)
    for (case in all) {
      val options = case.getValue("args").jsonArray[0].jsonObject
      val checked = when (text(options["checked"])) {
        "full" -> PaidMediaUsageCheck.FULL
        "partial" -> PaidMediaUsageCheck.PARTIAL
        else -> PaidMediaUsageCheck.FAILED
      }
      val kind = if (text(options["kind"]) == "download") PaidMediaKind.DOWNLOAD else PaidMediaKind.VIDEO
      assertEquals(text(case["result"]), paidMediaConfirmation(options.getValue("others").jsonArray.map(::reference), checked, kind), "$options")
    }
  }

  @Test
  fun whatAStoredFileNamesIsClassifiedByItsAddress() {
    assertEquals(PaidMediaSource.Asset("host-1", "abc"), paidMediaSource("media:host-1/abc"))
    assertEquals(PaidMediaSource.Asset("org:acme:host-1", "abc"), paidMediaSource("media:org:acme:host-1/abc@pin1"))
    assertEquals(PaidMediaSource.Asset("host-1", "abc"), paidMediaSource("/api/media/cdn/host-1/abc"))
    assertEquals(PaidMediaSource.External, paidMediaSource("https://cdn.example.com/lesson.mp4"))
    assertEquals(PaidMediaSource.Malformed, paidMediaSource("  "))
    assertEquals(PaidMediaSource.Malformed, paidMediaSource("media:"))
    assertEquals(PaidMediaSource.Malformed, paidMediaSource("ftp://files.example/a.zip"))
  }

  @Test
  fun anAssetsDocumentLivesInItsLibrary() {
    assertEquals("hosts/host-1/media/abc", paidMediaDocumentPath("host-1", "abc"))
    assertEquals("orgs/acme/media/abc", paidMediaDocumentPath("org:acme", "abc"))
    assertEquals("orgs/acme/media/abc", paidMediaDocumentPath("org:acme:host-1", "abc"))
  }

  // ---- the lists --------------------------------------------------------------------------------------------------

  private val stored: Map<String, Any?> = mapOf(
    "name" to "Course", "type" to "digital", "slug" to "course", "variants" to listOf(mapOf("id" to "default", "priceUsd" to 40)),
    "mediaUrls" to listOf("media:host-1/one", "media:host-1/two"),
    "digitalFiles" to listOf(mapOf("url" to "media:host-1/f1", "fileName" to "workbook.pdf", "version" to "2", "note" to "kept")),
    "gatedVideos" to listOf(mapOf("url" to "media:host-1/v1", "title" to "Lesson one")),
    "downloadLimit" to 3, "createdAt" to FirestoreTimestamp(1L, 0),
  )

  private fun product(edit: ProductMediaEdit): JsonObject = productMediaSaveJson(stored, edit)

  private fun strings(element: JsonElement?) = (element as? JsonArray)?.map { text(it) }

  @Test
  fun theListsReadFromTheStoredProduct() {
    val draft = productMediaDraftOf(storedProductJson(stored))
    assertTrue(draft.isDigital)
    assertEquals(listOf("media:host-1/one", "media:host-1/two"), draft.images)
    assertEquals(listOf(DigitalFileEntry(0, "media:host-1/f1", "workbook.pdf", "2")), draft.files)
    assertEquals(listOf(MembersVideoEntry(0, "media:host-1/v1", "Lesson one")), draft.videos)
    assertEquals(3, draft.downloadLimit)
    assertEquals(false, productMediaDraftOf(JsonObject(mapOf("type" to JsonPrimitive("physical")))).isDigital)
    assertEquals(emptyList(), productMediaDraftOf(JsonObject(emptyMap())).images)
  }

  @Test
  fun imagesAreAddedAtTheEndAndRemovedByPosition() {
    assertEquals(
      listOf("media:host-1/one", "media:host-1/two", "media:host-1/three", "media:host-1/four"),
      strings(product(ProductMediaEdit.AddImages(listOf("media:host-1/three", "media:host-1/four")))["mediaUrls"]),
    )
    assertEquals(listOf("media:host-1/two"), strings(product(ProductMediaEdit.RemoveImage(0))["mediaUrls"]))
    assertEquals(2, product(ProductMediaEdit.RemoveImage(9))["mediaUrls"]!!.jsonArray.size, "a position that is not there changes nothing")
  }

  @Test
  fun anEditSendsTheWholeStoredProductWithOnlyThatListChanged() {
    val sent = product(ProductMediaEdit.RemoveVideo(0))
    assertEquals(JsonArray(emptyList()), sent["gatedVideos"])
    assertEquals("Course", text(sent["name"]))
    assertEquals("course", text(sent["slug"]))
    assertEquals(1, sent["digitalFiles"]!!.jsonArray.size)
    assertEquals(JsonPrimitive(3), sent["downloadLimit"])
    assertNull(sent["createdAt"], "a stored timestamp is left out; the route keeps its own")
  }

  @Test
  fun aFileCarriesItsVersionAndKeepsWhatElseItHolds() {
    val versioned = product(ProductMediaEdit.SetVersion(0, "2026-10-14-and-some-more-text"))["digitalFiles"]!!.jsonArray[0].jsonObject
    assertEquals("2026-10-14-and-some-", text(versioned["version"]), "a version is cut to 20 characters")
    assertEquals("kept", text(versioned["note"]))
    assertEquals("workbook.pdf", text(versioned["fileName"]))
    val added = product(ProductMediaEdit.AddFile("media:host-1/f2", "bonus.zip"))["digitalFiles"]!!.jsonArray
    assertEquals(2, added.size)
    assertEquals(JsonObject(mapOf("url" to JsonPrimitive("media:host-1/f2"), "fileName" to JsonPrimitive("bonus.zip"))), added.last())
    assertEquals(JsonArray(emptyList()), product(ProductMediaEdit.RemoveFile(0))["digitalFiles"])
  }

  @Test
  fun aVideoIsAddedWithTheFilesNameAsItsTitle() {
    val added = product(ProductMediaEdit.AddVideo("media:host-1/v2", "Lesson two.mp4"))["gatedVideos"]!!.jsonArray
    assertEquals(JsonObject(mapOf("url" to JsonPrimitive("media:host-1/v2"), "title" to JsonPrimitive("Lesson two.mp4"))), added.last())
  }

  @Test
  fun theDownloadLimitIsAtLeastOneAndBlankIsUnlimited() {
    assertEquals(JsonPrimitive(5), product(ProductMediaEdit.SetDownloadLimit(5))["downloadLimit"])
    assertEquals(JsonPrimitive(1), product(ProductMediaEdit.SetDownloadLimit(0))["downloadLimit"])
    assertNull(product(ProductMediaEdit.SetDownloadLimit(null))["downloadLimit"])
    assertEquals(LimitText.Count(4), downloadLimitFromText(" 4 "))
    assertEquals(LimitText.Count(3), downloadLimitFromText("2.6"))
    assertEquals(LimitText.Count(1), downloadLimitFromText("0"))
    assertEquals(LimitText.Unlimited, downloadLimitFromText(""))
    assertNull(downloadLimitFromText("many"))
  }
}
