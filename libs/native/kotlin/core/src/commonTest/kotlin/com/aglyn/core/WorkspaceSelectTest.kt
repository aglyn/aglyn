package com.aglyn.core

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

private class SignedInAuth : AuthSession {
  override val state: StateFlow<AuthState> = MutableStateFlow(AuthState.SignedIn(AuthUser("u1", null, null)))
  override suspend fun idToken(forceRefresh: Boolean) = "token"
  override suspend fun signInWithEmail(email: String, password: String) = Unit
  override suspend fun signOut() = Unit
}

private class MembershipReader : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(null))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flowOf(
    Live.Ready(
      if (query.collectionPath.endsWith("/orgs")) {
        listOf(FirestoreDoc("o1", "users/u1/orgs/o1", mapOf("orgName" to "Acme", "role" to "owner")))
      } else {
        listOf("bakery" to "Bakery", "shop" to "Shop").map { (id, name) ->
          FirestoreDoc(id, "users/u1/hostMemberships/$id", mapOf("orgId" to "o1", "displayName" to name, "role" to "admin"))
        }
      },
    ),
  )
}

class WorkspaceSelectTest {
  @Test
  fun aFreshInstallPicksTheSiteItWasAskedFor() = runTest(UnconfinedTestDispatcher()) {
    val store = WorkspaceStore(backgroundScope, SignedInAuth(), MembershipReader(), InMemoryKeyValueStore())
    assertEquals("bakery", store.state.value.site?.id)
    store.selectSite("shop")
    assertEquals("shop", store.state.value.site?.id)
  }
}
