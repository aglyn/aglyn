package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

const val POS_READERS_ROUTE = "/api/commerce/pos-readers"

/** The address a store's card readers are used at, as the readers route takes it. */
data class ReaderAddress(
  val line1: String,
  val city: String,
  val state: String,
  val postalCode: String,
  val country: String,
)

/** Why a pairing cannot be sent, or null. The route checks again. */
fun checkReaderPairing(code: String, address: ReaderAddress?): String? = when {
  !Regex("^[A-Za-z0-9-]{3,64}$").matches(code.trim()) -> "Enter the code the reader shows on its screen."
  address != null && (address.line1.isBlank() || address.city.isBlank() || address.postalCode.isBlank()) ->
    "Enter the street, city and postal code."
  address != null && !Regex("^[A-Za-z]{2}$").matches(address.country.trim()) -> "Enter the two-letter country code, such as US."
  else -> null
}

/**
 * The store's smart readers, through the same route the console's Card
 * readers card calls (`commerce/pos-readers`), under the same staff gate.
 */
interface SmartReadersApi {
  suspend fun pair(code: String, label: String, address: ReaderAddress?)
  suspend fun remove(readerId: String)
}

class ConsoleSmartReadersApi(private val api: ConsoleApiClient, private val hostId: String) : SmartReadersApi {
  override suspend fun pair(code: String, label: String, address: ReaderAddress?) {
    val fields = mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
      "hostId" to JsonPrimitive(hostId),
      "action" to JsonPrimitive("register"),
      "registrationCode" to JsonPrimitive(code.trim()),
      "label" to JsonPrimitive(label.trim()),
    )
    if (address != null) {
      fields["address"] = JsonObject(
        mapOf(
          "line1" to JsonPrimitive(address.line1.trim()),
          "city" to JsonPrimitive(address.city.trim()),
          "state" to JsonPrimitive(address.state.trim()),
          "postalCode" to JsonPrimitive(address.postalCode.trim()),
          "country" to JsonPrimitive(address.country.trim().uppercase()),
        ),
      )
    }
    api.request(POS_READERS_ROUTE, ApiMethod.POST, JsonObject(fields))
  }

  override suspend fun remove(readerId: String) {
    api.request(
      POS_READERS_ROUTE,
      ApiMethod.POST,
      JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "action" to JsonPrimitive("remove"), "readerId" to JsonPrimitive(readerId))),
    )
  }
}
