package com.aglyn.contracts

/*
 * The SEO check's pure rules (seo-audit.ts, seo-keywords.ts): a path as the
 * keyword lines and the routing map both spell it, the target keyword lines
 * (`/pricing: plans, pricing`) and a report's finding count.
 * SeoAuditCasesTest replays the TypeScript's own answers.
 */

/** A path as the keyword lines and the routing map both spell it: leading slash, no trailing one. */
fun seoNormalizePath(path: String): String {
  val trimmed = path.trim()
  if (trimmed.isEmpty() || trimmed == "/") return "/"
  return "/" + trimmed.trimStart('/').trimEnd('/')
}

private const val SEO_KEYWORD_MAX_CHARS = 60

/** Keywords as a person typed them, split at the limit: the ones a page is checked for, and the distinct ones past it. */
data class SeoKeywordSplit(val keywords: List<String>, val unchecked: List<String>)

fun seoKeywordSplit(parts: List<String>): SeoKeywordSplit {
  val seen = HashSet<String>()
  val keywords = mutableListOf<String>()
  val unchecked = mutableListOf<String>()
  val limit = Contracts.seoMaxKeywords.toInt()
  for (part in parts) {
    val keyword = part.replace(Regex("\\s+"), " ").trim().take(SEO_KEYWORD_MAX_CHARS)
    val key = keyword.lowercase()
    if (keyword.isEmpty() || !seen.add(key)) continue
    if (keywords.size < limit) keywords += keyword else unchecked += keyword
  }
  return SeoKeywordSplit(keywords, unchecked)
}

fun seoKeywordSplit(text: String?): SeoKeywordSplit = seoKeywordSplit(text.orEmpty().split(',', '\n'))

/** Target keyword lines read: the keywords each page is checked for, and those past the limit, by normalized path. */
data class SeoKeywordLines(val keywords: LinkedHashMap<String, List<String>>, val unchecked: LinkedHashMap<String, List<String>>)

fun readSeoKeywordLines(raw: String?): SeoKeywordLines {
  val typed = LinkedHashMap<String, List<String>>()
  for (line in raw.orEmpty().split('\n')) {
    val at = line.indexOf(':')
    if (at <= 0) continue
    val path = seoNormalizePath(line.substring(0, at))
    val parts = line.substring(at + 1).split(',')
    if (parts.any { it.isNotBlank() }) typed[path] = typed[path].orEmpty() + parts
  }
  val out = SeoKeywordLines(LinkedHashMap(), LinkedHashMap())
  for ((path, parts) in typed) {
    val split = seoKeywordSplit(parts)
    if (split.keywords.isNotEmpty()) out.keywords[path] = split.keywords
    if (split.unchecked.isNotEmpty()) out.unchecked[path] = split.unchecked
  }
  return out
}

/** One page and the keywords it is checked for. */
data class SeoTargetKeywordRow(val path: String, val keywords: List<String>)

/** Stored keyword lines as rows, one per page, in the order they were written. */
fun seoKeywordRowsFromLines(lines: String?): List<SeoTargetKeywordRow> {
  val read = readSeoKeywordLines(lines)
  return read.keywords.keys.map { path -> SeoTargetKeywordRow(path, read.keywords.getValue(path) + read.unchecked[path].orEmpty()) }
}

/** Rows as the keyword lines the check reads. A row with no page or no keywords says nothing and is left out. */
fun seoKeywordLinesFromRows(rows: List<SeoTargetKeywordRow>): String =
  rows.filter { it.path.isNotEmpty() && it.keywords.isNotEmpty() }.joinToString("\n") { "${seoNormalizePath(it.path)}: ${it.keywords.joinToString(", ")}" }

/** Findings in a report: each page's and the site's. */
fun seoAuditFindingCount(report: SeoAuditReport): Int = report.pages.sumOf { it.findings.size } + report.site.size

/** What a finding is called where it is listed, with the keyword it names. */
fun seoFindingLabel(finding: SeoFinding): String {
  val label = Contracts.seoFindingLabels[finding.code.raw] ?: finding.code.raw
  return if (finding.keyword.isNullOrEmpty()) label else "$label: ${finding.keyword}"
}
