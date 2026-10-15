// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * SEO by AI (ai-seo.ts): the proposals an `seo` job produces, put back together from its outputs. Every value is a
 * proposal and nothing here writes: a page's listing is staged in its own SEO card, a site audit's content fixes become a new
 * unpublished version only when a person applies them, and the site-wide proposals land in the SEO form unsaved.
 */

/// An AI job's statuses that end it (`AI_JOB_TERMINAL_STATUSES`).
public let aiJobTerminalStatuses: Set<String> = ["done", "failed", "canceled"]

/// What each site SEO form field is called where the proposal lists it, in the order the console lists them.
public let aiSeoSiteFields: [(field: String, label: String)] = [
  ("seo.entity.type", "Published by"), ("seo.entity.name", "Name"), ("seo.entity.description", "Description"),
  ("seo.entity.email", "Contact email"), ("seo.entity.telephone", "Contact phone"), ("seo.entity.contactType", "Contact is for"),
  ("seo.agent.whenToUse", "When to use this site"), ("seo.agent.howToUse", "How an agent should call you"),
]

/// The entity type's stored code, in words.
public let aiSeoEntityTypeWords = ["1": "An organization", "2": "A person"]

/// A page the audit covered.
public struct AiSeoAuditPage: Equatable, Sendable {
  public let screenID: String
  public let name: String
  public let path: String
  public let versionID: String?
}

/// Everything proposed for one page: listing values, content fixes (by kind) and guidance a job cannot act on.
public struct AiSeoPageFix: Equatable, Sendable {
  public let screenID: String
  public let values: [String: String]
  public let contentKinds: [String]
  public let guidance: [String]
}

/// The site's structured data and agent guidance, and `/llms.txt` as it would read once the guidance is saved.
public struct AiSeoSiteProposal: Equatable, Sendable {
  public let values: [String: String]
  public let llmsPreview: String
  public let notes: [String]
}

/// One site audit, put back together from a job's outputs.
public struct AiSeoAuditView: Equatable, Sendable {
  public let pages: [AiSeoAuditPage]
  /// Pages whose fixes need generated text, in the order the batches take them.
  public let queue: [String]
  /// How many pages one batch of fixes carries.
  public let batchSize: Int
  /// Whether the site-wide proposal is owed.
  public let siteProposal: Bool
  public let fixes: [String: AiSeoPageFix]
  /// The pages that have a fix, in the order they were recorded.
  public let fixOrder: [String]
  public let site: AiSeoSiteProposal?
  /// Batches recorded so far.
  public let batches: Int

  /// Batches the report queued.
  public var owedBatches: Int { Int((Double(queue.count) / Double(max(1, batchSize))).rounded(.up)) }

  /// Whether every batch the report queued has been recorded.
  public var complete: Bool { batches >= owedBatches && (!siteProposal || site != nil) }
}

private func strings(_ value: JSONValue?) -> [String] { (value?.arrayValue ?? []).compactMap(\.stringValue) }

private func stringMap(_ value: JSONValue?) -> [String: String] {
  guard case .object(let object)? = value else { return [:] }
  return object.compactMapValues(\.stringValue)
}

private func fixOf(_ entry: JSONValue) -> AiSeoPageFix? {
  guard let id = entry["screenId"]?.stringValue else { return nil }
  let kinds = (entry["content"]?.arrayValue ?? []).compactMap { $0["kind"]?.stringValue }
  return AiSeoPageFix(screenID: id, values: stringMap(entry["values"]), contentKinds: kinds, guidance: strings(entry["guidance"]))
}

/// The audit a job's outputs describe, or nil when they describe none (`aiSeoAuditView`).
public func aiSeoAuditView(_ outputs: JSONValue?) -> AiSeoAuditView? {
  var report: JSONValue?
  var site: AiSeoSiteProposal?
  var fixes: [String: AiSeoPageFix] = [:]
  var order: [String] = []
  var batches = 0
  for output in outputs?.arrayValue ?? [] {
    guard output["resource"]?.stringValue == "seo", let proposal = output["proposal"] else { continue }
    switch proposal["kind"]?.stringValue {
    case "audit":
      if proposal["pages"]?.arrayValue != nil { report = proposal }
    case "site":
      if let raw = proposal["site"], case .object = raw {
        site = AiSeoSiteProposal(values: stringMap(raw["values"]), llmsPreview: raw["llmsPreview"]?.stringValue ?? "", notes: strings(raw["notes"]))
      }
    case "fixes":
      if let list = proposal["fixes"]?.arrayValue {
        batches += 1
        for fix in list.compactMap(fixOf) {
          if fixes[fix.screenID] == nil { order.append(fix.screenID) }
          fixes[fix.screenID] = fix
        }
      }
    default: break
    }
  }
  guard let report else { return nil }
  let pages = (report["pages"]?.arrayValue ?? []).compactMap { page -> AiSeoAuditPage? in
    guard let id = page["screenId"]?.stringValue else { return nil }
    return AiSeoAuditPage(screenID: id, name: page["name"]?.stringValue ?? "", path: page["path"]?.stringValue ?? "", versionID: page["versionId"]?.stringValue)
  }
  var batchSize = 1
  if case .number(let number)? = report["batchSize"] { batchSize = Int(number) }
  var owed = false
  if case .bool(let flag)? = report["siteProposal"] { owed = flag }
  return AiSeoAuditView(
    pages: pages, queue: strings(report["queue"]), batchSize: batchSize, siteProposal: owed, fixes: fixes, fixOrder: order, site: site,
    batches: batches)
}

