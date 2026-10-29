package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/** Replays the business profile cases in function-cases.generated.json: the TypeScript's own answers. */
class BusinessProfileCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun plainJson(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plainJson(it.value) }
    is JsonArray -> element.map(::plainJson)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(json: JsonElement?): Map<String, Any?>? = if (json == null || json is JsonNull) null else plainJson(json) as Map<String, Any?>

  /** Plain Kotlin with every number a Double, so equal values compare equal. */
  private fun plain(value: Any?): Any? = when (value) {
    is Number -> value.toDouble()
    is Map<*, *> -> value.mapValues { plain(it.value) }
    is List<*> -> value.map { plain(it) }
    else -> value
  }

  private fun field(f: ResolvedBusinessField<*>?): Any? = f?.let { mapOf("value" to it.value, "origin" to it.origin) }

  private fun json(profile: ResolvedBusinessProfile): Map<String, Any?> = mapOf(
    "name" to field(profile.name), "whatYouDo" to field(profile.whatYouDo), "services" to field(profile.services), "serviceArea" to field(profile.serviceArea),
    "audience" to field(profile.audience), "tone" to field(profile.tone), "toneNotes" to field(profile.toneNotes), "founded" to field(profile.founded),
    "businessType" to profile.businessType,
    "contact" to mapOf("email" to profile.contact.email, "phone" to profile.contact.phone, "address" to profile.contact.address, "hours" to profile.contact.hours),
    "profiles" to profile.profiles, "logo" to profile.logo,
  )

  @Test
  fun resolves() = cases("resolveBusinessProfile").forEach { (args, result) ->
    val input = args[0].jsonObject
    assertEquals(plain(map(result)), plain(json(resolveBusinessProfile(map(input["host"]), map(input["site"]), map(input["workspace"])))), args.toString())
  }

  @Test
  fun sourcesSanitizesAndOwnerWrites() {
    cases("businessProfileSourceOf").forEach { (args, result) ->
      assertEquals((result as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it !is JsonNull }?.content, businessProfileSourceOf(map(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
    cases("sanitizeBusinessProfileValues").forEach { (args, result) -> assertEquals(plain(map(result)), plain(sanitizeBusinessProfileValues(map(args[0]).orEmpty())), args.toString()) }
    cases("businessProfileOwnerWrite").forEach { (args, result) -> assertEquals(plain(map(result)), plain(businessProfileOwnerWrite(map(args[0]), map(args[1]).orEmpty())), args.toString()) }
  }

  @Test
  fun placesAndProfileUrls() {
    cases("normalizeAreaServed").forEach { (args, result) -> assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, normalizeAreaServed(plainJson(args[0])), args.toString()) }
    cases("siteProfileUrls").forEach { (args, result) -> assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, siteProfileUrls(map(args[0])), args.toString()) }
  }
}
