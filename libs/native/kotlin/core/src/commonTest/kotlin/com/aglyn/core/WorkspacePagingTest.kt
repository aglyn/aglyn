package com.aglyn.core

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A member of 73 workspaces: more than one page. */
private class ManyOrgsReader : FirestoreReader {
  val limits = mutableListOf<Int?>()
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(null))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> {
    if (!query.collectionPath.endsWith("/orgs")) return flowOf(Live.Ready(emptyList()))
    limits += query.limit
    val all = (0 until 73).map { FirestoreDoc("o$it", "users/u1/orgs/o$it", mapOf("orgName" to "Org $it", "role" to "owner")) }
    return flowOf(Live.Ready(all.take(query.limit ?: all.size)))
  }
}

private class OneMember : AuthSession {
  override val state: StateFlow<AuthState> = MutableStateFlow(AuthState.SignedIn(AuthUser("u1", null, null)))
  override suspend fun idToken(forceRefresh: Boolean) = "token"
  override suspend fun signInWithEmail(email: String, password: String) = Unit
  override suspend fun signOut() = Unit
}

class WorkspacePagingTest {
  /** A full window is a page, not the whole list: the console's `loadMoreOrgs` (AGL-2336). */
  @Test
  fun aFullWindowOffersMoreAndGrowingItListensAgain() = runTest(UnconfinedTestDispatcher()) {
    val reader = ManyOrgsReader()
    val store = WorkspaceStore(backgroundScope, OneMember(), reader, InMemoryKeyValueStore())
    assertEquals(50, store.state.value.orgs.size)
    assertTrue(store.state.value.hasMoreOrgs)
    store.loadMoreOrgs()
    assertEquals(73, store.state.value.orgs.size)
    assertFalse(store.state.value.hasMoreOrgs)
    assertEquals(listOf<Int?>(50, 100), reader.limits)
  }
}
