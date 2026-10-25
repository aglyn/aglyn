package com.aglyn.core

import com.aglyn.contracts.AccountItemRef
import com.aglyn.contracts.AppThemePrefs
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PinOrgOutcome
import com.aglyn.contracts.RecentItem
import com.aglyn.contracts.StarColor
import com.aglyn.contracts.StarOutcome
import com.aglyn.contracts.StarredItem
import com.aglyn.contracts.accountItemKey
import com.aglyn.contracts.keepPinnedOrgs
import com.aglyn.contracts.movePinnedOrg
import com.aglyn.contracts.pinOrg
import com.aglyn.contracts.pinnedOrgsOverCap
import com.aglyn.contracts.readAccountName
import com.aglyn.contracts.readAccountPhoto
import com.aglyn.contracts.readAppTheme
import com.aglyn.contracts.readPinnedOrgs
import com.aglyn.contracts.readRecentOrgs
import com.aglyn.contracts.readRecents
import com.aglyn.contracts.readStarred
import com.aglyn.contracts.readWorkspaceColors
import com.aglyn.contracts.recordRecent
import com.aglyn.contracts.recordRecentOrg
import com.aglyn.contracts.replacePinnedOrg
import com.aglyn.contracts.setStarColor
import com.aglyn.contracts.toPlain
import com.aglyn.contracts.toggleStarred
import com.aglyn.contracts.unpinOrg
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * What a person keeps on their account (`users/{uid}`, AGL-3943): the same fields the console reads, so the console's
 * pins and the app's are one list. [stored] is every pin as stored (may exceed five for an account that pinned before
 * the cap); [pinned] is the five in force.
 */
data class AccountPreferences(
  val loaded: Boolean = false,
  val stored: List<String> = emptyList(),
  val recentOrgs: List<String> = emptyList(),
  val starred: List<StarredItem> = emptyList(),
  val recents: List<RecentItem> = emptyList(),
  val workspaceColors: Map<String, String> = emptyMap(),
  /** The synced theme. */
  val syncedTheme: AppThemePrefs = Contracts.defaultAppTheme,
  /** This device's own theme, when "Apply to this device only" is on. */
  val deviceTheme: AppThemePrefs? = null,
  /**
   * The profile's own picture, name and notification sound fields (`photoUrl`, `firstName`, `lastName`,
   * `notificationSound`), the picture and name read through [photo] and [name] so the person shows as the console shows
   * them (AGL-4010).
   */
  val identity: Map<String, String> = emptyMap(),
) {
  /** The person's own picture: the profile's, else the sign-in record's, else null (draw initials). */
  fun photo(authPhotoUrl: String?): String? = readAccountPhoto(identity, authPhotoUrl)

  /** The person's own name: the profile's first and last name, else the sign-in record's display name, else the email. */
  fun name(authDisplayName: String?, email: String?): String = readAccountName(identity, authDisplayName, email)

  val pinned: List<String> get() = com.aglyn.contracts.effectivePinnedOrgs(stored)
  val overCap: Boolean get() = pinnedOrgsOverCap(stored)

  /** The theme in force on this device. */
  val theme: AppThemePrefs get() = deviceTheme ?: syncedTheme

  fun isStarred(item: AccountItemRef): Boolean = starred.any { accountItemKey(it) == accountItemKey(item) }
}

/** What pinning answered: done, already pinned, or full ("Pinned is full. Replace one?"). */
enum class PinAnswer { PINNED, ALREADY, FULL }

