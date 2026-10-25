package com.aglyn.site.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.SeoAuditReport
import com.aglyn.contracts.SeoFinding
import com.aglyn.contracts.SeoSeverity
import com.aglyn.contracts.SeoTargetKeywordRow
import com.aglyn.contracts.seoAuditFindingCount
import com.aglyn.contracts.seoFindingLabel
import com.aglyn.contracts.seoKeywordLinesFromRows
import com.aglyn.contracts.seoKeywordRowsFromLines
import com.aglyn.contracts.seoNormalizePath
import com.aglyn.contracts.SeoFindingCode
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.jsNumber
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.InputChoice
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** `GET /api/hosts/seo-check`: the site's SEO check, the console's own, with the keyword lines it should look for. */
suspend fun runSeoCheck(api: ConsoleApiClient, hostId: String, keywords: String): SeoAuditReport {
  val answer = api.request("/api/hosts/seo-check", ApiMethod.GET, query = buildMap {
    put("hostId", hostId)
    if (keywords.isNotBlank()) put("keywords", keywords.take(Contracts.seoKeywordLinesMaxChars.toInt()))
  }) as? JsonObject
  val report = answer?.get("report") ?: throw IllegalStateException("The SEO check could not run — try again.")
  return ContractJsonFormat.decodeFromJsonElement(SeoAuditReport.serializer(), report)
}

/** A page the keywords can be for: its path and its name. */
data class SeoKeywordPage(val path: String, val name: String)

/** The site's routed pages, by name and path, for the keyword page picker: the routing map says each path, the screens their names. */
internal fun seoKeywordPages(host: Map<String, Any?>, names: Map<String, String>): List<SeoKeywordPage> =
  ((host["screens"] as? Map<*, *>).orEmpty())
    .mapNotNull { (id, route) -> (route as? String)?.let { path -> (id as? String)?.let { it to path } } }
    .map { (id, route) ->
      val path = if (route == "/") "/" else "/$route"
      SeoKeywordPage(path, names[id]?.takeIf { it.isNotBlank() } ?: path)
    }
    .sortedBy { it.path }

private fun tone(finding: SeoFinding) = when (finding.severity) {
  SeoSeverity.HIGH -> StatusTone.ERROR
  SeoSeverity.MEDIUM -> StatusTone.WARNING
  else -> StatusTone.NEUTRAL
}

/**
 * The site's SEO check, at the top of the SEO section: every published page held to what a search result and a crawler
 * need, and the site held to what a search engine and an agent read about it. It runs when asked, changes nothing, and
 * reads the target keywords by page that are picked here rather than typed as lines.
 */
@Composable
fun SeoCheckCard(context: NativePluginContext, hostId: String, host: Map<String, Any?>, onChecked: (keywords: String) -> Unit = {}) {
  val scope = rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope, roleHint = "an author, editor or admin") }
  var rows by remember { mutableStateOf<List<SeoTargetKeywordRow>>(emptyList()) }
  var report by remember { mutableStateOf<SeoAuditReport?>(null) }
  var busy by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<String?>(null) }
  // The screen names are read once, and only when a keyword row exists: Setup → SEO opens without paying for the screen list.
  val screens by remember(hostId, rows.isNotEmpty(), context.firestore) {
    if (rows.isNotEmpty()) context.firestore.observe(FirestoreQuery("hosts/$hostId/screens", orderBy = listOf(FirestoreOrder("__name__")), limit = 200)) else kotlinx.coroutines.flow.flowOf(Live.Loading)
  }.collectAsState(Live.Loading)
  val names = ((screens as? Live.Ready)?.value).orEmpty().associate { it.id to (it.string("displayName") ?: it.string("name").orEmpty()) }
  val pages = seoKeywordPages(host, names)

  SectionCard("SEO check") {
    Text(
      "Checks every published page for what search results and AI agents need: titles, descriptions, headings, image descriptions, links and your target keywords. It changes nothing on your site.",
      style = MaterialTheme.typography.bodyMedium,
    )
    SeoTargetKeywords(rows, { rows = it }, pages, enabled = !busy)
    Button(
      onClick = {
        busy = true
        notice = null
        scope.launch {
          try {
            val lines = seoKeywordLinesFromRows(rows)
            report = runSeoCheck(context.api, hostId, lines)
            onChecked(lines)
          } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            notice = runner.describe(error)
          } finally {
            busy = false
          }
        }
      },
      enabled = !busy,
      modifier = Modifier.testTag("seo-check-run"),
    ) { Text(if (busy) "Checking…" else if (report != null) "Check again" else "Run the check") }
    notice?.let { NoticeBanner(it, StatusTone.WARNING) }
    report?.let { SeoReport(it) }
  }
}

