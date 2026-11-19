// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation
import SwiftUI

/// One point of a drawn signature: 0 to 1000 across and down the pad.
public struct SignaturePoint: Equatable, Sendable {
  public let x: Int
  public let y: Int

  public init(_ x: Int, _ y: Int) {
    self.x = x
    self.y = y
  }
}

/// A DRAWN SIGNATURE (`kind: "signature"`), taken as the console's `SignaturePad` takes one (AGL-4042), so a signing on the
/// apps reaches `waivers/sign-at-window` in the shape a signing in the browser does:
/// - each point is a whole number from 0 to 1000 across and down a pad three times as wide as it is tall;
/// - a point closer than 3 (across plus down) to the last one is skipped, and a stroke stops growing at 3,900 points in all;
/// - the value is `{ strokes: [[[x, y], …], …], png }`, `png` the picture as a `data:image/png;base64,` address (the route
///   keeps it privately, and the signed PDF redraws the strokes). Nothing drawn is no value at all.
///
/// The picture is drawn here, by hand, the same on every device (the Kotlin kit's `SignatureInk` makes the same bytes):
/// black ink on white, 1200 by 400 pixels, one bit a pixel, so the PNG is small and the same strokes always make the same
/// file. No colour is chosen for it: a one-bit grey picture has only black and white.
public enum SignatureInk {
  public typealias Strokes = [[SignaturePoint]]

  /// The pad is three times as wide as it is tall (the console's `ASPECT`).
  public static let aspect: CGFloat = 3
  public static let width = 1200
  public static let height = 400
  /// The console's `>= 3900`: past this many points in all, a stroke takes no more.
  public static let maxPoints = 3900
  /// The console skips a point under 3 away (across plus down) from the last one.
  public static let minStep = 3
  /// The ink's radius in pixels: a line about 4 pixels wide on the 1200-pixel picture (the console's `width / 320`).
  static let radius = 2

  /// A place on a pad `size` as the console stores it: rounded half up, kept inside 0 to 1000.
  public static func at(_ location: CGPoint, in size: CGSize) -> SignaturePoint {
    func scaled(_ value: CGFloat, _ side: CGFloat) -> Int {
      Swift.min(1000, Swift.max(0, Int((Double(value) / Swift.max(1, Double(side)) * 1000 + 0.5).rounded(.down))))
    }
    return SignaturePoint(scaled(location.x, size.width), scaled(location.y, size.height))
  }

  /// A new stroke begins at `point` (a press always starts one, as the console's `pointerdown` does).
  public static func begin(_ strokes: Strokes, _ point: SignaturePoint) -> Strokes { strokes + [[point]] }

  /// The last stroke grown by `point`, or nil when the console would skip it (too close, or the pad is full).
  public static func extend(_ strokes: Strokes, _ point: SignaturePoint) -> Strokes? {
    guard let stroke = strokes.last, let last = stroke.last else { return nil }
    if abs(point.x - last.x) + abs(point.y - last.y) < minStep { return nil }
    if strokes.reduce(0, { $0 + $1.count }) >= maxPoints { return nil }
    return Array(strokes.dropLast()) + [stroke + [point]]
  }

  /// The strokes a stored value holds (`{ strokes }`), or none.
  public static func strokes(of value: String) -> Strokes {
    guard !value.isEmpty, let json = JSONValue.decode(Data(value.utf8)) else { return [] }
    return json["strokes"].array.compactMap { stroke -> [SignaturePoint]? in
      let points = stroke.arrayValue?.compactMap { pair -> SignaturePoint? in
        guard let x = pair.arrayValue?.first?.numberValue, let y = pair.arrayValue?.dropFirst().first?.numberValue else { return nil }
        return SignaturePoint(Int(x), Int(y))
      } ?? []
      return points.isEmpty ? nil : points
    }
  }

