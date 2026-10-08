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
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the bookings rules' cases in function-cases.generated.json: the TypeScript's own answers. */
class BookingRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, is JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map { plain(it) }
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  private fun managed(json: JsonElement) = ContractJsonFormat.decodeFromJsonElement(ManagedBooking.serializer(), json)
  private fun str(element: JsonElement) = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun manageRules() {
    cases("bookingState").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, bookingState(managed(args[0]), args[1].jsonPrimitive.long).raw, args.toString())
    }
    cases("bookingActions").forEach { (args, result) ->
      assertEquals(ContractJsonFormat.decodeFromJsonElement(BookingActions.serializer(), result), bookingActions(managed(args[0]), args[1].jsonPrimitive.long), args.toString())
    }
    cases("bookingOutstandingCents").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.long, bookingOutstandingCents(managed(args[0])), args.toString())
    }
    cases("checkInRefusal").forEach { (args, result) ->
      assertEquals(str(result), checkInRefusal(managed(args[0]), args[1].jsonPrimitive.booleanOrNull!!, args[2].jsonPrimitive.long), args.toString())
    }
    cases("rescheduleRefusal").forEach { (args, result) ->
      assertEquals(str(result), rescheduleRefusal(managed(args[0]), args[1].jsonPrimitive.long, args[2].jsonPrimitive.long), args.toString())
    }
    cases("bookingDurationMs").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.long, bookingDurationMs(managed(args[0]), args[1].jsonPrimitive.doubleOrNull!!), args.toString())
    }
  }

  @Test
  fun reminderBand() {
    cases("isBookingReminderDue").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      assertEquals(result.jsonPrimitive.booleanOrNull, isBookingReminderDue(plain(args[0]) as Map<String, Any?>, args[1].jsonPrimitive.long), args.toString())
    }
  }

  @Test
  fun priceRules() {
    fun service(json: JsonElement): Pair<Any?, Any?> = (plain(json) as? Map<*, *>).let { it?.get("priceUsd") to it?.get("priceDisplay") }
    cases("bookingPriceText").forEach { (args, result) ->
      val (price, display) = service(args[0])
      assertEquals(result.jsonPrimitive.content, bookingPriceText(price, display), args.toString())
    }
    cases("bookingChargeUsd").forEach { (args, result) ->
      val (price, display) = service(args[0])
      assertEquals(result.jsonPrimitive.doubleOrNull, bookingChargeUsd(price, display), args.toString())
    }
    cases("bookingPriceDisplay").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, bookingPriceDisplay(plain(args[0])).raw, args.toString())
    }
  }

  @Test
  fun inPersonRules() {
    cases("bookingInPersonState").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      assertEquals(result.jsonPrimitive.content, bookingInPersonState(plain(args[0]) as Map<String, Any?>, args[1].jsonPrimitive.long).raw, args.toString())
    }
    cases("bookingInPersonAmountProblem").forEach { (args, result) ->
      val value = (args[0] as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.doubleOrNull
      val cents = value?.takeIf { it == kotlin.math.floor(it) }?.toLong()
      assertEquals(str(result), bookingInPersonAmountProblem(cents), args.toString())
    }
    cases("bookingSuggestedCents").forEach { (args, result) ->
      val service = plain(args[0]) as? Map<*, *>
      val expected = (result as? JsonPrimitive)?.takeIf { it !is JsonNull }?.long
      val ours = if (service == null) null else bookingSuggestedCents(service["priceUsd"], service["priceDisplay"])
      assertEquals(expected, ours, args.toString())
    }
  }

  @Test
  fun serviceForm() {
    cases("parseBookingWindows").forEach { (args, result) ->
      assertEquals(ContractJsonFormat.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(BookingWindow.serializer()), result), parseBookingWindows(args[0].jsonPrimitive.content), args.toString())
    }
    cases("formatBookingWindows").forEach { (args, result) ->
      val windows = (args[0] as? JsonArray)?.let { ContractJsonFormat.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(BookingWindow.serializer()), it) }
      assertEquals(result.jsonPrimitive.content, formatBookingWindows(windows), args.toString())
    }
    cases("newBookingServiceDraft").forEach { (args, result) ->
      assertEquals(ContractJsonFormat.decodeFromJsonElement(BookingServiceDraft.serializer(), result), newBookingServiceDraft(args[0].jsonPrimitive.content), args.toString())
    }
    cases("bookingServiceDraftFrom").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      assertEquals(ContractJsonFormat.decodeFromJsonElement(BookingServiceDraft.serializer(), result), bookingServiceDraftFrom(plain(args[0]) as Map<String, Any?>), args.toString())
    }
    cases("bookingServiceFields").forEach { (args, result) ->
      val draft = ContractJsonFormat.decodeFromJsonElement(BookingServiceDraft.serializer(), args[0])
      assertEquals(ContractJsonFormat.decodeFromJsonElement(BookingServiceFields.serializer(), result), bookingServiceFields(draft), args.toString())
    }
    cases("bookingServiceDraftProblem").forEach { (args, result) ->
      assertEquals(str(result), bookingServiceDraftProblem(args[0].jsonObject.getValue("name").jsonPrimitive.content), args.toString())
    }
  }
}