/// The latest SEO audit among a jobs route's answer (newest first) that covers `hostID`: its job and the audit it recorded.
public func aiLatestSeoAudit(_ jobs: JSONValue?, hostID: String) -> (job: JSONValue, view: AiSeoAuditView)? {
  for job in jobs?["jobs"]?.arrayValue ?? [] {
    guard job["kind"]?.stringValue == "seo", job["hostId"]?.stringValue == hostID, let view = aiSeoAuditView(job["outputs"]) else { continue }
    return (job, view)
  }
  return nil
}

/// Whether a job (the jobs route's row) has ended.
public func aiJobIsTerminal(_ job: JSONValue?) -> Bool { aiJobTerminalStatuses.contains(job?["status"]?.stringValue ?? "") }

/// The job with `id` among a jobs route's answer.
public func aiJobByID(_ jobs: JSONValue?, _ id: String) -> JSONValue? { (jobs?["jobs"]?.arrayValue ?? []).first { $0["id"]?.stringValue == id } }

/// One page's proposed fix, in a sentence a row can hold (`fixSummary`).
public func aiSeoFixSummary(_ fix: AiSeoPageFix?) -> String {
  guard let fix else { return "" }
  var parts: [String] = []
  if let title = fix.values["title"] { parts.append("Title: \(title)") }
  if let description = fix.values["description"] { parts.append("Description: \(description)") }
  let alts = fix.contentKinds.filter { $0 == "image-alt" }.count
  if alts > 0 { parts.append("\(alts) image \(alts == 1 ? "description" : "descriptions")") }
  if fix.contentKinds.contains(where: { $0 != "image-alt" }) { parts.append("One main heading") }
  parts += fix.guidance
  return parts.joined(separator: " · ")
}

/// How many pages get content fixes, and how many get a staged listing, if the audit were applied.
public func aiSeoApplyCounts(_ view: AiSeoAuditView) -> (pagesWithContent: Int, pagesWithValues: Int) {
  (view.fixes.values.filter { !$0.contentKinds.isEmpty }.count, view.fixes.values.filter { !$0.values.isEmpty }.count)
}

/// What `/api/ai/seo/apply` answers.
public struct AiSeoApplyResult: Equatable, Sendable {
  public struct AppliedVersion: Equatable, Sendable {
    public let screenID: String
    public let versionID: String
    public let name: String
  }
  public let versions: [AppliedVersion]
  public let staged: [String]
  public let skipped: [(screenID: String, reason: String)]

  public static func == (lhs: AiSeoApplyResult, rhs: AiSeoApplyResult) -> Bool {
    lhs.versions == rhs.versions && lhs.staged == rhs.staged && lhs.skipped.map { [$0.screenID, $0.reason] } == rhs.skipped.map { [$0.screenID, $0.reason] }
  }
}

public func aiSeoApplyResultOf(_ answer: JSONValue?) -> AiSeoApplyResult {
  let versions = (answer?["versions"]?.arrayValue ?? []).compactMap { entry -> AiSeoApplyResult.AppliedVersion? in
    guard let screen = entry["screenId"]?.stringValue, let version = entry["versionId"]?.stringValue else { return nil }
    return AiSeoApplyResult.AppliedVersion(screenID: screen, versionID: version, name: entry["name"]?.stringValue ?? "")
  }
  let skipped = (answer?["skipped"]?.arrayValue ?? []).compactMap { entry -> (screenID: String, reason: String)? in
    guard let screen = entry["screenId"]?.stringValue else { return nil }
    return (screen, entry["reason"]?.stringValue ?? "")
  }
  return AiSeoApplyResult(versions: versions, staged: strings(answer?["staged"]), skipped: skipped)
}