  /// What the field holds for `strokes`: `{ strokes, png }` as JSON text, or "" when nothing is drawn.
  public static func encode(_ strokes: Strokes) -> String {
    guard !strokes.isEmpty else { return "" }
    let value: JSONValue = .object([
      "strokes": .array(strokes.map { stroke in .array(stroke.map { .array([.number(Double($0.x)), .number(Double($0.y))]) }) }),
      "png": .string(dataURL(strokes)),
    ])
    return (try? value.encoded()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
  }

  /// What the form sends for the field: the stored object, or null when nothing is drawn.
  public static func json(_ value: String) -> JSONValue {
    value.isEmpty ? .null : (JSONValue.decode(Data(value.utf8)) ?? .null)
  }

  public static func dataURL(_ strokes: Strokes) -> String {
    "data:image/png;base64," + png(strokes).base64EncodedString()
  }

  /// The strokes as a one-bit PNG, black on white, `width` by `height`.
  public static func png(_ strokes: Strokes) -> Data {
    let rowBytes = width / 8
    var bits = [UInt8](repeating: 0xFF, count: rowBytes * height)
    func ink(_ px: Int, _ py: Int) {
      guard px >= 0, py >= 0, px < width, py < height else { return }
      bits[py * rowBytes + px / 8] &= ~(UInt8(1) << UInt8(7 - px % 8))
    }
    func dot(_ cx: Int, _ cy: Int) {
      for dy in -radius...radius {
        for dx in -radius...radius where dx * dx + dy * dy <= radius * radius { ink(cx + dx, cy + dy) }
      }
    }
    for stroke in strokes {
      let pixels = stroke.map { (x: $0.x * width / 1000, y: $0.y * height / 1000) }
      if pixels.count == 1 { dot(pixels[0].x, pixels[0].y) }
      for index in pixels.indices.dropFirst() {
        let (x0, y0) = pixels[index - 1]
        let (x1, y1) = pixels[index]
        let dx = x1 - x0, dy = y1 - y0
        let steps = Swift.max(abs(dx), abs(dy))
        if steps == 0 {
          dot(x0, y0)
        } else {
          for step in 0...steps { dot(x0 + dx * step / steps, y0 + dy * step / steps) }
        }
      }
    }
    // Each row starts with filter 0 (none), then its packed pixels.
    var raw = [UInt8]()
    raw.reserveCapacity((rowBytes + 1) * height)
    for row in 0..<height {
      raw.append(0)
      raw += bits[(row * rowBytes)..<((row + 1) * rowBytes)]
    }
    var header = int(width) + int(height)
    header += [1, 0, 0, 0, 0]  // bit depth 1, greyscale, deflate, no filter set, no interlace
    var file: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    file += chunk("IHDR", header) + chunk("IDAT", zlibStored(raw)) + chunk("IEND", [])
    return Data(file)
  }

  /// `data` in zlib's stored (uncompressed) blocks, with its Adler-32: what every PNG reader takes.
  static func zlibStored(_ data: [UInt8]) -> [UInt8] {
    var out: [UInt8] = [0x78, 0x01]
    var at = 0
    repeat {
      let length = Swift.min(65535, data.count - at)
      let last = at + length >= data.count
      out.append(last ? 1 : 0)
      out += [UInt8(length & 0xFF), UInt8(length >> 8 & 0xFF), UInt8(~length & 0xFF), UInt8(~length >> 8 & 0xFF)]
      out += data[at..<(at + length)]
      at += length
    } while at < data.count
    var a: UInt32 = 1, b: UInt32 = 0
    for byte in data {
      a = (a + UInt32(byte)) % 65521
      b = (b + a) % 65521
    }
    return out + int(Int(b << 16 | a))
  }

  static func chunk(_ type: String, _ data: [UInt8]) -> [UInt8] {
    let typed = Array(type.utf8) + data
    return int(data.count) + typed + int(Int(crc32(typed)))
  }

  private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  static func crc32(_ data: [UInt8]) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    for byte in data { c = crcTable[Int((c ^ UInt32(byte)) & 0xFF)] ^ (c >> 8) }
    return c ^ 0xFFFF_FFFF
  }

  private static func int(_ value: Int) -> [UInt8] {
    let v = UInt32(truncatingIfNeeded: value)
    return [UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)]
  }
}

/// The pad a `signature` field draws: sign with a finger, a stylus or a mouse, Clear to start again, and the field's help
/// beside it (the console's "Sign with your finger, a stylus or a mouse."). The pad's ground and ink are the theme's paper
/// and its text; only the stored picture is black on white.
struct SignatureFieldView: View {
  let field: FieldSpec
  let label: String
  let help: String?
  @Binding var value: FieldValue
  /// The strokes while a finger is down; committed to the value when it lifts.
  @State private var live: SignatureInk.Strokes?

  private var stored: SignatureInk.Strokes {
    if case .text(let text) = value { return SignatureInk.strokes(of: text) }
    return []
  }

  var body: some View {
    let shown = live ?? stored
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      // The label is the pad's accessible name, as the console's is; a `heading` field names the step above it.
      GeometryReader { proxy in
        Canvas { context, size in
          let width = Swift.max(2, size.width / 320)
          for line in shown {
            var path = Path()
            for (index, point) in line.enumerated() {
              let at = CGPoint(x: CGFloat(point.x) / 1000 * size.width, y: CGFloat(point.y) / 1000 * size.height)
              if index == 0 { path.move(to: at) } else { path.addLine(to: at) }
            }
            if line.count == 1, let only = line.first {
              path.addLine(to: CGPoint(x: CGFloat(only.x) / 1000 * size.width + 0.5, y: CGFloat(only.y) / 1000 * size.height))
            }
            context.stroke(path, with: .color(.primary), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
          }
        }
        .contentShape(Rectangle())
        .gesture(
          DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { drag in
              let point = SignatureInk.at(drag.location, in: proxy.size)
              if let strokes = live {
                if let grown = SignatureInk.extend(strokes, point) { live = grown }
              } else {
                live = SignatureInk.begin(stored, point)
              }
            }
            .onEnded { _ in
              if let strokes = live { value = .text(SignatureInk.encode(strokes)) }
              live = nil
            })
      }
      .aspectRatio(SignatureInk.aspect, contentMode: .fit)
      .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).stroke(AglynColor.divider))
      .accessibilityElement()
      .accessibilityLabel(shown.isEmpty ? "\(label): empty. Draw your signature here." : "\(label): signed")
      .accessibilityIdentifier("signature-\(field.key)")
      HStack {
        Text(help ?? "").font(AglynFont.caption).foregroundStyle(.secondary)
        Spacer(minLength: AglynSpace.one)
        Button("Clear") { value = .text("") }
          .buttonStyle(.borderless)
          .disabled(shown.isEmpty)
          .accessibilityIdentifier("signature-clear-\(field.key)")
      }
    }
  }
}
