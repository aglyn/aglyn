package com.aglyn.shell

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/** The pages hub's own window: the site's screens by document id, plus one probe row. */
const val PAGES_WINDOW = 200

/** One page of the site, as the list shows it. */
data class PageRow(
  val id: String,
  val name: String,
  val slug: String,
  val versionId: String?,
  val published: Boolean,
  val home: Boolean,
)

/**
 * The site's pages as the console's pages hub lists them: deleted pages,
 * email screens (the Emails page's) and groups (folders, not pages) left out,
 * the home page first, then by name.
 */
fun pageRows(docs: List<FirestoreDoc>, homeScreenId: String?): List<PageRow> = docs
  .filter { it.data["deletedAt"] == null && it.string("kind") != "email" && it.string("kind") != "group" }
  .map { doc ->
    PageRow(
      id = doc.id,
      name = doc.string("displayName")?.ifBlank { null } ?: "Untitled page",
      slug = doc.string("slug").orEmpty(),
      versionId = doc.string("versionId")?.ifBlank { null },
      published = doc.data["publishedAt"] != null,
      home = doc.id == homeScreenId,
    )
  }
  .sortedWith(compareByDescending<PageRow> { it.home }.thenBy { it.name.lowercase() })

/** The site's pages; each opens in the Besigner, inside the app. */
@Composable
internal fun PagesScreen(services: ShellServices, context: ShellPluginContext, workspace: WorkspaceState) {
  val hostId = workspace.site?.id
  if (hostId == null) {
    EmptyState("Pick a site first", body = "Pages belong to one site.", icon = AglynIcons.named("public"))
    return
  }
  val host by remember(hostId) { services.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val window by remember(hostId) {
    services.firestore.observe(FirestoreQuery("hosts/$hostId/screens", orderBy = listOf(FirestoreOrder("__name__")), limit = PAGES_WINDOW + 1))
  }.collectAsState(Live.Loading)
  val home = ((host as? Live.Ready)?.value)?.string("defaultHomeScreenId")
  when (val live = window) {
    Live.Loading -> SkeletonList(rows = 5)
    is Live.Failed -> EmptyState("Could not load this site's pages", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val rows = pageRows(live.value.take(PAGES_WINDOW), home)
      if (rows.isEmpty()) {
        EmptyState("No pages yet", body = "Pages you add to this site show up here.", icon = AglynIcons.named("description"))
        return
      }
      LazyColumn(Modifier.fillMaxSize().testTag("pages-list")) {
        if (live.value.size > PAGES_WINDOW) {
          item { NoticeBanner("This site has more than $PAGES_WINDOW pages; the first $PAGES_WINDOW are listed.", StatusTone.WARNING, Modifier.testTag("pages-truncated")) }
        }
        items(rows, key = { it.id }) { row ->
          AglynListItem(
            title = row.name,
            supporting = "/" + row.slug,
            icon = AglynIcons.named(if (row.home) "home" else "description"),
            trailing = {
              Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                if (row.home) StatusChip("Home page", StatusTone.INFO)
                StatusChip(if (row.published) "Published" else "Draft", if (row.published) StatusTone.SUCCESS else StatusTone.NEUTRAL)
              }
            },
            onClick = row.versionId?.let { version -> { context.openBesigner(BesignerPaths.screen(row.id, version), ConsoleScope.SITE) } },
            modifier = Modifier.testTag("page-${row.id}"),
          )
        }
      }
    }
  }
}
