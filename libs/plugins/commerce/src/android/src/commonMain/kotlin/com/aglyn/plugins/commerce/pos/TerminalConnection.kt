package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.CardReaderSession
import com.aglyn.hardware.CardReaderSessionSource
import com.aglyn.hardware.CardReaderSetupCode
import com.aglyn.hardware.CardReaderSetupError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * THE CARD READER'S SERVER SIDE.
 *
 * A device reader (the Stripe Terminal SDK) asks for a connection token
 * whenever it needs one. `commerce/pos-terminal-connection-token` mints it
 * for ONE site, scoped to the site's Terminal Location, after the same gate
 * as a sale. Card-present payments settle on the platform account, so there
 * is no merchant to connect on behalf of: the reader never sets
 * `onBehalfOf`, and the server's intent route alone chooses the account.
 */

const val TERMINAL_TOKEN_ROUTE = "/api/commerce/pos-terminal-connection-token"

/** What a failed setup step says: the route's own words for a refusal, else to check the connection. */
fun setupFailureMessage(error: Throwable): String =
  (error as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: "That did not go through. Check the connection and try again."

/** The console's payments onboarding route (Stripe Connect), the one the Apple app's Set up payments row calls. */
const val COMMERCE_CONNECT_ROUTE = "/api/commerce/connect"

/** Payments setup for one site: the Stripe page that finishes it. Only the store's owner may; the route says so to anyone else. */
class PaymentsSetupApi(private val api: ConsoleApiClient, private val hostId: String) {
  /** The Stripe page that finishes payments setup, or null when payments are already set up. */
  suspend fun setupPage(): String? {
    val url = api.request(COMMERCE_CONNECT_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId) }).obj()["url"].str()
    return url?.takeIf { it.startsWith("https://") }
  }
}

/** What the readers panel draws: may this site take cards on a device reader yet. */
data class TerminalReadiness(
  val available: Boolean,
  val testMode: Boolean,
  val merchantReady: Boolean,
  val locationReady: Boolean,
) {
  val ready: Boolean get() = available && merchantReady && locationReady
}

/**
 * The route's 409 as a setup error the screen can act on, no answer at all as
 * [CardReaderSetupCode.UNREACHABLE] (the reader may then start offline,
 * AGL-4039); anything else unchanged.
 */
fun asSetupError(error: Throwable): Throwable {
  val api = error as? ConsoleApiError ?: return error
  if (api.status == 0) return CardReaderSetupError(CardReaderSetupCode.UNREACHABLE, api.message)
  val code = CardReaderSetupCode.of(api.body.obj()["code"].str())
  return if (api.status == 409 && code != null) CardReaderSetupError(code, api.message) else error
}

fun readReaderSession(body: JsonElement?): CardReaderSession {
  val record = body.obj()
  val secret = record["secret"].str() ?: ""
  val locationId = record["locationId"].str() ?: ""
  if (!secret.startsWith("pst_") || !locationId.startsWith("tml_")) {
    throw IllegalStateException("Card readers are not set up for this store yet.")
  }
  return CardReaderSession(
    secret = secret,
    locationId = locationId,
    merchantDisplayName = record["merchantDisplayName"].str()?.ifEmpty { null }?.take(100) ?: "Store",
    testMode = record["testMode"].bool(),
  )
}

/** Commerce's connection tokens, readiness and Terminal Location for one site. */
class CommerceTerminalConnection(private val api: ConsoleApiClient) : CardReaderSessionSource {
  override suspend fun session(hostId: String): CardReaderSession {
    val body = try {
      api.request(TERMINAL_TOKEN_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("action", "token") })
    } catch (error: Throwable) {
      throw asSetupError(error)
    }
    return readReaderSession(body)
  }

  /**
   * Gives the site its Terminal Location from [address] (the route's `location` action), so Tap to Pay and Bluetooth
   * readers can connect. Answers the Location's id; a refusal throws the route's own words ([ConsoleApiError]).
   */
  suspend fun registerLocation(hostId: String, address: ReaderAddress): String {
    val body = api.request(
      TERMINAL_TOKEN_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", "location")
        put("address", address.json())
      },
    )
    return body.obj()["locationId"].str().orEmpty()
  }

  suspend fun readiness(hostId: String): TerminalReadiness {
    val body = api.request(TERMINAL_TOKEN_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("action", "status") }).obj()
    return TerminalReadiness(
      available = body["available"].bool(),
      testMode = body["testMode"].bool(),
      merchantReady = body["merchantReady"].bool(),
      locationReady = body["locationReady"].bool(),
    )
  }
}
