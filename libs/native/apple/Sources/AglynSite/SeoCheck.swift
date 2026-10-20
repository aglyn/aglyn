// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// `GET /api/hosts/seo-check`: the site's SEO check, the console's own, with the keyword lines it should look for.
public func runSeoCheck(api: ConsoleAPIClient, hostID: String, keywords: String) async throws -> SeoAuditReport {
  var query: [(String, String?)] = [("hostId", hostID)]
  if !keywords.trimmed.isEmpty { query.append(("keywords", String(keywords.prefix(Int(ContractValues.shared.seoKeywordLinesMaxChars))))) }
  let answer = try await api.request("/api/hosts/seo-check", query: query)
  guard let report = answer?["report"], let data = try? report.encoded() else {
    throw ConsoleAPIError(status: 0, message: "The SEO check could not run — try again.")
  }
  return try JSONDecoder().decode(SeoAuditReport.self, from: data)
}

/// A page the keywords can be for: its path and its name.
public struct SeoKeywordPage: Equatable, Sendable {
  public let path: String
  public let name: String
}

/// The site's routed pages, by name and path, for the keyword page picker: the routing map says each path, the screens their names.
public func seoKeywordPages(host: [String: Any], names: [String: String]) -> [SeoKeywordPage] {
  (host["screens"] as? [String: Any] ?? [:])
    .compactMap { id, route -> SeoKeywordPage? in
      guard let route = route as? String else { return nil }
      let path = route == "/" ? "/" : "/\(route)"
      let name = (names[id] ?? "").isEmpty ? path : names[id]!
      return SeoKeywordPage(path: path, name: name)
    }
    .sorted { $0.path < $1.path }
}

private func tone(_ finding: SeoFinding) -> AglynTone {
  switch finding.severity {
  case .high: .error
  case .medium: .warning
  default: .neutral
  }
}

/// The site's SEO check, at the top of the SEO section: every published page held to what a search result and a crawler need,
/// and the site held to what a search engine and an agent read about it. It runs when asked, changes nothing, and reads the
/// target keywords by page that are picked here rather than typed as lines. The Kotlin site lib's SeoCheck.kt.
struct SeoCheckCard: View {
  let context: NativePluginContext
  let hostID: String
  let host: [String: Any]
  /// Hears the keyword lines the check was last run with.
  var onChecked: (String) -> Void = { _ in }
  @State private var rows: [SeoTargetKeywordRow] = []
  @State private var report: SeoAuditReport?
  @State private var busy = false
  @State private var notice: String?
  @State private var screens = LiveQuery()

  private var pages: [SeoKeywordPage] {
    let names = Dictionary(
      (screens.state.value ?? []).map { ($0.id, $0.string("displayName") ?? $0.string("name") ?? "") }, uniquingKeysWith: { first, _ in first })
    return seoKeywordPages(host: host, names: names)
  }

  var body: some View {
    Section {
      Text("Checks every published page for what search results and AI agents need: titles, descriptions, headings, image descriptions, links and your target keywords. It changes nothing on your site.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
      SeoTargetKeywords(rows: $rows, pages: pages, enabled: !busy)
      Button {
        run()
      } label: {
        HStack {
          if busy { ProgressView() }
          Text(busy ? "Checking…" : (report != nil ? "Check again" : "Run the check"))
        }
      }
      .buttonStyle(.aglynProminent)
      .disabled(busy)
      .accessibilityIdentifier("seo-check-run")
      if let notice { AglynNotice(notice, tone: .warning) }
      if let report { SeoReportView(report: report) }
    } header: {
      Text("SEO check")
    }
    // The screen names are read once, and only when a keyword row exists: Setup → SEO opens without paying for the screen list.
    .task(id: rows.isEmpty) {
      if rows.isEmpty { return }
      await screens.bind(context.firestore, FirestoreQuery(["hosts", hostID, "screens"], order: [.init("__name__")], limit: 200))
    }
  }

  private func run() {
    busy = true
    notice = nil
    let keywords = seoKeywordLines(fromRows: rows)
    Task {
      defer { busy = false }
      do {
        report = try await runSeoCheck(api: context.api, hostID: hostID, keywords: keywords)
        onChecked(keywords)
      } catch {
        notice = (error as? ConsoleAPIError)?.message ?? "The SEO check could not run — try again."
      }
    }
  }
}

private struct SeoReportView: View {
  let report: SeoAuditReport

