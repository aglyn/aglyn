package com.aglyn.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NotificationCatalog
import com.aglyn.contracts.NotificationCatalogCategory
import com.aglyn.contracts.NotificationChannel
import com.aglyn.contracts.NotificationScope
import com.aglyn.contracts.Notifications
import com.aglyn.contracts.digestEnabled
import com.aglyn.contracts.insightDigestSubscribed
import com.aglyn.contracts.notificationCategoryValue
import com.aglyn.contracts.notificationOverriddenScopes
import com.aglyn.contracts.notificationScopePref
import com.aglyn.contracts.notificationScopeTypePref
import com.aglyn.contracts.notificationTypeValue
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.NOTIFICATION_SETTINGS_FIELD
import com.aglyn.core.NoPush
import com.aglyn.core.digestWrite
import com.aglyn.core.legacyNotificationPrefsOf
import com.aglyn.core.notificationAnswerWrite
import com.aglyn.core.notificationTypeResetWrite
import com.aglyn.core.pushSwitchCategories
import com.aglyn.core.userDocPath
import com.aglyn.core.writeAccountPush
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * The console's notification settings page, natively: what each category and
 * type does in the app, by email and as push at the account; one workspace's
 * or one site's own answers (Inherit, On or Off); the digests; and this
 * device. Every switch writes the one leaf it changes in the person's own
 * `users/{uid}` document, the fields the console's page writes, under the
 * same owner-only rule.
 */

@Suppress("UNCHECKED_CAST")
private fun Any?.asMap(): Map<String, Any?>? = this as? Map<String, Any?>

/** A workspace or a site the scope card can answer for. */
data class SettingsScope(val scope: NotificationScope, val key: String, val label: String)

