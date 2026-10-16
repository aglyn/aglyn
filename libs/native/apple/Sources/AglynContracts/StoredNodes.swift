// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// A page, component, layout or template keeps its node tree either as a plain
// map or as msgpack bytes (`decodeStoredNodes` in stored-nodes.ts). A native
// reader hands the bytes over as `Data` (the Firebase SDK) or base64 text (the
// REST reader), and the console's routes take the tree as JSON and encode it
// themselves, so the apps only ever READ msgpack. function-cases.generated.json
// holds what the console's encoder (`compress`) makes of trees and scalars, and
// the tests decode each.

/// Bytes that are not a msgpack value this decoder reads.
public struct MsgPackError: Error, Equatable, CustomStringConvertible {
  public let message: String
  public var description: String { message }
}

private let msgPackMaxDepth = 512

/// One msgpack value as plain Swift: a map is a `[String: Any]`, an array an
/// `[Any]`, an integer an `Int` (a `Double` past what an `Int` holds), a float
/// a `Double`, nil an `NSNull`, `bin` a `Data`. A non-string map key is read
/// as its text.
public func decodeMsgPack(_ data: Data) throws -> Any {
  var reader = MsgPackReader(bytes: [UInt8](data))
  let value = try reader.read(depth: 0)
  if reader.position != reader.bytes.count { throw MsgPackError(message: "\(reader.bytes.count - reader.position) bytes follow the value") }
  return value
}

private struct MsgPackReader {
  let bytes: [UInt8]
  var position = 0

  init(bytes: [UInt8]) { self.bytes = bytes }

  private func need(_ count: Int) throws {
    if count < 0 || position + count > bytes.count { throw MsgPackError(message: "the bytes end inside a value") }
  }

  private mutating func byte() throws -> Int {
    try need(1)
    defer { position += 1 }
    return Int(bytes[position])
  }

  private mutating func unsigned(_ width: Int) throws -> UInt64 {
    try need(width)
    var value: UInt64 = 0
    for _ in 0..<width {
      value = (value << 8) | UInt64(bytes[position])
      position += 1
    }
    return value
  }

  private mutating func signed(_ width: Int) throws -> Int {
    let raw = try unsigned(width)
    let bits = UInt64(width * 8)
    if bits == 64 { return Int(Int64(bitPattern: raw)) }
    let shift = 64 - bits
    return Int(Int64(bitPattern: raw << shift) >> Int64(shift))
  }

  private mutating func length(_ width: Int) throws -> Int {
    let value = try unsigned(width)
    if value > UInt64(Int32.max) { throw MsgPackError(message: "a length past what fits") }
    return Int(value)
  }

  private mutating func text(_ count: Int) throws -> String {
    try need(count)
    guard let value = String(data: Data(bytes[position..<position + count]), encoding: .utf8) else {
      throw MsgPackError(message: "a string is not UTF-8")
    }
    position += count
    return value
  }

  private mutating func binary(_ count: Int) throws -> Data {
    try need(count)
    defer { position += count }
    return Data(bytes[position..<position + count])
  }

  private mutating func array(_ count: Int, depth: Int) throws -> [Any] {
    if count > bytes.count - position { throw MsgPackError(message: "an array longer than the bytes left") }
    var out: [Any] = []
    out.reserveCapacity(count)
    for _ in 0..<count { out.append(try read(depth: depth + 1)) }
    return out
  }

  private mutating func map(_ count: Int, depth: Int) throws -> [String: Any] {
    if count > bytes.count - position { throw MsgPackError(message: "a map longer than the bytes left") }
    var out: [String: Any] = [:]
    for _ in 0..<count {
      let key = try read(depth: depth + 1)
      out[(key as? String) ?? "\(key)"] = try read(depth: depth + 1)
    }
    return out
  }

  mutating func read(depth: Int) throws -> Any {
    if depth > msgPackMaxDepth { throw MsgPackError(message: "nested too deeply") }
    let tag = try byte()
    switch tag {
    case 0x00...0x7f: return tag
    case 0x80...0x8f: return try map(tag & 0x0f, depth: depth)
    case 0x90...0x9f: return try array(tag & 0x0f, depth: depth)
    case 0xa0...0xbf: return try text(tag & 0x1f)
    case 0xe0...0xff: return tag - 256
    case 0xc0: return NSNull()
    case 0xc2: return false
    case 0xc3: return true
    case 0xc4: return try binary(try length(1))
    case 0xc5: return try binary(try length(2))
    case 0xc6: return try binary(try length(4))
    case 0xca: return Double(Float(bitPattern: UInt32(try unsigned(4))))
    case 0xcb: return Double(bitPattern: try unsigned(8))
    case 0xcc: return Int(try unsigned(1))
    case 0xcd: return Int(try unsigned(2))
    case 0xce: return Int(try unsigned(4))
    case 0xcf:
      let value = try unsigned(8)
      return value <= UInt64(Int.max) ? Int(value) as Any : Double(value) as Any
    case 0xd0: return try signed(1)
    case 0xd1: return try signed(2)
    case 0xd2: return try signed(4)
    case 0xd3: return try signed(8)
    case 0xd9: return try text(try length(1))
    case 0xda: return try text(try length(2))
    case 0xdb: return try text(try length(4))
    case 0xdc: return try array(try length(2), depth: depth)
    case 0xdd: return try array(try length(4), depth: depth)
    case 0xde: return try map(try length(2), depth: depth)
    case 0xdf: return try map(try length(4), depth: depth)
    default: throw MsgPackError(message: "the extension or reserved type 0x\(String(tag, radix: 16)) is not read")
    }
  }
}

/// A stored `nodes` field as the tree it holds: a plain map is the tree
/// already; bytes (`Data` or base64 text) are decoded; anything else, or bytes
/// that do not decode to a map, is nil. Never throws: a document that cannot
/// be read is skipped, as the console's `decodeStoredNodes` does.
public func decodeStoredNodes(_ raw: Any?) -> [String: Any]? {
  switch raw {
  case let map as [String: Any]: return map
  case let data as Data: return (try? decodeMsgPack(data)) as? [String: Any]
  case let text as String:
    guard let data = Data(base64Encoded: text) else { return nil }
    return (try? decodeMsgPack(data)) as? [String: Any]
  default: return nil
  }
}