@Composable
private fun SeoReport(report: SeoAuditReport) {
  val findings = seoAuditFindingCount(report)
  val listed = report.pages.size + report.skipped.toInt()
  Column(Modifier.fillMaxWidth().testTag("seo-check-results"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    HorizontalDivider()
    Text(
      "Score ${jsNumber(report.score)} of 100 · ${report.pages.size} ${if (report.pages.size == 1) "page" else "pages"} · $findings ${if (findings == 1) "finding" else "findings"}",
      style = MaterialTheme.typography.titleSmall,
    )
    Text(
      if (report.site.any { it.code == SeoFindingCode.SEARCH_DISCOURAGED }) {
        "Launch status: hidden. Search engines are asked to stay away from the whole site, and its sitemap lists no pages."
      } else {
        "Launch status: open to search engines, with $listed ${if (listed == 1) "page" else "pages"} listed."
      },
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.testTag("seo-launch-status"),
    )
    if (report.skipped > 0) NoticeBanner("${report.skipped} more published ${if (report.skipped == 1L) "page was" else "pages were"} not checked this time.", StatusTone.INFO)
    for (entry in report.site) NoticeBanner("${seoFindingLabel(entry)} — ${entry.message}", if (entry.severity == SeoSeverity.HIGH) StatusTone.ERROR else StatusTone.INFO)
    for (line in report.notes) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (report.pages.isEmpty()) {
      Text("This site has no published public pages to check.", style = MaterialTheme.typography.bodyMedium)
    } else {
      report.pages.forEachIndexed { index, page ->
        if (index > 0) HorizontalDivider()
        Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text(page.name, style = MaterialTheme.typography.bodyLarge)
          Text("${page.path} · score ${page.score}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (page.findings.isEmpty()) {
            Text("Nothing found", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
              for (finding in page.findings) StatusChip(seoFindingLabel(finding), tone(finding))
            }
          }
        }
      }
    }
  }
}

/**
 * Target keywords by page: pick a page from the site's own list, then add its keywords. Each page is checked for at most
 * [Contracts.seoMaxKeywords]; a keyword past that is shown and marked unchecked.
 */
@Composable
internal fun SeoTargetKeywords(rows: List<SeoTargetKeywordRow>, onChange: (List<SeoTargetKeywordRow>) -> Unit, pages: List<SeoKeywordPage>, enabled: Boolean) {
  val limit = Contracts.seoMaxKeywords.toInt()
  Column(Modifier.fillMaxWidth().testTag("seo-keywords"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text("Target keywords by page (optional)", style = MaterialTheme.typography.titleSmall)
    Text(
      "Pick a page and add up to $limit keywords for it. The check says where each page already uses its keywords.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    rows.forEachIndexed { index, row ->
      val taken = rows.filterIndexed { at, _ -> at != index }.map { it.path }.toSet()
      val options = pages.filter { seoNormalizePath(it.path) !in taken }
      val known = row.path.isEmpty() || options.any { seoNormalizePath(it.path) == row.path }
      var draft by remember(index) { mutableStateOf("") }
      fun update(next: SeoTargetKeywordRow) = onChange(rows.mapIndexed { at, item -> if (at == index) next else item })
      fun add() {
        val typed = draft.split(',').map { it.trim().replace(Regex("\\s+"), " ") }.filter { it.isNotEmpty() }
        val merged = (row.keywords + typed).distinctBy { it.lowercase() }
        draft = ""
        update(row.copy(keywords = merged))
      }
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          ChoiceField(
            "Page",
            row.path,
            options.map { InputChoice(seoNormalizePath(it.path), "${it.name} (${it.path})") } + if (known) emptyList() else listOf(InputChoice(row.path, row.path)),
            { update(row.copy(path = it)) },
            Modifier.weight(1f),
            enabled = enabled,
            allowEmpty = false,
          )
          WithTooltip("Remove this page's keywords") { IconButton(onClick = { onChange(rows.filterIndexed { at, _ -> at != index }) }, enabled = enabled) {
            Icon(AglynIcons.named("close"), contentDescription = "Remove this page's keywords")
          } }
        }
        if (row.keywords.isNotEmpty()) {
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            row.keywords.forEachIndexed { at, keyword ->
              TextButton(onClick = { update(row.copy(keywords = row.keywords.filterIndexed { i, _ -> i != at })) }, enabled = enabled) {
                Text(keyword + (if (at >= limit) " (not checked)" else "") + "  ×")
              }
            }
          }
        }
        OutlinedTextField(
          draft,
          { typed -> if (typed.endsWith(",")) { draft = typed; add() } else draft = typed },
          label = { Text("Add a keyword") },
          supportingText = { Text("Press the button to add; separate several with commas") },
          singleLine = true,
          enabled = enabled,
          modifier = Modifier.fillMaxWidth().testTag("seo-keyword-input-$index"),
        )
        TextButton(onClick = ::add, enabled = enabled && draft.isNotBlank()) { Text("Add keyword") }
      }
    }
    TextButton(onClick = { onChange(rows + SeoTargetKeywordRow("", emptyList())) }, enabled = enabled && pages.isNotEmpty(), modifier = Modifier.testTag("seo-keyword-page-add")) { Text("Add a page") }
    if (pages.isEmpty()) Text("The site has no routed pages to pick yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
