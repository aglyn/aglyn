package com.aglyn.plugins.marketplace

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.KeyValueStore
import com.aglyn.core.Live
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlin.test.Test

/**
 * Selling asks each section's key from the member's stamp (AGL-4047), driven through the real screen: a member whose stamp
 * refuses a key sees that section's control off with the permission named, whatever their role, and a key the stamp grants
 * turns it on, whatever their role.
 */
@OptIn(ExperimentalTestApi::class)
class SellerGatesUiTest {
  private class Reader(private val docs: Map<String, Map<String, Any?>>) : FirestoreReader {
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flowOf(Live.Ready(emptyList()))
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> =
      flowOf(Live.Ready(docs[path]?.let { FirestoreDoc(path.substringAfterLast('/'), path, it) }))
    override suspend fun get(path: String): FirestoreDoc? = docs[path]?.let { FirestoreDoc(path.substringAfterLast('/'), path, it) }
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  }

  private class Member(reader: FirestoreReader, private val role: String) : NativePluginContext {
    override val uid = "u1"
    override val orgId = "o1"
    override val hostId: String? = null
    override val orgSlug = "acme"
    override val hostSlug: String? = null
    override val orgRole = role
    override val firestore = reader
    override val api = ConsoleApiClient(
      "http://localhost",
      HttpClient(MockEngine { respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }) { expectSuccess = false },
      { "t" },
      sleep = {},
    )
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  private fun member(role: String, stamp: Map<String, Boolean>) =
    Member(Reader(mapOf("orgs/o1/members/u1" to mapOf("role" to role, "resolvedPermissions" to stamp))), role)

  @Test
  fun anOwnerWithoutTheKeySeesEachControlRefusedByName() = runDesktopComposeUiTest {
    val refused = mapOf(PUBLISHER_PROFILE_KEY to false, MANAGE_LISTINGS_KEY to false, PAYOUTS_KEY to false)
    setContent { AglynTheme { SellScreen(member("owner", refused), initialSection = "payouts") } }
    waitForIdle()
    onNodeWithTag("seller-payouts-refusal").performScrollTo()
    onNodeWithText("Your role does not include \"Manage marketplace payouts\" — ask an organization admin").assertExists()
    onNodeWithTag("seller-payouts").assertIsNotEnabled()
  }

  @Test
  fun aViewerGrantedTheKeyMayUseTheControl() = runDesktopComposeUiTest {
    setContent { AglynTheme { SellScreen(member("viewer", mapOf(PAYOUTS_KEY to true)), initialSection = "payouts") } }
    waitForIdle()
    onNodeWithTag("seller-payouts").performScrollTo().assertIsEnabled()
    onNodeWithTag("seller-payouts-refusal").assertDoesNotExist()
  }

  @Test
  fun theProfileAsksItsOwnKey() = runDesktopComposeUiTest {
    setContent { AglynTheme { SellScreen(member("owner", mapOf(PUBLISHER_PROFILE_KEY to false)), initialSection = "profile") } }
    waitForIdle()
    onNodeWithTag("seller-save-refusal").performScrollTo()
    onNodeWithText("Your role does not include \"Edit the publisher profile\" — ask an organization admin").assertExists()
    onNodeWithTag("seller-save").assertIsNotEnabled()
  }
}