@Composable
internal fun NotificationSettingsScreen(
  services: ShellServices,
  uid: String,
  catalog: NotificationCatalog = Notifications,
) {
  val doc by remember(uid) { services.firestore.observeDoc(userDocPath(uid)) }.collectAsState(Live.Loading)
  val memberships by remember(uid) { services.firestore.observe(FirestoreQuery("users/$uid/hostMemberships", limit = 100)) }.collectAsState(Live.Loading)
  val workspace by services.workspace.state.collectAsState()
  // Answers written here and not yet echoed back by the document, by leaf.
  var pending by remember(uid) { mutableStateOf(emptyMap<String, Any?>()) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()

  fun write(key: String, value: Any?, merge: Map<String, Any?>) {
    error = null
    pending = pending + (key to value)
    scope.launch {
      try {
        services.writer.merge(userDocPath(uid), merge)
      } catch (failure: Exception) {
        pending = pending - key
        error = "Could not save that change. Check the connection and try again."
      }
    }
  }
  LaunchedEffect(doc) { if (doc is Live.Ready) pending = emptyMap() }

  when (val state = doc) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.testTag("notification-settings-loading"))
    is Live.Failed -> EmptyState(
      "Could not load your notification settings",
      body = "Check the connection and try again.",
      icon = AglynIcons.named("error"),
      modifier = Modifier.testTag("notification-settings-error"),
    )
    is Live.Ready -> {
      val data = state.value?.data
      val settings = data?.get(NOTIFICATION_SETTINGS_FIELD).asMap()
      val legacy = legacyNotificationPrefsOf(data)
      val sites = (memberships as? Live.Ready)?.value.orEmpty().map { WorkspaceStoreSites.siteOf(it.id, it.data) }
      val scopes = workspace.orgs.map { SettingsScope(NotificationScope.Org(it.id), "org:${it.id}", it.name) } +
        sites.map { SettingsScope(NotificationScope.Host(it.first), "host:${it.first}", "${it.second} (site)") }
      val push = pushSwitchCategories(catalog, data, pending.filterKeys { it.startsWith("push:") }.mapKeys { it.key.removePrefix("push:") }.mapValues { it.value as Boolean })
        .flatMap { it.rows }.associateBy { it.type }

      fun pendingBool(key: String): Boolean? = if (key in pending) pending[key] as? Boolean else null
      fun answerKey(s: NotificationScope, key: String, types: Boolean, channel: NotificationChannel) = "$s|$types|$key|${channel.wire}"

      SettingsColumn(error) {
        Text(
          "Choose what reaches you in the app, by email and as push. Form submissions, bookings and orders are emailed until you switch them off; everything else is not.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // What you are told about.
        catalog.categories.forEach { category ->
          AccountCategoryCard(
            category = category,
            categoryValue = { channel ->
              pendingBool(answerKey(NotificationScope.Account, category.id, false, channel))
                ?: notificationCategoryValue(catalog, settings, legacy, category.id, channel)
            },
            typeValue = { type, channel ->
              if (channel == NotificationChannel.PUSH) {
                push[type]?.enabled ?: true
              } else {
                pendingBool(answerKey(NotificationScope.Account, type, true, channel))
                  ?: notificationTypeValue(catalog, settings, legacy, type, channel)
              }
            },
            typeOverridden = { type ->
              NotificationChannel.entries.any { notificationScopeTypePref(settings, NotificationScope.Account, type, it) != null }
            },
            onCategory = { channel, value ->
              write(
                answerKey(NotificationScope.Account, category.id, false, channel),
                value,
                notificationAnswerWrite(settings, NotificationScope.Account, category.id, false, channel, value),
              )
            },
            onType = { type, channel, value ->
              if (channel == NotificationChannel.PUSH) {
                pending = pending + ("push:$type" to value)
                scope.launch {
                  try {
                    writeAccountPush(services.writer, uid, type, value)
                  } catch (failure: Exception) {
                    pending = pending - "push:$type"
                    error = "Could not save that change. Check the connection and try again."
                  }
                }
              } else {
                write(
                  answerKey(NotificationScope.Account, type, true, channel),
                  value,
                  notificationAnswerWrite(settings, NotificationScope.Account, type, true, channel, value),
                )
              }
            },
            onReset = { type -> write("reset:$type", null, notificationTypeResetWrite(type)) },
          )
        }

        ScopeCard(
          catalog = catalog,
          scopes = scopes,
          settings = settings,
          overriddenCount = notificationOverriddenScopes(settings).let { it.orgIds.size + it.hostIds.size },
          pendingAnswer = { key -> if (key in pending) pending[key] as? Boolean to true else null to false },
          answerKey = ::answerKey,
          onAnswer = { s, key, types, channel, value ->
            write(answerKey(s, key, types, channel), value, notificationAnswerWrite(settings, s, key, types, channel, value))
          },
        )

        DigestsCard(
          catalog = catalog,
          digestPrefs = data?.get(catalog.digestPrefsField).asMap(),
          insights = data?.get(catalog.insightDigestsField).asMap(),
          orgName = { id -> workspace.orgs.firstOrNull { it.id == id }?.name },
          pendingBool = ::pendingBool,
          onDigest = { key, value -> write("digest:$key", value, digestWrite(catalog.digestPrefsField, key, value)) },
          onInsight = { orgId, value -> write("insight:$orgId", value, digestWrite(catalog.insightDigestsField, orgId, value)) },
        )

        SectionCard("This device", Modifier.fillMaxWidth().testTag("notification-settings-device")) {
          if (services.push === NoPush) {
            NoticeBanner(
              "Push goes to phones and tablets. This computer shows your notifications in the app instead; the Push switches above still decide what your phones and tablets receive.",
              StatusTone.INFO,
              Modifier.testTag("notification-settings-no-push"),
            )
          } else {
            Text(
              "Push reaches this device when its Push switch is on. The system's own notification settings for ${services.config.brandName} can still silence it.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
    }
  }
}

/** Every site the person holds, across workspaces: id to name. */
internal object WorkspaceStoreSites {
  fun siteOf(id: String, data: Map<String, Any?>): Pair<String, String> =
    id to ((data["displayName"] ?: data["subdomain"] ?: id).toString())
}

@Composable
private fun SettingsColumn(error: String?, content: @Composable () -> Unit) {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier
        .widthIn(max = 760.dp)
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(space(2f))
        .testTag("notification-settings"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      if (error != null) NoticeBanner(error, StatusTone.ERROR, Modifier.testTag("notification-settings-save-error"))
      content()
    }
  }
}

/** One channel's switch inside a row: a chip that reads On or Off. */
@Composable
private fun ChannelChip(channel: NotificationChannel, on: Boolean, owner: String, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
  FilterChip(
    selected = on,
    onClick = { onChange(!on) },
    enabled = enabled,
    label = { Text(channel.label) },
    leadingIcon = { Icon(AglynIcons.named(if (on) "check" else "close"), contentDescription = null) },
    modifier = Modifier
      .semantics {
        contentDescription = "${channel.label} for $owner"
        stateDescription = if (on) "On" else "Off"
      }
      .testTag("channel-$owner-${channel.wire}"),
  )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccountCategoryCard(
  category: NotificationCatalogCategory,
  categoryValue: (NotificationChannel) -> Boolean,
  typeValue: (type: String, NotificationChannel) -> Boolean,
  typeOverridden: (type: String) -> Boolean,
  onCategory: (NotificationChannel, Boolean) -> Unit,
  onType: (type: String, NotificationChannel, Boolean) -> Unit,
  onReset: (type: String) -> Unit,
) {
  var expanded by remember { mutableStateOf(false) }
  SectionCard(
    category.label,
    Modifier.fillMaxWidth().testTag("notification-category-${category.id}"),
    action = {
      TextButton(onClick = { expanded = !expanded }, modifier = Modifier.testTag("expand-${category.id}")) {
        Text(if (expanded) "Hide types" else "Each type")
      }
    },
  ) {
    if (category.description.isNotEmpty()) {
      Text(category.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      for (channel in listOf(NotificationChannel.CONSOLE, NotificationChannel.EMAIL)) {
        ChannelChip(channel, categoryValue(channel), category.id) { onCategory(channel, it) }
      }
    }
    AnimatedVisibility(expanded) {
      Column {
        category.types.forEachIndexed { index, entry ->
          if (index > 0) HorizontalDivider()
          Column(Modifier.padding(vertical = space(1f)).testTag("type-row-${entry.type}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(entry.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
              if (typeOverridden(entry.type)) {
                TextButton(onClick = { onReset(entry.type) }, modifier = Modifier.testTag("reset-${entry.type}")) { Text("Follow ${category.label}") }
              }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              for (channel in NotificationChannel.entries) {
                ChannelChip(channel, typeValue(entry.type, channel), entry.type) { onType(entry.type, channel, it) }
              }
            }
            entry.selfSentEmail?.let {
              Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
  }
}

private val TRI_STATE = listOf(ChipOption("inherit", "Inherit"), ChipOption("on", "On"), ChipOption("off", "Off"))

private fun triKey(value: Boolean?) = when (value) { null -> "inherit"; true -> "on"; false -> "off" }
private fun triValue(key: String): Boolean? = when (key) { "on" -> true; "off" -> false; else -> null }

@Composable
private fun ScopeCard(
  catalog: NotificationCatalog,
  scopes: List<SettingsScope>,
  settings: Map<String, Any?>?,
  overriddenCount: Int,
  pendingAnswer: (String) -> Pair<Boolean?, Boolean>,
  answerKey: (NotificationScope, String, Boolean, NotificationChannel) -> String,
  onAnswer: (NotificationScope, String, Boolean, NotificationChannel, Boolean?) -> Unit,
) {
  var selected by remember { mutableStateOf<String?>(null) }
  val current = scopes.firstOrNull { it.key == selected }
  SectionCard("One workspace or one site", Modifier.fillMaxWidth().testTag("notification-scope-card")) {
    Text(
      "Everything here starts at Inherit, which follows the answers above. A site follows its workspace, and a workspace follows your account.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    ChoiceChipRow(
      options = listOf(ChipOption("account", "Your account")) + scopes.map { ChipOption(it.key, it.label) },
      selected = selected ?: "account",
      onSelect = { selected = it.takeIf { key -> key != "account" } },
      wrap = true,
      modifier = Modifier.testTag("notification-scope-picker"),
    )
    if (current == null) {
      Text(
        if (overriddenCount > 0) "You have changed $overriddenCount of these. Pick one to see what it says." else "You have not changed any of these yet.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      return@SectionCard
    }
    // The staff categories carry no workspace, so a scope never answers for them; the catalog holds none.
    for (category in catalog.categories) {
      var open by remember(current.key, category.id) { mutableStateOf(false) }
      HorizontalDivider()
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(category.label, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
        TextButton(onClick = { open = !open }) { Text(if (open) "Hide types" else "Each type") }
      }
      for (channel in listOf(NotificationChannel.CONSOLE, NotificationChannel.EMAIL)) {
        val key = answerKey(current.scope, category.id, false, channel)
        val (pendingValue, hasPending) = pendingAnswer(key)
        val value = if (hasPending) pendingValue else notificationScopePref(settings, current.scope, category.id, channel)
        TriStateRow(channel.label, "${current.key}-${category.id}-${channel.wire}", value) { onAnswer(current.scope, category.id, false, channel, it) }
      }
      if (open) {
        for (entry in category.types) {
          Text(entry.label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = space(1f)))
          for (channel in listOf(NotificationChannel.CONSOLE, NotificationChannel.EMAIL)) {
            val key = answerKey(current.scope, entry.type, true, channel)
            val (pendingValue, hasPending) = pendingAnswer(key)
            val value = if (hasPending) pendingValue else notificationScopeTypePref(settings, current.scope, entry.type, channel)
            TriStateRow(channel.label, "${current.key}-${entry.type}-${channel.wire}", value) { onAnswer(current.scope, entry.type, true, channel, it) }
          }
        }
      }
    }
  }
}

@Composable
private fun TriStateRow(label: String, tag: String, value: Boolean?, onChange: (Boolean?) -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
    Text(label, Modifier.widthIn(min = 72.dp).padding(end = space(1f)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    ChoiceChipRow(
      options = TRI_STATE,
      selected = triKey(value),
      onSelect = { onChange(triValue(it)) },
      modifier = Modifier.weight(1f).testTag("tri-$tag"),
    )
  }
}

@Composable
private fun DigestsCard(
  catalog: NotificationCatalog,
  digestPrefs: Map<String, Any?>?,
  insights: Map<String, Any?>?,
  orgName: (String) -> String?,
  pendingBool: (String) -> Boolean?,
  onDigest: (String, Boolean) -> Unit,
  onInsight: (String, Boolean) -> Unit,
) {
  SectionCard("Digests", Modifier.fillMaxWidth().testTag("notification-digests")) {
    catalog.digests.forEachIndexed { index, digest ->
      if (index > 0) HorizontalDivider()
      SwitchRow(
        title = digest.label,
        checked = pendingBool("digest:${digest.key}") ?: digestEnabled(digestPrefs, digest.key),
        onCheckedChange = { onDigest(digest.key, it) },
        supporting = digest.description,
        modifier = Modifier.testTag("digest-${digest.key}"),
      )
    }
    val orgIds = insights.orEmpty().keys.sorted()
    if (orgIds.isNotEmpty()) {
      HorizontalDivider()
      Text(
        "Weekly insights: each Monday, what your sites' figures showed that week, here and by email. Turned on from Ask about your numbers.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      for (orgId in orgIds) {
        SwitchRow(
          title = orgName(orgId) ?: "A workspace you left",
          checked = pendingBool("insight:$orgId") ?: insightDigestSubscribed(insights, orgId),
          onCheckedChange = { onInsight(orgId, it) },
          modifier = Modifier.testTag("insight-$orgId"),
        )
      }
    }
  }
}
