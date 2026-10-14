package com.aglyn.plugins.marketplace

import com.aglyn.contracts.ContractJsonFormat
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
}
