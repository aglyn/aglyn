// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// The console's name-search normalizers (libs/aglyn app-utils/name-search.ts):
// how a name is keyed, tokenized and reversed when it is stored, so a query
// asks for exactly what a document holds. Lengths count UTF-16 units, as
// JavaScript's `slice` does.

/// Trimmed, single-spaced, lower case.
public func nameSearchKey(_ name: String?) -> String {
  (name ?? "")
    .split(whereSeparator: { $0.isWhitespace })
    .joined(separator: " ")
    .lowercased()
}

/// The first `count` UTF-16 units of `text`, as JavaScript's `slice(0, count)`.
private func utf16Prefix(_ text: Substring, _ count: Int) -> String {
  let units = Array(text.utf16.prefix(count))
  return String(decoding: units, as: UTF16.self)
}

/// Every prefix of every word, up to `NAME_TOKEN_MAX_PREFIX` units, at most `NAME_TOKEN_LIMIT`.
public func nameSearchTokens(_ name: String?) -> [String] {
  let key = nameSearchKey(name)
  if key.isEmpty { return [] }
  let maxPrefix = ContractValues.shared.nameTokenMaxPrefix
  let limit = ContractValues.shared.nameTokenLimit
  var tokens: [String] = []
  var seen = Set<String>()
  for word in key.split(separator: " ") {
    let capped = utf16Prefix(word, maxPrefix)
    let length = capped.utf16.count
    guard length > 0 else { continue }
    for end in 1...length {
      let token = utf16Prefix(Substring(capped), end)
      if seen.insert(token).inserted { tokens.append(token) }
      if tokens.count >= limit { return tokens }
    }
  }
  return tokens
}

/// The token a query asks for: its first word, capped like a stored token.
public func nameSearchToken(_ query: String?) -> String {
  let key = nameSearchKey(query)
  guard let first = key.split(separator: " ").first else { return "" }
  return utf16Prefix(first, ContractValues.shared.nameTokenMaxPrefix)
}

/// The key reversed by code point, for "ends with".
public func nameSearchReversed(_ name: String?) -> String {
  var scalars = String.UnicodeScalarView()
  scalars.append(contentsOf: nameSearchKey(name).unicodeScalars.reversed())
  return String(scalars)
}

/// How a planner normalizes what a person typed.
public protocol ListQueryNormalizers: Sendable {
  func key(_ value: String) -> String
  func token(_ value: String) -> String
  func reversed(_ value: String) -> String
  var maxPrefix: Int { get }
}

/// The normalizers the console's lists store names with.
public struct NameSearchNormalizers: ListQueryNormalizers {
  public init() {}
  public func key(_ value: String) -> String { nameSearchKey(value) }
  public func token(_ value: String) -> String { nameSearchToken(value) }
  public func reversed(_ value: String) -> String { nameSearchReversed(value) }
  public var maxPrefix: Int { ContractValues.shared.nameTokenMaxPrefix }
}
