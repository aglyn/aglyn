package com.aglyn.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * One Aglyn account signed in on this device. [slot] names its own session: its own sign-in kept in the platform's
 * credential store (a Firebase app of its own on Android, a credential entry of its own on the desktop). [orgSlugs] are
 * the workspaces it held when last on screen, so a link to one of them can open in that account.
 */
@Serializable
data class SignedInAccount(
  val slot: String,
  val uid: String,
  val email: String? = null,
  val displayName: String? = null,
  val orgSlugs: List<String> = emptyList(),
  /**
   * The account's own picture as last shown (`readAccountPhoto`, AGL-4010), so the switcher draws each account's face
   * without reading anyone's profile; null until it has been on screen, or when it has none.
   */
  val photoUrl: String? = null,
) {
  /** The account's name in the account menu: its display name, else its address. */
  val title: String get() = displayName?.takeIf { it.isNotBlank() } ?: email ?: "Account"
}

/** Makes the session of one slot. Slot [AccountSessions.PRIMARY] is the build's original single session. */
fun interface AccountSessionFactory {
  fun session(slot: String): AuthSession
}

/**
 * Every account signed in on this device, and the one on screen (Add account, Zach 2026-10-18). It IS the shell's
 * [AuthSession]: every call goes to the account on screen, so the console client, Firestore and every store follow a
 * switch without being told, and a store keyed by the signed-in uid starts over for the other account (nothing of one
 * account's ever shows in the other's screens).
 *
 * Adding an account opens a fresh slot whose state is signed out, so the shell shows the sign-in screens for it; once it
 * signs in it is on screen. An account already signed in here, signed in again, goes back to its own slot. Signing out
 * ends only the account on screen; the next one comes on screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountSessions(
  private val scope: CoroutineScope,
  private val factory: AccountSessionFactory,
  private val prefs: KeyValueStore,
  /** Brings a slot's kept sign-in back at launch (the desktop's `restore()`; Firebase on Android restores itself). */
  private val restore: suspend (AuthSession) -> Unit = {},
) : AuthSession {
  private val sessions = mutableMapOf<String, AuthSession>()

  private val stored = MutableStateFlow(readAccounts())
  /** The accounts signed in on this device, in the order they were added. */
  val accounts: StateFlow<List<SignedInAccount>> = stored

  private val activeSlot = MutableStateFlow(prefs.get(ACTIVE_KEY)?.takeIf { slot -> slot == PRIMARY || stored.value.any { it.slot == slot } } ?: PRIMARY)
  /** The slot on screen. */
  val active: StateFlow<String> = activeSlot

  private val addingFrom = MutableStateFlow<String?>(null)
  /** The slot that was on screen before Add account, while the new one has not signed in. */
  val adding: StateFlow<String?> = addingFrom

  private val mutable = MutableStateFlow<AuthState>(AuthState.Restoring)
  override val state: StateFlow<AuthState> = mutable

  private val currentImpersonation = MutableStateFlow<Impersonation?>(null)
  override val impersonation: StateFlow<Impersonation?> = currentImpersonation

  private fun session(slot: String): AuthSession = sessions.getOrPut(slot) {
    factory.session(slot).also { created -> if (slot != PRIMARY) scope.launch { runCatching { restore(created) } } }
  }

  private val current: AuthSession get() = session(activeSlot.value)

  /** The session of one account, for work that must run as it while another is on screen (its device row). */
  fun sessionOf(slot: String): AuthSession = session(slot)

  init {
    // Every kept account's session exists from launch, so each restores and its push row stays its own.
    stored.value.forEach { session(it.slot) }
    activeSlot
      .flatMapLatest { slot -> session(slot).state.map { slot to it } }
      .onEach { (slot, auth) -> settle(slot, auth) }
      .launchIn(scope)
    activeSlot.flatMapLatest { session(it).impersonation }.onEach { currentImpersonation.value = it }.launchIn(scope)
  }

  private fun settle(slot: String, auth: AuthState) {
    if (slot != activeSlot.value) return
    when (auth) {
      is AuthState.SignedIn -> {
        val user = auth.user
        // Signed in again to an account this device already holds: back to its own slot, the fresh one let go.
        val twin = stored.value.firstOrNull { it.uid == user.uid && it.slot != slot }
        if (twin != null && impersonation.value == null) {
          scope.launch { runCatching { session(slot).signOut() } }
          forgetSlot(slot)
          addingFrom.value = null
          activate(twin.slot)
          return
        }
        if (impersonation.value == null) remember(slot, user)
        addingFrom.value = null
        mutable.value = auth
      }
      AuthState.SignedOut -> {
        // Adding: the fresh slot's sign-in screens show.
        if (addingFrom.value != null) {
          mutable.value = AuthState.SignedOut
          return
        }
        val leftover = stored.value.firstOrNull { it.slot == slot }
        if (leftover != null) forgetSlot(slot)
        val next = stored.value.firstOrNull { it.slot != slot }
        if (next != null) activate(next.slot) else mutable.value = AuthState.SignedOut
      }
      AuthState.Restoring -> mutable.value = AuthState.Restoring
    }
  }

  private fun remember(slot: String, user: AuthUser) {
    val existing = stored.value.firstOrNull { it.slot == slot }
    val same = existing?.takeIf { it.uid == user.uid }
    // The same person signing in again keeps the workspaces and photo last shown, until they are read again.
    val next = SignedInAccount(slot, user.uid, user.email, user.displayName, same?.orgSlugs.orEmpty(), same?.photoUrl)
    if (existing == next) return
    write(if (existing == null) stored.value + next else stored.value.map { if (it.slot == slot) next else it })
  }

  private fun forgetSlot(slot: String) = write(stored.value.filter { it.slot != slot })

  private fun write(list: List<SignedInAccount>) {
    stored.value = list
    prefs.set(ACCOUNTS_KEY, Json.encodeToString(ListSerializer(SignedInAccount.serializer()), list))
  }

  private fun activate(slot: String) {
    prefs.set(ACTIVE_KEY, slot)
    activeSlot.value = slot
  }

  /** Puts another signed-in account on screen. A support session on the one on screen ends first. */
  suspend fun switchTo(slot: String) {
    if (slot == activeSlot.value || stored.value.none { it.slot == slot }) return
    if (impersonation.value != null) current.endImpersonation()
    addingFrom.value = null
    activate(slot)
  }

  /** Opens a fresh slot for another account: the shell shows the sign-in screens for it. */
  fun startAdding() {
    if (addingFrom.value != null) return
    val used = stored.value.map { it.slot }.toSet()
    val slot = if (PRIMARY !in used) PRIMARY else (1..MAX_ACCOUNTS).map { "a$it" }.first { it !in used }
    addingFrom.value = activeSlot.value
    activate(slot)
  }

  /** Whether another account can be added (this device keeps at most [MAX_ACCOUNTS]). */
  val canAdd: Boolean get() = stored.value.size < MAX_ACCOUNTS

  /** Leaves Add account without signing in: the account that was on screen comes back. */
  fun cancelAdding() {
    val back = addingFrom.value ?: return
    addingFrom.value = null
    activate(back)
  }

  /** Remembers the workspaces the account on screen holds, so a link to one opens in that account. */
  fun rememberWorkspaces(slugs: List<String>) {
    val slot = activeSlot.value
    val existing = stored.value.firstOrNull { it.slot == slot } ?: return
    val next = slugs.distinct().take(200)
    if (existing.orgSlugs == next) return
    write(stored.value.map { if (it.slot == slot) it.copy(orgSlugs = next) else it })
  }

  /** Remembers the picture the account on screen shows (its profile's, else its sign-in record's), for the switcher. */
  fun rememberPhoto(photoUrl: String?) {
    val slot = activeSlot.value
    val existing = stored.value.firstOrNull { it.slot == slot } ?: return
    if (impersonation.value != null || existing.photoUrl == photoUrl) return
    write(stored.value.map { if (it.slot == slot) it.copy(photoUrl = photoUrl) else it })
  }

  /** The signed-in account, other than the one on screen, that holds the workspace a link's slug names. */
  fun accountForWorkspace(slug: String): SignedInAccount? = stored.value.firstOrNull { it.slot != activeSlot.value && slug in it.orgSlugs }

  // ── AuthSession, as the account on screen ──────────────────────────────

  override suspend fun beginImpersonation(customToken: String, tenantId: String?) = current.beginImpersonation(customToken, tenantId)
  override suspend fun endImpersonation() = current.endImpersonation()
  override suspend fun idToken(forceRefresh: Boolean): String? = current.idToken(forceRefresh)
  override suspend fun signInWithEmail(email: String, password: String) =
    tracked(TelemetryEvent.SIGN_IN, "password") { current.signInWithEmail(email, password) }
  override suspend fun signInWithCustomToken(token: String) =
    tracked(TelemetryEvent.SIGN_IN, "custom_token") { current.signInWithCustomToken(token) }
  override suspend fun signInWithCustomToken(token: String, tenantId: String?) =
    tracked(TelemetryEvent.SIGN_IN, "custom_token") { current.signInWithCustomToken(token, tenantId) }
  override suspend fun signUpWithEmail(email: String, password: String): AuthUser =
    tracked(TelemetryEvent.SIGN_UP, "password") { current.signUpWithEmail(email, password) }
  override suspend fun signInWithGoogle(googleIdToken: String): Boolean =
    tracked(TelemetryEvent.SIGN_IN, "google") { current.signInWithGoogle(googleIdToken) }

  /** Runs a sign-in or sign-up and, once it succeeds, logs [event] with how (AGL-4067): the method only, never who. */
  private inline fun <T> tracked(event: TelemetryEvent, method: String, body: () -> T): T =
    body().also { Telemetry.event(event, mapOf("method" to method)) }
  override suspend fun reload() = current.reload()
  override suspend fun applyActionCode(code: String) = current.applyActionCode(code)
  override suspend fun verifyPasswordResetCode(code: String): String = current.verifyPasswordResetCode(code)
  override suspend fun confirmPasswordReset(code: String, newPassword: String) = current.confirmPasswordReset(code, newPassword)
  override suspend fun providerIds(): List<String> = current.providerIds()
  override suspend fun changePassword(current: String, new: String) = this.current.changePassword(current, new)
  override suspend fun unlinkProvider(providerId: String) = current.unlinkProvider(providerId)
  override suspend fun linkGoogle(googleIdToken: String) = current.linkGoogle(googleIdToken)
  override suspend fun updateDisplayName(name: String) = current.updateDisplayName(name)

  /** Signs out the account on screen only; another signed-in account comes on screen. */
  override suspend fun signOut() = current.signOut()

  companion object {
    const val PRIMARY = "0"
    /** The most accounts one device keeps signed in. */
    const val MAX_ACCOUNTS = 5
    private const val ACCOUNTS_KEY = "aglyn.accounts"
    private const val ACTIVE_KEY = "aglyn.accounts.active"
  }

  private fun readAccounts(): List<SignedInAccount> =
    prefs.get(ACCOUNTS_KEY)?.let { runCatching { Json.decodeFromString(ListSerializer(SignedInAccount.serializer()), it) }.getOrNull() }.orEmpty()
}

/** Reads through whichever reader [pick] names at the moment of the call: the account on screen's. */
class PickedFirestoreReader(private val pick: () -> FirestoreReader) : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? = pick().get(path)
  override suspend fun page(query: FirestoreQuery): FirestorePage = pick().page(query)
  override fun observeDoc(path: String) = pick().observeDoc(path)
  override fun observe(query: FirestoreQuery) = pick().observe(query)
  override suspend fun count(query: FirestoreQuery): Long? = pick().count(query)
  override suspend fun sum(query: FirestoreQuery, field: String): Double? = pick().sum(query, field)
}

/** Writes through whichever writer [pick] names at the moment of the call. */
class PickedFirestoreWriter(private val pick: () -> FirestoreWriter) : FirestoreWriter {
  override suspend fun merge(path: String, data: Map<String, Any?>) = pick().merge(path, data)
  override suspend fun update(path: String, data: Map<String, Any?>) = pick().update(path, data)
  override suspend fun delete(path: String) = pick().delete(path)
  override suspend fun add(collectionPath: String, data: Map<String, Any?>): String = pick().add(collectionPath, data)
}
