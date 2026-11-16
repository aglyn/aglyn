package com.aglyn.site.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import com.aglyn.contracts.SeoPageReport
import com.aglyn.contracts.seoFindingLabel
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.media.MediaPickField
import com.aglyn.site.setup.runSeoCheck
import androidx.compose.material3.Button
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PlainSection
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/** What "Check this page" answered. */
private sealed interface PageCheckAnswer {
  data class Page(val report: SeoPageReport) : PageCheckAnswer
  data object Unchecked : PageCheckAnswer
  data class Failed(val message: String) : PageCheckAnswer
}

/**
 * The console page view's SEO card, as a section of the page's details: the search title (variables resolved and counted
 * as a search result shows them), description, breadcrumb label, the social image picked from the media library with its
 * size and description, Save SEO, and the site's SEO check answered for this page. The Apple kit's PageSeoSection.
 */
@Composable
internal fun PageSeoSection(
  context: NativePluginContext,
  hostId: String,
  page: PageNode,
  livePath: String?,
  screen: Map<String, Any?>?,
  host: Map<String, Any?>?,
  api: PageSettingsApi,
  runner: ActionRunner,
  canEdit: Boolean,
) {
  val stored = PageSeo.from(screen?.get("seo") as? Map<*, *>)
  var title by remember(page.id) { mutableStateOf<String?>(null) }
  var description by remember(page.id) { mutableStateOf<String?>(null) }
  var breadcrumb by remember(page.id) { mutableStateOf<String?>(null) }
  var image by remember(page.id) { mutableStateOf<PageSocialImage?>(null) }
  var checking by remember(page.id) { mutableStateOf(false) }
  var check by remember(page.id) { mutableStateOf<PageCheckAnswer?>(null) }
  var inserting by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val siteSeo = host?.get("seo") as? Map<*, *>
  val titleValue = title ?: stored.title
  val resolved = resolveSeoTitleVariables(
    titleValue,
    pageName = page.name,
    siteName = siteSeo?.get("title") as? String ?: host?.get("displayName") as? String ?: "",
    separator = siteSeo?.get("separator") as? String ?: "",
  )
  val currentImage = image ?: stored.image
  val dirty = (title != null && title != stored.title) || (description != null && description != stored.description) ||
    (breadcrumb != null && breadcrumb != stored.breadcrumb) || (image != null && image != stored.image)
  fun discard() {
    title = null
    description = null
    breadcrumb = null
    image = null
  }
  PlainSection("SEO", Modifier.testTag("page-seo")) {
    CountedTextField(
      "Title",
      titleValue,
      { title = it },
      error = if (resolved.length > PageSeoLimits.TITLE) "${resolved.length}/${PageSeoLimits.TITLE} — longer than a search result shows" else null,
      supporting = if (hasSeoTitleVariables(titleValue)) {
        "${resolved.length}/${PageSeoLimits.TITLE} — renders as “$resolved”"
      } else {
        "${titleValue.length}/${PageSeoLimits.TITLE} — published verbatim; the site title is not appended. Add a variable to keep it in step with Host setup → SEO."
      },
      enabled = canEdit,
      modifier = Modifier.testTag("page-seo-title"),
    )
    Box {
      TextButton(onClick = { inserting = true }, enabled = canEdit, modifier = Modifier.testTag("page-seo-insert-variable")) { Text("Insert a variable") }
      DropdownMenu(expanded = inserting, onDismissRequest = { inserting = false }) {
        for ((name, label) in PAGE_SEO_TITLE_VARIABLES) {
          DropdownMenuItem(text = { Text(label) }, onClick = {
            title = titleValue + "{{$name}}"
            inserting = false
          })
        }
      }
    }
    CountedTextField("Description", description ?: stored.description, { description = it }, max = PageSeoLimits.DESCRIPTION, multiline = true, enabled = canEdit, modifier = Modifier.testTag("page-seo-description"))
    CountedTextField(
      "Breadcrumb label",
      breadcrumb ?: stored.breadcrumb,
      { breadcrumb = it },
      max = PageSeoLimits.BREADCRUMB,
      supporting = "The page’s name in a breadcrumb trail",
      enabled = canEdit,
      modifier = Modifier.testTag("page-seo-breadcrumb"),
    )
    MediaPickField(
      context,
      "Social image",
      currentImage?.image.orEmpty(),
      onPick = { chosen ->
        image = PageSocialImage(chosen.reference, chosen.item.width ?: 0, chosen.item.height ?: 0, inheritedSocialImageAlt(currentImage?.alt.orEmpty(), chosen.item.alt))
      },
      onClear = { image = PageSocialImage("", 0, 0, "") },
      enabled = canEdit,
      supporting = "The picture shown when this page is shared. Leave it unset to use the site default from Site setup ▸ SEO. Recommended: 1200×630 PNG or JPG — the size social networks crop to.",
    )
    if (currentImage != null && currentImage.image.isNotEmpty()) {
      CountedTextField(
        "Image description",
        currentImage.alt,
        { image = currentImage.copy(alt = it.take(PageSeoLimits.IMAGE_ALT)) },
        max = PageSeoLimits.IMAGE_ALT,
        multiline = true,
        supporting = "Read aloud by screen readers in a social preview. Describe the picture, not the page.",
        placeholder = "What the picture shows",
        enabled = canEdit,
        modifier = Modifier.testTag("page-seo-image-alt"),
      )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Button(
        onClick = {
          val update = buildScreenSeoUpdate(screen?.get("seo") as? Map<*, *>, title, description, breadcrumb, image)
          runner.run("SEO saved") {
            api.saveSeo(page.id, update, livePath)
            discard()
          }
        },
        enabled = canEdit && dirty && !runner.busy,
        modifier = Modifier.testTag("page-seo-save"),
      ) { Text("Save SEO") }
      if (dirty) TextButton(onClick = { discard() }) { Text("Discard") }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      OutlinedButton(
        onClick = {
          checking = true
          scope.launch {
            check = try {
              val report = runSeoCheck(context.api, hostId, "")
              report.pages.firstOrNull { it.screenId == page.id }?.let { PageCheckAnswer.Page(it) } ?: PageCheckAnswer.Unchecked
            } catch (failure: Exception) {
              PageCheckAnswer.Failed((failure as? ConsoleApiError)?.message ?: "The SEO check could not run — try again.")
            }
            checking = false
          }
        },
        enabled = !checking,
        modifier = Modifier.testTag("page-seo-check"),
      ) { Text(if (check == null) "Check this page" else "Check again") }
      if (checking) CircularProgressIndicator(Modifier.size(space(2f)))
      (check as? PageCheckAnswer.Page)?.let {
        Text("Score ${it.report.score} of 100, as published", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    when (val answer = check) {
      is PageCheckAnswer.Failed -> NoticeBanner(answer.message, StatusTone.WARNING)
      PageCheckAnswer.Unchecked -> Text(
        "This page is not in the sitemap — it is unpublished, not public, a template or an error page — so the SEO check does not cover it.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      is PageCheckAnswer.Page ->
        if (answer.report.findings.isEmpty()) {
          Text("Nothing found: this page has what a search result needs.", style = MaterialTheme.typography.bodyMedium)
        } else {
          for (finding in answer.report.findings) {
            Text(
              buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(seoFindingLabel(finding)) }
                append(" — ${finding.message}")
              },
              style = MaterialTheme.typography.bodyMedium,
            )
          }
        }
      null -> Unit
    }
  }
}
