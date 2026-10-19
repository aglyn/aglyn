package com.aglyn.core

import com.aglyn.contracts.AccountItemRef
import com.aglyn.contracts.AppAppearance
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** One account's session: signs in as [uid] with any password. */
private class SlotAuth(private val uid: String) : AuthSession {
  val mutable = MutableStateFlow<AuthState>(AuthState.SignedOut)
  override val state: StateFlow<AuthState> = mutable
  override suspend fun idToken(forceRefresh: Boolean) = (mutable.value as? AuthState.SignedIn)?.let { "token-$uid" }
  override suspend fun signInWithEmail(email: String, password: String) { mutable.value = AuthState.SignedIn(AuthUser(uid, email, null)) }
  override suspend fun signOut() { mutable.value = AuthState.SignedOut }
}

/** The person's own document, live, and every merge written to it. */
private class UserDoc(initial: Map<String, Any?>) : FirestoreReader, FirestoreWriter {
  val doc = MutableStateFlow<Map<String, Any?>>(initial)
  val merges = mutableListOf<Map<String, Any?>>()
  override suspend fun get(path: String) = FirestoreDoc("u1", path, doc.value)
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = kotlinx.coroutines.flow.flow {
    doc.collect { emit(Live.Ready(FirestoreDoc("u1", path, it))) }
  }
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = kotlinx.coroutines.flow.flowOf(Live.Ready(emptyList()))
  override suspend fun merge(path: String, data: Map<String, Any?>) { merges += data }
}

class AccountsTest {
  @Test
  fun addingSwitchingAndSigningOutKeepEachAccountApart() = runTest(UnconfinedTestDispatcher()) {
    val slots = mutableMapOf<String, SlotAuth>()
    val prefs = InMemoryKeyValueStore()
    val accounts = AccountSessions(backgroundScope, { slot -> SlotAuth(if (slot == AccountSessions.PRIMARY) "u1" else "u-$slot").also { slots[slot] = it } }, prefs)
    accounts.signInWithEmail("a@example.test", "x")
    assertEquals("u1", (accounts.state.value as AuthState.SignedIn).user.uid)
    assertEquals("token-u1", accounts.idToken())

    // Add account: a fresh slot, signed out, until it signs in; the first account stays signed in.
    accounts.startAdding()
    assertEquals(AuthState.SignedOut, accounts.state.value)
    assertEquals(AccountSessions.PRIMARY, accounts.adding.value)
    accounts.signInWithEmail("b@example.test", "x")
    assertEquals("u-a1", (accounts.state.value as AuthState.SignedIn).user.uid)
    assertNull(accounts.adding.value)
    assertEquals(listOf("u1", "u-a1"), accounts.accounts.value.map { it.uid })
    assertTrue(slots.getValue(AccountSessions.PRIMARY).state.value is AuthState.SignedIn)

    // Switching puts the other account's session behind every call.
    accounts.switchTo(AccountSessions.PRIMARY)
    assertEquals("token-u1", accounts.idToken())

    // Signing out ends the account on screen only; the next one comes on screen.
    accounts.signOut()
    assertEquals("u-a1", (accounts.state.value as AuthState.SignedIn).user.uid)
    assertEquals(listOf("u-a1"), accounts.accounts.value.map { it.uid })

    // A relaunch comes back on the account that was on screen.
    val again = AccountSessions(backgroundScope, { slot -> slots.getValue(slot) }, prefs)
    assertEquals("a1", again.active.value)
  }

  @Test
  fun cancellingAddAccountReturnsToTheAccountOnScreen() = runTest(UnconfinedTestDispatcher()) {
    val accounts = AccountSessions(backgroundScope, { slot -> SlotAuth(if (slot == AccountSessions.PRIMARY) "u1" else "u-$slot") }, InMemoryKeyValueStore())
    accounts.signInWithEmail("a@example.test", "x")
    accounts.startAdding()
    accounts.cancelAdding()
    assertEquals("u1", (accounts.state.value as AuthState.SignedIn).user.uid)
    assertEquals(1, accounts.accounts.value.size)
  }

  @Test
  fun preferencesReadTheDocumentAndWriteEachChange() = runTest(UnconfinedTestDispatcher()) {
    val auth = SlotAuth("u1")
    auth.signInWithEmail("a@example.test", "x")
    val doc = UserDoc(mapOf("pinnedOrgs" to listOf("o1", "o2", "o3", "o4", "o5", "o6"), "recentOrgs" to listOf("o2")))
    val store = AccountPreferencesStore(backgroundScope, auth, doc, doc, InMemoryKeyValueStore(), now = { 42 })
    assertTrue(store.state.value.loaded)
    assertTrue(store.state.value.overCap)
    assertEquals(listOf("o1", "o2", "o3", "o4", "o5"), store.state.value.pinned)
    assertEquals(PinAnswer.FULL, store.pin("o7"))
    store.keepPins(listOf("o2", "o6"))
    assertEquals(mapOf("pinnedOrgs" to listOf("o2", "o6")), doc.merges.last())
    store.openedOrg("o9")
    assertEquals(mapOf("recentOrgs" to listOf("o9", "o2")), doc.merges.last())
    store.setWorkspaceColor("o2", "#112233")
    assertEquals(mapOf("workspaceColors" to mapOf("o2" to "#112233")), doc.merges.last())
    store.setWorkspaceColor("o2", null)
    assertEquals(mapOf("workspaceColors" to mapOf("o2" to FirestoreDelete)), doc.merges.last())
    assertTrue(store.toggleStar(AccountItemRef(id = "site.orders", kind = "screen", label = "Orders", orgId = "o2", screen = "commerce.orders", hostId = "h1")))
    assertEquals(42L, store.state.value.starred.single().starredAtMs)
    // A theme for this device only never reaches the account.
    val writes = doc.merges.size
    store.setTheme(store.state.value.theme.copy(appearance = AppAppearance.DARK), deviceOnly = true)
    assertEquals(writes, doc.merges.size)
    assertEquals(AppAppearance.DARK, store.state.value.theme.appearance)
  }
}
