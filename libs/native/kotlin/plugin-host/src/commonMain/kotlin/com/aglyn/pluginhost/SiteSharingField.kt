package com.aglyn.pluginhost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import com.aglyn.ui.ChoiceRow
import com.aglyn.ui.space

/** One of the workspace's sites as a sharing field lists it. */
data class SharingSite(val id: String, val name: String)

/** The modes a choice can take, as the field offers them. */
enum class SiteSharingMode(val wire: String) { ALL("all"), SELECTED("selected"), ALL_EXCEPT("allExcept") }

val ScopeSharingChoice.mode: SiteSharingMode
  get() = when (this) {
    ScopeSharingChoice.All -> SiteSharingMode.ALL
    is ScopeSharingChoice.Selected -> SiteSharingMode.SELECTED
    is ScopeSharingChoice.AllExcept -> SiteSharingMode.ALL_EXCEPT
  }

/** A choice as it stores, from what a stored document says: null for one that stores none (no reader matches it). */
fun ScopeSharing.choice(): ScopeSharingChoice? = when (this) {
  ScopeSharing.All -> ScopeSharingChoice.All
  is ScopeSharing.Selected -> ScopeSharingChoice.Selected(hostIds)
  is ScopeSharing.AllExcept -> ScopeSharingChoice.AllExcept(exceptHostIds)
  ScopeSharing.None -> null
}

/** Two choices compare by what they pick, in any order (the console's `campaignSharingKey`). */
val ScopeSharingChoice?.key: String
  get() = when (this) {
    null -> "unset"
    ScopeSharingChoice.All -> "all"
    is ScopeSharingChoice.Selected -> "selected:${hostIds.sorted().joinToString(",")}"
    is ScopeSharingChoice.AllExcept -> "allExcept:${exceptHostIds.sorted().joinToString(",")}"
  }

/** The choice as the manage routes read it off the wire (`{ mode, hostIds | exceptHostIds }`). */
val ScopeSharingChoice.wire: Map<String, Any?>
  get() = when (this) {
    ScopeSharingChoice.All -> mapOf("mode" to "all")
    is ScopeSharingChoice.Selected -> mapOf("mode" to "selected", "hostIds" to hostIds)
    is ScopeSharingChoice.AllExcept -> mapOf("mode" to "allExcept", "exceptHostIds" to exceptHostIds)
  }

/**
 * Who something is shared with, or where it runs, as the console's SiteSharingField edits it (AGL-4047): all sites, the
 * sites chosen, or all sites except some. The three modes, then the sites the chosen mode acts on, each box meaning the
 * same thing throughout. "All sites except…" stays on screen with the reason when it cannot be picked; the current choice
 * stays on, since nobody is told they can't have what they have. The Apple kit's SiteSharingField.swift.
 */
