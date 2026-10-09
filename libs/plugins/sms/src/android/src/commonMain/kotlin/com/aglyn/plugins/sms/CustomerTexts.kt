package com.aglyn.plugins.sms

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.buyerNotificationEnabled
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.boolField
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

const val ORDER_RECEIPT_ROUTE = "/api/commerce/order-receipt-send"

/** The store settings document the Customer notifications card writes. */
fun storeSettingsPath(hostId: String) = "hosts/$hostId/settings/store"

/** The words under the switch, as the console card words them. */
const val TEXTS_SWITCH_TITLE = "Also send as texts"
const val TEXTS_SWITCH_SUPPORTING = "When an order has the customer’s phone number for updates. Customers can reply STOP to opt out."

/** Whether the platform can text, as the receipt route answers the site's admins and editors. */
sealed interface TextChannel {
  data object Checking : TextChannel

  /** The platform can send texts. */
  data object Available : TextChannel

  /** No provider is set up: the console hides the switch, and so is there nothing to switch. */
  data object Unavailable : TextChannel

  /** Only a site admin or editor sees the channels, as the route holds it. */
  data object NotPermitted : TextChannel

  data object Failed : TextChannel
}

interface TextsApi {
  /** The receipt route's channel answer: `sms` is true when texts can be sent. */
  suspend fun channel(): TextChannel
}

class ConsoleTextsApi(private val api: ConsoleApiClient, private val hostId: String) : TextsApi {
  override suspend fun channel(): TextChannel = try {
    val answer = api.request(ORDER_RECEIPT_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId)) as? JsonObject
    if (answer.boolField("sms") == true) TextChannel.Available else TextChannel.Unavailable
  } catch (failure: CancellationException) {
    throw failure
  } catch (failure: ConsoleApiError) {
    if (failure.status == 403) TextChannel.NotPermitted else TextChannel.Failed
  } catch (failure: Throwable) {
    TextChannel.Failed
  }
}

/** The texts switch for one site: the channel answer, the stored switch and the write. */
class CustomerTexts(
  private val api: TextsApi,
  private val writer: FirestoreWriter,
  private val hostId: String,
  private val scope: CoroutineScope,
) {
  var channel by mutableStateOf<TextChannel>(TextChannel.Checking)
    private set
  var saving by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set

  fun check() {
    channel = TextChannel.Checking
    scope.launch { channel = api.channel() }
  }

  /** The switch, from the store settings document's `buyerNotifications` map. */
  fun enabled(storeSettings: Map<String, Any?>?): Boolean = buyerNotificationEnabled(storeSettings?.get("buyerNotifications"), "texts")

  /** Writes only the `texts` key, so the card beside it can never be overwritten. */
  fun set(on: Boolean) {
    if (saving) return
    saving = true
    error = null
    scope.launch {
      try {
        writer.merge(storeSettingsPath(hostId), mapOf("buyerNotifications" to mapOf("texts" to on)))
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = "That setting could not be saved. Try again."
      } finally {
        saving = false
      }
    }
  }
}
