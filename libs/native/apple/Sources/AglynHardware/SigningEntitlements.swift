// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The entitlements the running build is signed with, read off its own executable: the code signature's entitlements
/// (a device build) or the `__TEXT,__entitlements` section Xcode writes for a simulator build. iOS has no public API that
/// asks this, and a capability Apple has not granted a build (Tap to Pay on iPhone's is development-only so far) must not
/// be offered by it: a store build would show an option that can only fail. Reading the signature itself means adding the
/// key to that build's entitlements turns the option on, with no code or setting to change beside it.
public struct SigningEntitlements: Sendable, Equatable {
  public let keys: Set<String>

  public init(keys: Set<String>) { self.keys = keys }

  public func contains(_ key: String) -> Bool { keys.contains(key) }

  /// The running build's, read once.
  public static let current: SigningEntitlements = {
    guard let url = Bundle.main.executableURL, let file = try? FileHandle(forReadingFrom: url) else {
      return SigningEntitlements(keys: [])
    }
    defer { try? file.close() }
    return read { offset, length in
      guard (try? file.seek(toOffset: UInt64(offset))) != nil else { return nil }
      return try? file.read(upToCount: length)
    }
  }()

  /// Reads a Mach-O executable (thin or universal) through `read(offset, length)`; an unreadable one has no keys.
  public static func read(_ read: (_ offset: Int, _ length: Int) -> Data?) -> SigningEntitlements {
    guard let magic = read(0, 8).map(Bytes.init), magic.count == 8 else { return SigningEntitlements(keys: []) }
    // A universal binary (big-endian header): each slice is a Mach-O of its own.
    if magic.u32be(0) == 0xCAFE_BABE {
      let count = Int(magic.u32be(4))
      guard count > 0, count < 16, let table = read(8, count * 20).map(Bytes.init), table.count == count * 20 else {
        return SigningEntitlements(keys: [])
      }
      var keys = Set<String>()
      for slice in 0..<count {
        let offset = Int(table.u32be(slice * 20 + 8))
        keys.formUnion(thin(at: offset, read).keys)
      }
      return SigningEntitlements(keys: keys)
    }
    return thin(at: 0, read)
  }

  private static func thin(at base: Int, _ read: (Int, Int) -> Data?) -> SigningEntitlements {
    // 64-bit little-endian Mach-O only (every build these apps ship).
    guard let header = read(base, 32).map(Bytes.init), header.count == 32, header.u32le(0) == 0xFEED_FACF else {
      return SigningEntitlements(keys: [])
    }
    let commands = Int(header.u32le(16))
    let size = Int(header.u32le(20))
    guard size > 0, size < 16 << 20, let table = read(base + 32, size).map(Bytes.init), table.count == size else {
      return SigningEntitlements(keys: [])
    }
    var keys = Set<String>()
    var at = 0
    for _ in 0..<commands {
      guard at + 8 <= table.count else { break }
      let command = table.u32le(at)
      let length = Int(table.u32le(at + 4))
      guard length >= 8, at + length <= table.count else { break }
      switch command {
      case 0x19:  // LC_SEGMENT_64: a simulator build's `__TEXT,__entitlements` section.
        if table.name(at + 8) == "__TEXT" {
          let sections = Int(table.u32le(at + 64))
          for index in 0..<sections {
            let section = at + 72 + index * 80
            guard section + 80 <= at + length, table.name(section) == "__entitlements" else { continue }
            let bytes = Int(table.u64le(section + 40))
            let offset = Int(table.u32le(section + 48))
            if bytes > 0, bytes < 1 << 20, let xml = read(base + offset, bytes) { keys.formUnion(plistKeys(xml)) }
          }
        }
      case 0x1D:  // LC_CODE_SIGNATURE: the signature's entitlements blob.
        let offset = Int(table.u32le(at + 8))
        let bytes = Int(table.u32le(at + 12))
        if bytes > 12, bytes < 16 << 20, let blob = read(base + offset, bytes) { keys.formUnion(signatureKeys(Bytes(blob))) }
      default: break
      }
      at += length
    }
    return SigningEntitlements(keys: keys)
  }

  /// The XML entitlements (`CSSLOT_ENTITLEMENTS`, blob magic `0xfade7171`) in a code signature superblob.
  static func signatureKeys(_ blob: Bytes) -> Set<String> {
    guard blob.count >= 12, blob.u32be(0) == 0xFADE_0CC0 else { return [] }
    let count = Int(blob.u32be(8))
    for index in 0..<min(count, 64) {
      let entry = 12 + index * 8
      guard entry + 8 <= blob.count, blob.u32be(entry) == 5 else { continue }
      let offset = Int(blob.u32be(entry + 4))
      guard offset + 8 <= blob.count, blob.u32be(offset) == 0xFADE_7171 else { continue }
      let length = Int(blob.u32be(offset + 4))
      guard length > 8, offset + length <= blob.count else { continue }
      return plistKeys(Data(blob.bytes[(offset + 8)..<(offset + length)]))
    }
    return []
  }

  /// A key counts when it is present and not `false` (an entitlement switched off is not one).
  static func plistKeys(_ data: Data) -> Set<String> {
    guard let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return [] }
    return Set(plist.compactMap { key, value in (value as? Bool) == false ? nil : key })
  }
}

/// Byte reads for the Mach-O walk.
struct Bytes {
  let bytes: [UInt8]
  init(_ data: Data) { bytes = [UInt8](data) }
  var count: Int { bytes.count }

  func u32le(_ at: Int) -> UInt32 {
    guard at + 4 <= count else { return 0 }
    return (0..<4).reduce(UInt32(0)) { $0 | UInt32(bytes[at + $1]) << (8 * UInt32($1)) }
  }

  func u64le(_ at: Int) -> UInt64 {
    guard at + 8 <= count else { return 0 }
    return (0..<8).reduce(UInt64(0)) { $0 | UInt64(bytes[at + $1]) << (8 * UInt64($1)) }
  }

  func u32be(_ at: Int) -> UInt32 {
    guard at + 4 <= count else { return 0 }
    return (0..<4).reduce(UInt32(0)) { $0 << 8 | UInt32(bytes[at + $1]) }
  }

  /// A fixed 16-byte name (segment or section), up to its first NUL.
  func name(_ at: Int) -> String {
    guard at + 16 <= count else { return "" }
    return String(decoding: bytes[at..<(at + 16)].prefix { $0 != 0 }, as: UTF8.self)
  }
}
