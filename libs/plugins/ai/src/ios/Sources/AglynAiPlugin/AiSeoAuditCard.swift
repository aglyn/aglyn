// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// How often a running audit is read again; the console follows the job's event stream, which the apps poll instead.
public let aiSeoPollNanoseconds: UInt64 = 2_500_000_000

/// Pages of fixes shown before "Show more".
private let fixRowsShown = 10

/// SEO fixes, on the site's SEO page under the SEO check (the console's `hostSeo` widget). The check lists what is wrong; this
/// card adds what only a model can: a person asks, and an `seo` job audits the same pages through the same check, proposes a
/// fix per finding, and drafts the structured data and the agent guidance `/llms.txt` leads with. The findings are never listed
/// here, only the fixes, page by page. Nothing it shows is saved: "Put in the form" stages the site-wide proposal in the SEO
/// form below as unsaved edits, and "Apply all as drafts" opens a new unpublished version for each page's content fixes and
/// stages each page's listing for its SEO card.
struct AiSeoAuditCard: View {
  let context: NativePluginContext
  @Environment(\.seoZone) private var zone
  @State private var verdict = Verdict.checking
  @State private var job: JSONValue?
  @State private var notice: String?
  @State private var busy = false
  @State private var applying = false
  @State private var applied: AiSeoApplyResult?
  @State private var siteStaged: String?
  @State private var previewOpen = false
  @State private var shown = fixRowsShown
  @State private var watching: Task<Void, Never>?

  private enum Verdict { case checking, ready, hidden }

  private var view: AiSeoAuditView? { aiSeoAuditView(job?["outputs"]) }
  private var running: Bool { job != nil && !aiJobIsTerminal(job) }

  var body: some View {
    VStack(spacing: 0) {
      if verdict == .ready, let zone, let hostID = context.hostID, let orgID = context.orgID {
        content(zone: zone, hostID: hostID, orgID: orgID)
      }
    }
    .task(id: context.hostID) { await load() }
    .onDisappear { watching?.cancel() }
  }