@Composable
fun SiteSharingField(
  value: ScopeSharingChoice?,
  onChange: (ScopeSharingChoice) -> Unit,
  sites: List<SharingSite>,
  sitesReady: Boolean,
  modifier: Modifier = Modifier,
  label: String = "Shared with",
  modes: List<SiteSharingMode> = SiteSharingMode.entries,
  maxIncluded: Int? = null,
  readOnly: Boolean = false,
  readOnlyReason: String? = null,
  problem: String? = null,
) {
  val siteIds = sites.map { it.id }
  val exceptOffReason = when {
    !sitesReady -> "Reading this workspace’s sites…"
    sites.size < 2 -> "This workspace has one site, so there is nothing to leave out."
    maxIncluded != null && sites.size > maxIncluded ->
      "This works up to $maxIncluded sites, and this workspace has ${sites.size}. Choose the sites instead."
    else -> null
  }
  val picked = when (value) {
    is ScopeSharingChoice.Selected -> value.hostIds
    is ScopeSharingChoice.AllExcept -> value.exceptHostIds
    else -> emptyList()
  }
  fun choose(mode: SiteSharingMode) {
    when (mode) {
      SiteSharingMode.ALL -> onChange(ScopeSharingChoice.All)
      SiteSharingMode.SELECTED -> if (value !is ScopeSharingChoice.Selected) {
        onChange(ScopeSharingChoice.Selected(if (value is ScopeSharingChoice.AllExcept) siteIds.filter { it !in value.exceptHostIds } else emptyList()))
      }
      SiteSharingMode.ALL_EXCEPT -> if (value !is ScopeSharingChoice.AllExcept) {
        onChange(ScopeSharingChoice.AllExcept(if (value is ScopeSharingChoice.Selected) siteIds.filter { it !in value.hostIds } else emptyList()))
      }
    }
  }
  fun toggle(hostId: String) {
    val next = if (hostId in picked) picked - hostId else picked + hostId
    onChange(if (value is ScopeSharingChoice.AllExcept) ScopeSharingChoice.AllExcept(next) else ScopeSharingChoice.Selected(next))
  }
  val caption: @Composable (String, Boolean) -> Unit = { text, error ->
    Text(
      text, style = MaterialTheme.typography.bodySmall,
      color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(horizontal = space(2f)),
    )
  }
  Column(modifier.fillMaxWidth().testTag("site-sharing-field"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = space(2f)))
    if (readOnly && readOnlyReason != null) caption(readOnlyReason, false)
    if (SiteSharingMode.ALL in modes) {
      ChoiceRow("All sites", value?.mode == SiteSharingMode.ALL, { choose(SiteSharingMode.ALL) }, Modifier.testTag("sharing-mode-all"), enabled = !readOnly)
    }
    if (SiteSharingMode.SELECTED in modes) {
      ChoiceRow(
        "Selected sites", value?.mode == SiteSharingMode.SELECTED, { choose(SiteSharingMode.SELECTED) }, Modifier.testTag("sharing-mode-selected"),
        supporting = "A new site doesn’t get this until you add it.", enabled = !readOnly,
      )
    }
    if (SiteSharingMode.ALL_EXCEPT in modes) {
      ChoiceRow(
        "All sites except…", value?.mode == SiteSharingMode.ALL_EXCEPT, { choose(SiteSharingMode.ALL_EXCEPT) }, Modifier.testTag("sharing-mode-allExcept"),
        supporting = exceptOffReason ?: "A new site gets this automatically.",
        enabled = !readOnly && (exceptOffReason == null || value?.mode == SiteSharingMode.ALL_EXCEPT),
      )
    }
    if (value is ScopeSharingChoice.Selected || value is ScopeSharingChoice.AllExcept) {
      val excepting = value is ScopeSharingChoice.AllExcept
      caption(if (excepting) "Sites to leave out" else "Sites to share with", false)
      if (!sitesReady) {
        caption("Reading this workspace’s sites…", false)
      } else {
        // Leaving out every site this member can name, with no other site known to stay.
        val lastIn = if (excepting) siteIds.filter { it !in picked } else emptyList()
        for (site in sites) {
          val locked = lastIn.size == 1 && lastIn[0] == site.id
          val enabled = !readOnly && !locked
          Row(
            Modifier.fillMaxWidth()
              .toggleable(value = site.id in picked, enabled = enabled, role = Role.Checkbox) { toggle(site.id) }
              .alpha(if (enabled) 1f else 0.5f)
              .padding(horizontal = space(2f))
              .testTag("sharing-site-${site.id}"),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Checkbox(checked = site.id in picked, onCheckedChange = null, enabled = enabled)
            Column {
              Text(site.name, style = MaterialTheme.typography.bodyLarge)
              if (locked) Text("At least one site has to stay in.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
      // Sites on this choice the member cannot name stay on it, and are counted.
      val unnamed = picked.count { it !in siteIds }
      if (unnamed > 0) {
        caption("Also ${if (excepting) "left out" else "shared with"}: ${if (unnamed == 1) "1 site" else "$unnamed sites"} you don’t have access to.", false)
      }
    }
    problem?.let { caption(it, true) }
  }
}
