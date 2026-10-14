// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The SEO check's pure rules (seo-audit.ts, seo-keywords.ts): a path as the
 * keyword lines and the routing map both spell it, the target keyword lines
 * (`/pricing: plans, pricing`) and a report's finding count.
 * SeoAuditTests replays the TypeScript's own answers. The Kotlin contracts' SeoAudit.kt.
 */

/// A path as the keyword lines and the routing map both spell it: leading slash, no trailing one.
public func seoNormalizePath(_ path: String) -> String {
  let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty || trimmed == "/" { return "/" }
  var rest = Substring(trimmed)
  while rest.first == "/" { rest = rest.dropFirst() }
  while rest.last == "/" { rest = rest.dropLast() }
  return "/" + rest
}

private let seoKeywordMaxChars = 60

/// Keywords as a person typed them, split at the limit: the ones a page is checked for, and the distinct ones past it.
public struct SeoKeywordSplit: Equatable, Sendable {
  public var keywords: [String]
  public var unchecked: [String]
}

public func seoKeywordSplit(_ parts: [String]) -> SeoKeywordSplit {
  var seen = Set<String>()
  var split = SeoKeywordSplit(keywords: [], unchecked: [])
  let limit = ContractValues.shared.seoMaxKeywords
  for part in parts {
    let collapsed = part.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    // `slice(0, 60)`: sixty UTF-16 units.
    let keyword = String(decoding: Array(collapsed.utf16.prefix(seoKeywordMaxChars)), as: UTF16.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let key = keyword.lowercased()
    if keyword.isEmpty || !seen.insert(key).inserted { continue }
    if split.keywords.count < limit { split.keywords.append(keyword) } else { split.unchecked.append(keyword) }
  }
  return split
}

public func seoKeywordSplit(_ text: String?) -> SeoKeywordSplit {
  seoKeywordSplit((text ?? "").components(separatedBy: CharacterSet(charactersIn: ",\n")))
}

/// Target keyword lines read: the keywords each page is checked for, and those past the limit, by normalized path, in the order written.
public struct SeoKeywordLines: Equatable, Sendable {
  public var paths: [String]
  public var keywords: [String: [String]]
  public var unchecked: [String: [String]]
}

public func readSeoKeywordLines(_ raw: String?) -> SeoKeywordLines {
  var order: [String] = []
  var typed: [String: [String]] = [:]
  for line in (raw ?? "").components(separatedBy: "\n") {
    guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { continue }
    let path = seoNormalizePath(String(line[..<colon]))
    let parts = String(line[line.index(after: colon)...]).components(separatedBy: ",")
    if parts.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
      if typed[path] == nil { order.append(path) }
      typed[path, default: []] += parts
    }
  }
  var out = SeoKeywordLines(paths: [], keywords: [:], unchecked: [:])
  for path in order {
    let split = seoKeywordSplit(typed[path] ?? [])
    if !split.keywords.isEmpty {
      out.paths.append(path)
      out.keywords[path] = split.keywords
    }
    if !split.unchecked.isEmpty { out.unchecked[path] = split.unchecked }
  }
  return out
}

/// One page and the keywords it is checked for.
public struct SeoTargetKeywordRow: Equatable, Identifiable, Sendable {
  public let id = UUID()
  public var path: String
  public var keywords: [String]

  public init(path: String, keywords: [String]) {
    self.path = path
    self.keywords = keywords
  }

  public static func == (a: SeoTargetKeywordRow, b: SeoTargetKeywordRow) -> Bool { a.path == b.path && a.keywords == b.keywords }
}

/// Stored keyword lines as rows, one per page, in the order they were written.
public func seoKeywordRows(fromLines lines: String?) -> [SeoTargetKeywordRow] {
  let read = readSeoKeywordLines(lines)
  return read.paths.map { SeoTargetKeywordRow(path: $0, keywords: (read.keywords[$0] ?? []) + (read.unchecked[$0] ?? [])) }
}

/// Rows as the keyword lines the check reads. A row with no page or no keywords says nothing and is left out.
public func seoKeywordLines(fromRows rows: [SeoTargetKeywordRow]) -> String {
  rows.filter { !$0.path.isEmpty && !$0.keywords.isEmpty }.map { "\(seoNormalizePath($0.path)): \($0.keywords.joined(separator: ", "))" }.joined(separator: "\n")
}

/// Findings in a report: each page's and the site's.
public func seoAuditFindingCount(_ report: SeoAuditReport) -> Int { report.pages.reduce(report.site.count) { $0 + $1.findings.count } }

/// What a finding is called where it is listed, with the keyword it names.
public func seoFindingLabel(_ finding: SeoFinding) -> String {
  let label = ContractValues.shared.seoFindingLabels[finding.code.rawValue] ?? finding.code.rawValue
  return finding.keyword.flatMap { $0.isEmpty ? nil : $0 }.map { "\(label): \($0)" } ?? label
}