  @ViewBuilder
  private func content(zone: SeoZone, hostID: String, orgID: String) -> some View {
    let view = view
    let keywords = zone.keywords.trimmingCharacters(in: .whitespacesAndNewlines)
    let siteValues = view?.site?.values ?? [:]
    let siteFields = aiSeoSiteFields.filter { siteValues[$0.field] != nil }
    let jobID = job?["id"]?.stringValue
    Section {
      HStack {
        Button(view != nil ? "Propose fixes again" : "Propose fixes") { propose(hostID: hostID, orgID: orgID, keywords: keywords) }
          .buttonStyle(.aglynProminent)
          .disabled(busy || running)
          .accessibilityIdentifier("ai-seo-propose")
        if running { ProgressView().controlSize(.small) }
        if running, let view {
          Text("Proposing fixes: \(view.batches) of \(view.owedBatches) batches").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      if let notice { AglynNotice(notice, tone: .warning) }
      if let error = job?["error"]?.stringValue, !error.isEmpty {
        AglynNotice(error, tone: job?["status"]?.stringValue == "failed" ? .error : .warning)
      }
      if let view, job != nil {
        if case .number(let credits)? = job?["creditsSpent"], credits > 0 {
          let count = Int(credits)
          Text("These fixes used \(count) \(count == 1 ? "credit" : "credits").").font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if let site = view.site {
          Text("Structured data and AI agent guidance").font(AglynFont.headline)
          if siteFields.isEmpty {
            Text("Nothing to add: the site’s structured data and guidance are already filled in.")
          } else {
            ForEach(siteFields, id: \.field) { entry in
              VStack(alignment: .leading, spacing: 2) {
                Text(entry.label).font(AglynFont.caption).foregroundStyle(.secondary)
                let value = siteValues[entry.field] ?? ""
                Text(entry.field == "seo.entity.type" ? (aiSeoEntityTypeWords[value] ?? value) : value)
              }
            }
          }
          ForEach(site.notes, id: \.self) { Text($0).font(AglynFont.caption).foregroundStyle(.secondary) }
          Button(previewOpen ? "Hide the /llms.txt preview" : "Preview /llms.txt") { previewOpen.toggle() }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("ai-seo-preview")
          if previewOpen {
            Text(site.llmsPreview).font(AglynFont.caption).textSelection(.enabled)
          }
          Button("Put in the form") { stageSite(zone: zone, jobID: jobID, values: siteValues, fields: siteFields.map(\.field)) }
            .buttonStyle(.aglynSecondary)
            .disabled(siteFields.isEmpty || siteStaged == jobID)
            .accessibilityIdentifier("ai-seo-stage-site")
          if siteStaged == jobID { AglynNotice("In the SEO form below as unsaved changes. Review them, then press Save.", tone: .success) }
        }

        // The pages a fix was proposed for, or is still owed to; the check above lists the rest.
        let fixRows = view.pages.filter { view.fixes[$0.screenID] != nil || view.queue.contains($0.screenID) }
        if fixRows.isEmpty {
          Text(view.pages.isEmpty ? "This site has no published public pages to fix." : "No page needs a written fix.")
        } else {
          Text("Proposed fixes").font(AglynFont.headline)
          ForEach(fixRows.prefix(shown), id: \.screenID) { row in
            VStack(alignment: .leading, spacing: 2) {
              Text(row.name)
              Text(row.path).font(AglynFont.caption).foregroundStyle(.secondary)
              let summary = aiSeoFixSummary(view.fixes[row.screenID])
              Text(summary.isEmpty ? (running ? "Being proposed…" : "") : summary).font(AglynFont.caption)
            }
            .accessibilityIdentifier("ai-seo-fix-\(row.screenID)")
          }
          if fixRows.count > shown {
            Button("Show more (\(fixRows.count - shown) left)") { shown += fixRowsShown }.buttonStyle(.borderless)
          }
        }

        let counts = aiSeoApplyCounts(view)
        let somethingToApply = counts.pagesWithContent + counts.pagesWithValues + siteFields.count > 0
        Text(
          "Apply all opens a new draft version of each page with content fixes, puts proposed titles and descriptions in each page’s SEO card, and puts the structured data and guidance in the form below. You review and save or publish each of them."
        )
        .font(AglynFont.caption).foregroundStyle(.secondary)
        HStack {
          Button("Apply all as drafts") {
            stageSite(zone: zone, jobID: jobID, values: siteValues, fields: siteFields.map(\.field))
            applyAll(hostID: hostID, orgID: orgID, jobID: jobID ?? "")
          }
          .buttonStyle(.aglynProminent)
          .disabled(applying || running || job?["status"]?.stringValue != "done" || !view.complete || !somethingToApply)
          .accessibilityIdentifier("ai-seo-apply")
          if applying { ProgressView().controlSize(.small) }
        }
        if let applied {
          let names = Dictionary(view.pages.map { ($0.screenID, $0.name) }, uniquingKeysWith: { first, _ in first })
          ForEach(applied.versions, id: \.screenID) { version in
            Button("Open the draft of \(version.name)") {
              if !context.openBesigner("/screens/\(version.screenID)/versions/\(version.versionID)/besigner") {
                notice = "That page does not open in the app."
              }
            }
            .buttonStyle(.borderless)
          }
          ForEach(applied.staged, id: \.self) { id in
            Text("A listing for \(names[id] ?? id) waits in its SEO card.").font(AglynFont.caption)
          }
          ForEach(applied.skipped, id: \.screenID) { entry in
            Text("\(names[entry.screenID] ?? entry.screenID): \(entry.reason)").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
    } header: {
      Text("SEO fixes")
    } footer: {
      Text(
        keywords.isEmpty
          ? "Proposes a fix for each finding of the SEO check above. Nothing changes on your live site until you save or publish it."
          : "Proposes a fix for each finding of the SEO check above, using the target keywords it was run with. Nothing changes on your live site until you save or publish it."
      )
    }
    .accessibilityIdentifier("ai-seo-audit")
  }

  private func jobs(orgID: String) async throws -> JSONValue? {
    try await context.api.request("/api/ai/jobs", query: [("orgId", orgID), ("limit", String(aiRecentJobsRead))])
  }

  private func load() async {
    guard let hostID = context.hostID, let orgID = context.orgID else { return }
    do {
      if let latest = aiLatestSeoAudit(try await jobs(orgID: orgID), hostID: hostID)?.job {
        job = latest
        if !aiJobIsTerminal(latest), let id = latest["id"]?.stringValue { watch(id, orgID: orgID) }
      }
      verdict = .ready
    } catch is CancellationError {
    } catch {
      // A workspace the jobs route turns away has no SEO fixes to offer, so the card is not drawn at all.
      if let failure = error as? ConsoleAPIError, failure.status == 403 || failure.status == 404 {
        verdict = .hidden
      } else {
        notice = "The last SEO audit could not be loaded."
        verdict = .ready
      }
    }
  }

  /// Follows a job until it settles, reading the jobs route on a short beat.
  private func watch(_ id: String, orgID: String) {
    watching?.cancel()
    watching = Task {
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: aiSeoPollNanoseconds)
        guard !Task.isCancelled else { return }
        let next = (try? await jobs(orgID: orgID)).flatMap { aiJobByID($0, id) }
        if let next { job = next }
        if let next, aiJobIsTerminal(next) { return }
      }
    }
  }

  private func propose(hostID: String, orgID: String, keywords: String) {
    busy = true
    notice = nil
    applied = nil
    siteStaged = nil
    shown = fixRowsShown
    Task {
      defer { busy = false }
      do {
        let answer = try await context.api.request(
          "/api/ai/jobs", method: .post,
          body: [
            "orgId": .string(orgID), "hostId": .string(hostID), "kind": "seo", "brief": "Propose fixes for the SEO of this site",
            "inputs": ["target": "site", "keywords": .string(keywords)],
          ])
        if let started = answer?["job"] {
          job = started
          if !aiJobIsTerminal(started), let id = started["id"]?.stringValue { watch(id, orgID: orgID) }
        }
      } catch {
        notice = (error as? ConsoleAPIError)?.message ?? "The SEO audit could not be started — try again."
      }
    }
  }

  private func stageSite(zone: SeoZone, jobID: String?, values: [String: String], fields: [String]) {
    guard let jobID, !fields.isEmpty else { return }
    zone.proposeDraft(values, "\(jobID):site")
    siteStaged = jobID
  }

  private func applyAll(hostID: String, orgID: String, jobID: String) {
    applying = true
    notice = nil
    Task {
      defer { applying = false }
      do {
        let answer = try await context.api.request(
          "/api/ai/seo/apply", method: .post, body: ["orgId": .string(orgID), "hostId": .string(hostID), "jobId": .string(jobID)])
        if let next = answer?["job"], case .object(let fields) = next, !fields.isEmpty { job = next }
        applied = aiSeoApplyResultOf(answer)
      } catch {
        notice = (error as? ConsoleAPIError)?.message ?? "The fixes could not be applied — try again."
      }
    }
  }
}
