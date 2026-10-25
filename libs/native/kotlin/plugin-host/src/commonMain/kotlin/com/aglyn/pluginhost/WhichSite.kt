package com.aglyn.pluginhost

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.ui.TextButton

/** One of the workspace's sites, as the person's membership index names it. */
data class WorkspaceSiteChoice(val id: String, val name: String, val address: String?)

/** The workspace's sites the person holds (`users/{uid}/hostMemberships where orgId ==`), live, A to Z. */
@Composable
fun rememberWorkspaceSites(context: NativePluginContext): Live<List<WorkspaceSiteChoice>> {
  val orgId = context.orgId ?: return Live.Ready(emptyList())
  val flow = remember(orgId, context.uid, context.firestore) {
    context.firestore.observe(
      FirestoreQuery(
        "users/${context.uid}/hostMemberships",
        filters = listOf(FirestoreFilter("orgId", FilterOp.EQ, orgId)),
        orderBy = listOf(FirestoreOrder("nameLower")),
        limit = 100,
      ),
    )
  }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(
      value.value.map { doc ->
        val subdomain = doc.string("subdomain")?.ifBlank { null }
        WorkspaceSiteChoice(doc.id, doc.string("displayName")?.ifBlank { null } ?: subdomain ?: doc.id, subdomain)
      },
    )
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}

/**
 * "Which site is this for?": asked before a record is created from a workspace-wide list (the console's org pages pick
 * the site a new record belongs to the same way). A workspace with one site never asks: that site is picked at once.
 */
@Composable
fun WhichSiteDialog(context: NativePluginContext, noun: String, onPick: (WorkspaceSiteChoice) -> Unit, onDismiss: () -> Unit) {
  val sites = rememberWorkspaceSites(context)
  val list = (sites as? Live.Ready)?.value
  if (list != null && list.size == 1) {
    androidx.compose.runtime.LaunchedEffect(list) { onPick(list.single()) }
    return
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("which-site-dialog"),
    title = { Text("Which site is this $noun for?") },
    text = {
      Column {
        Text(
          "A new $noun belongs to one site, which decides who can see it. It shows here with the rest of the workspace.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when (sites) {
          Live.Loading -> Text("Loading sites…", Modifier.padding(top = 12.dp))
          is Live.Failed -> Text("Could not load the sites. Check the connection and try again.", Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.error)
          is Live.Ready -> if (sites.value.isEmpty()) {
            Text("This workspace has no site yet. Create one under Sites first.", Modifier.padding(top = 12.dp))
          } else {
            LazyColumn(Modifier.heightIn(max = 320.dp).padding(top = 8.dp)) {
              items(sites.value, key = { it.id }) { site ->
                Column(
                  Modifier.fillMaxWidth().clickable { onPick(site) }.padding(vertical = 10.dp).testTag("which-site-${site.id}"),
                ) {
                  Text(site.name, style = MaterialTheme.typography.bodyLarge)
                  site.address?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
              }
            }
          }
        }
      }
    },
    confirmButton = {},
    dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("which-site-cancel")) { Text("Cancel") } },
  )
}

/**
 * This context, standing on one of the workspace's sites: what a workspace-wide screen hands a site's own section or
 * record (the console's org pages link a row into the site that holds it). Everything else is the base context's.
 */
fun NativePluginContext.atSite(site: WorkspaceSiteChoice): NativePluginContext = SiteScopedContext(this, site.id, site.address)

private class SiteScopedContext(
  private val base: NativePluginContext,
  override val hostId: String,
  override val hostSlug: String?,
) : NativePluginContext by base {
  // The person's role on this site is read by the screens from the site itself; the base context's belongs to no site.
  override val siteRole: String? get() = null
}

/**
 * A section that is a site's own (templates, a sending identity, a suppression list, overlays), on the whole
 * workspace's page: the workspace's sites, each opening its own section here with a way back to the list, as the
 * console's org pages read each site in turn.
 */
@Composable
fun PerSiteSection(
  context: NativePluginContext,
  title: String,
  explanation: String,
  modifier: Modifier = Modifier,
  content: @Composable (NativePluginContext) -> Unit,
) {
  var picked by rememberSaveable { mutableStateOf<String?>(null) }
  val sites = rememberWorkspaceSites(context)
  val list = (sites as? Live.Ready)?.value
  val site = list?.firstOrNull { it.id == picked }
  if (site != null) {
    Column(modifier) {
      TextButton(onClick = { picked = null }, modifier = Modifier.padding(horizontal = 8.dp).testTag("per-site-back")) {
        Text("‹ Every site · ${site.name}")
      }
      content(context.atSite(site))
    }
    return
  }
  LazyColumn(modifier.testTag("per-site-$title")) {
    item {
      Text(explanation, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
    }
    when (sites) {
      Live.Loading -> item { Text("Loading sites…", Modifier.padding(16.dp)) }
      is Live.Failed -> item { Text("Could not load the sites. Check the connection and try again.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) }
      is Live.Ready -> items(sites.value, key = { it.id }) { choice ->
        com.aglyn.ui.AglynListItem(
          title = choice.name,
          supporting = choice.address,
          icon = com.aglyn.ui.AglynIcons.named("public"),
          trailing = { androidx.compose.material3.Icon(com.aglyn.ui.AglynIcons.named("chevron_right"), contentDescription = null) },
          onClick = { picked = choice.id },
          modifier = Modifier.testTag("per-site-${choice.id}"),
        )
      }
    }
  }
}