  var body: some View {
    let findings = seoAuditFindingCount(report)
    let listed = report.pages.count + report.skipped
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Score \(jsNumberString(report.score)) of 100 · \(report.pages.count) \(report.pages.count == 1 ? "page" : "pages") · \(findings) \(findings == 1 ? "finding" : "findings")")
        .font(AglynFont.strongSubheadline)
      Text(
        report.site.contains { $0.code == .searchDiscouraged }
          ? "Launch status: hidden. Search engines are asked to stay away from the whole site, and its sitemap lists no pages."
          : "Launch status: open to search engines, with \(listed) \(listed == 1 ? "page" : "pages") listed."
      )
      .font(AglynFont.subheadline).accessibilityIdentifier("seo-launch-status")
      if report.skipped > 0 {
        AglynNotice("\(report.skipped) more published \(report.skipped == 1 ? "page was" : "pages were") not checked this time.", tone: .info)
      }
      ForEach(Array(report.site.enumerated()), id: \.offset) { _, entry in
        AglynNotice("\(seoFindingLabel(entry)) — \(entry.message)", tone: entry.severity == .high ? .error : .info)
      }
      ForEach(report.notes, id: \.self) { Text($0).font(AglynFont.caption).foregroundStyle(.secondary) }
      if report.pages.isEmpty {
        Text("This site has no published public pages to check.").font(AglynFont.subheadline)
      } else {
        ForEach(report.pages, id: \.screenId) { page in
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(page.name).font(AglynFont.body)
            Text("\(page.path) · score \(page.score)").font(AglynFont.caption).foregroundStyle(.secondary)
            if page.findings.isEmpty {
              Text("Nothing found").font(AglynFont.caption).foregroundStyle(.secondary)
            } else {
              ScrollView(.horizontal, showsIndicators: false) {
                HStack { ForEach(Array(page.findings.enumerated()), id: \.offset) { _, finding in StatusChip(seoFindingLabel(finding), tone: tone(finding)) } }
              }
            }
          }
          Divider()
        }
      }
    }
    .accessibilityIdentifier("seo-check-results")
  }
}

/// Target keywords by page: pick a page from the site's own list, then add its keywords. Each page is checked for at most
/// `seoMaxKeywords`; a keyword past that is shown and marked unchecked.
struct SeoTargetKeywords: View {
  @Binding var rows: [SeoTargetKeywordRow]
  let pages: [SeoKeywordPage]
  let enabled: Bool
  @State private var drafts: [UUID: String] = [:]

  private var limit: Int { ContractValues.shared.seoMaxKeywords }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Target keywords by page (optional)").font(AglynFont.strongSubheadline)
      Text("Pick a page and add up to \(limit) keywords for it. The check says where each page already uses its keywords.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
      ForEach($rows) { $row in
        let taken = Set(rows.filter { $0.id != row.id }.map(\.path))
        let options = pages.filter { !taken.contains(seoNormalizePath($0.path)) }
        let known = row.path.isEmpty || options.contains { seoNormalizePath($0.path) == row.path }
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          HStack {
            Picker("Page", selection: $row.path) {
              if row.path.isEmpty { Text("Choose a page").tag("") }
              ForEach(options, id: \.path) { Text("\($0.name) (\($0.path))").tag(seoNormalizePath($0.path)) }
              if !known { Text(row.path).tag(row.path) }
            }
            .disabled(!enabled)
            Button(role: .destructive) {
              rows.removeAll { $0.id == row.id }
            } label: {
              Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove this page's keywords")
          }
          if !row.keywords.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack {
                ForEach(Array(row.keywords.enumerated()), id: \.offset) { at, keyword in
                  Button {
                    row.keywords.remove(at: at)
                  } label: {
                    Text(keyword + (at >= limit ? " (not checked)" : "") + "  ×").font(AglynFont.caption)
                  }
                  .buttonStyle(.aglynSecondary)
                  .disabled(!enabled)
                }
              }
            }
          }
          HStack {
            TextField(
              "Add a keyword",
              text: Binding(get: { drafts[row.id] ?? "" }, set: { drafts[row.id] = $0 }))
            .disabled(!enabled)
            .onSubmit { add(&row) }
            .accessibilityIdentifier("seo-keyword-input")
            Button("Add") { add(&row) }
              .disabled(!enabled || (drafts[row.id] ?? "").trimmed.isEmpty)
          }
        }
      }
      Button("Add a page") { rows.append(SeoTargetKeywordRow(path: "", keywords: [])) }
        .disabled(!enabled || pages.isEmpty)
        .accessibilityIdentifier("seo-keyword-page-add")
      if pages.isEmpty { Text("The site has no routed pages to pick yet.").font(AglynFont.caption).foregroundStyle(.secondary) }
    }
  }

  private func add(_ row: inout SeoTargetKeywordRow) {
    let typed = (drafts[row.id] ?? "").split(separator: ",").map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }.filter { !$0.isEmpty }
    var merged = row.keywords
    for keyword in typed where !merged.contains(where: { $0.lowercased() == keyword.lowercased() }) { merged.append(keyword) }
    row.keywords = merged
    drafts[row.id] = ""
  }
}
