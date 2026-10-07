// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

extension ContractValues {
  /// The values in contracts.generated.json (list declarations, label maps),
  /// bundled with this module and decoded once.
  public static let shared: ContractValues = {
    guard let url = Bundle.module.url(forResource: "contracts.generated", withExtension: "json") else {
      fatalError("AglynContracts: contracts.generated.json is missing from the bundle")
    }
    do {
      return try decode(Data(contentsOf: url))
    } catch {
      fatalError("AglynContracts: contracts.generated.json does not decode: \(error)")
    }
  }()

  /// Decodes a contracts document; keys this build does not know are ignored.
  public static func decode(_ data: Data) throws -> ContractValues {
    try JSONDecoder().decode(ContractValues.self, from: data)
  }
}
