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

/** What the readers panel draws: may this site take cards on a device reader yet. */
data class TerminalReadiness(
  val available: Boolean,
  val testMode: Boolean,
  val merchantReady: Boolean,
  val locationReady: Boolean,
) {
  val ready: Boolean get() = available && merchantReady && locationReady
}

/** The route's 409 as a setup error the screen can act on; anything else unchanged. */
fun asSetupError(error: Throwable): Throwable {
  val api = error as? ConsoleApiError ?: return error
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