/**
 * The signed-in person's account preferences, read live from `users/{uid}` and written back through [writer] under the
 * same rules as the console's own writes (caps held by the rules too). Every change shows at once and is then written.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountPreferencesStore(
  private val scope: CoroutineScope,
  auth: AuthSession,
  private val firestore: FirestoreReader,
  private val writer: FirestoreWriter,
  private val device: KeyValueStore,
  private val now: () -> Long = ::nowMillis,
) {
  private val mutable = MutableStateFlow(AccountPreferences())
  val state: StateFlow<AccountPreferences> = mutable
  private var uid: String? = null

  /** Why the last write failed, in words for a snackbar; null once read. */
  val writeError = MutableStateFlow<String?>(null)

  init {
    auth.state
      .map { (it as? AuthState.SignedIn)?.user?.uid }
      .distinctUntilChanged()
      .flatMapLatest { signedIn ->
        uid = signedIn
        // Another account's preferences never show for this one, even for a moment.
        mutable.value = AccountPreferences(deviceTheme = signedIn?.let(::readDeviceTheme))
        if (signedIn == null) flowOf(null) else firestore.observeDoc("users/$signedIn").map { signedIn to it }
      }
      .onEach { entry ->
        val (forUid, live) = entry ?: return@onEach
        if (live !is Live.Ready || forUid != uid) return@onEach
        val data = live.value?.data
        mutable.value = AccountPreferences(
          loaded = true,
          stored = readPinnedOrgs(data),
          recentOrgs = readRecentOrgs(data),
          starred = readStarred(data),
          recents = readRecents(data),
          workspaceColors = readWorkspaceColors(data),
          syncedTheme = readAppTheme(data),
          deviceTheme = readDeviceTheme(forUid),
          identity = listOf(Contracts.accountPhotoField, "firstName", "lastName", Contracts.notificationSoundField)
            .mapNotNull { key -> (data?.get(key) as? String)?.let { key to it } }.toMap(),
        )
      }
      .launchIn(scope)
  }

  private fun write(fields: Map<String, Any?>, change: (AccountPreferences) -> AccountPreferences) {
    val signedIn = uid ?: return
    mutable.value = change(mutable.value)
    scope.launch {
      runCatching { writer.merge("users/$signedIn", fields) }.onFailure {
        writeError.value = "Could not save that change. Check the connection and try again."
      }
    }
  }

  private fun writePins(next: List<String>) = write(mapOf(Contracts.pinnedOrgsField to next)) { it.copy(stored = next) }

  /** Pins a workspace at the end; a full list is answered, never made room in quietly. */
  fun pin(orgId: String): PinAnswer {
    val result = pinOrg(state.value.stored, orgId)
    return when (result.outcome) {
      PinOrgOutcome.PINNED -> { writePins(result.pinned); PinAnswer.PINNED }
      PinOrgOutcome.FULL -> PinAnswer.FULL
      else -> PinAnswer.ALREADY
    }
  }

  fun unpin(orgId: String) = writePins(unpinOrg(state.value.stored, orgId))

  /** The answer to "Pinned is full. Replace one?". */
  fun replacePin(replacing: String, orgId: String) = writePins(replacePinnedOrg(state.value.stored, replacing, orgId))

  /** The answer to "Keep which 5 pins?". */
  fun keepPins(keep: List<String>) = writePins(keepPinnedOrgs(state.value.stored, keep))

  fun movePin(orgId: String, offset: Int) = writePins(movePinnedOrg(state.value.stored, orgId, offset))

  /** Puts the pins in this order (a drag on the rail): the pinned ids only, never more than five. */
  fun reorderPins(order: List<String>) {
    val current = state.value.pinned.toSet()
    writePins(order.filter { it in current }.distinct().take(Contracts.pinnedOrgsMax.toInt()))
  }

  /** The person opened this workspace: it moves to the front of the recent ones (no write when it already is). */
  fun openedOrg(orgId: String) {
    if (!state.value.loaded || state.value.recentOrgs.firstOrNull() == orgId) return
    val next = recordRecentOrg(state.value.recentOrgs, orgId)
    write(mapOf(Contracts.recentOrgsField to next)) { it.copy(recentOrgs = next) }
  }

  /** Stars or unstars; false when the list is full. */
  fun toggleStar(item: AccountItemRef): Boolean {
    val result = toggleStarred(state.value.starred, item, now())
    if (result.outcome == StarOutcome.FULL) return false
    write(mapOf(Contracts.starredField to result.starred.map { it.toPlain() })) { it.copy(starred = result.starred) }
    return true
  }

  fun setStarColor(key: String, color: StarColor?) {
    val next = setStarColor(state.value.starred, key, color)
    write(mapOf(Contracts.starredField to next.map { it.toPlain() })) { it.copy(starred = next) }
  }

  /** The person opened a screen or record: it moves to the front of Recents (no write when it already is). */
  fun opened(item: AccountItemRef) {
    if (!state.value.loaded) return
    val first = state.value.recents.firstOrNull()
    if (first != null && accountItemKey(first) == accountItemKey(item) && first.label == item.label) return
    val next = recordRecent(state.value.recents, item, now())
    write(mapOf(Contracts.recentsField to next.map { it.toPlain() })) { it.copy(recents = next) }
  }

  /** Picks a color for a workspace (`#RRGGBB`), or clears the pick with null. */
  fun setWorkspaceColor(orgId: String, color: String?) {
    val next = state.value.workspaceColors.toMutableMap().apply { if (color == null) remove(orgId) else put(orgId, color) }
    write(mapOf(Contracts.workspaceColorsField to mapOf(orgId to (color ?: FirestoreDelete)))) { it.copy(workspaceColors = next) }
  }

  /** Saves the theme: on the account, or on this device only. */
  fun setTheme(theme: AppThemePrefs, deviceOnly: Boolean) {
    val signedIn = uid ?: return
    if (deviceOnly) {
      device.set(deviceThemeKey(signedIn), Json.encodeToString(AppThemePrefs.serializer(), theme))
      mutable.value = mutable.value.copy(deviceTheme = theme)
      return
    }
    device.set(deviceThemeKey(signedIn), null)
    write(mapOf(Contracts.appThemeField to theme.toPlain())) { it.copy(syncedTheme = theme, deviceTheme = null) }
  }

  private fun readDeviceTheme(uid: String): AppThemePrefs? =
    device.get(deviceThemeKey(uid))?.let { runCatching { Json.decodeFromString(AppThemePrefs.serializer(), it) }.getOrNull() }

  companion object {
    fun deviceThemeKey(uid: String) = "aglyn.theme.device.$uid"
  }
}
