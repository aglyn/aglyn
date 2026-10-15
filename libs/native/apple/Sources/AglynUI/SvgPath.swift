// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The shape of an SVG path (`M12 2L2 22h20z`): a Material Design icon's `iconPath`, which a component stores. Every command is
/// read, absolute and relative: M L H V C S Q T A Z. A string that does not parse is no shape, never a crash. The icons are 24
/// units square.
public func svgPath(_ data: String?) -> Path? {
  guard let data, !data.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  var reader = SvgPathReader(Array(data.unicodeScalars))
  return reader.read()
}

private struct SvgPathReader {
  let text: [Unicode.Scalar]
  var index = 0

  init(_ text: [Unicode.Scalar]) { self.text = text }

  private mutating func skipSeparators() {
    while index < text.count, text[index] == "," || CharacterSet.whitespacesAndNewlines.contains(text[index]) { index += 1 }
  }

  private static let commands = Set("MmLlHhVvCcSsQqTtAaZz".unicodeScalars)

  private static func isDigit(_ scalar: Unicode.Scalar) -> Bool { scalar.value >= 48 && scalar.value <= 57 }

  /// The next number, or nil when the next thing is a command or the end.
  private mutating func number() -> Double? {
    skipSeparators()
    let start = index
    var cursor = index
    func digits() -> Bool {
      let from = cursor
      while cursor < text.count, Self.isDigit(text[cursor]) { cursor += 1 }
      return cursor > from
    }
    if cursor < text.count, text[cursor] == "+" || text[cursor] == "-" { cursor += 1 }
    let whole = digits()
    var fraction = false
    if cursor < text.count, text[cursor] == "." {
      cursor += 1
      fraction = digits()
    }
    guard whole || fraction else { return nil }
    if cursor < text.count, text[cursor] == "e" || text[cursor] == "E" {
      var probe = cursor + 1
      if probe < text.count, text[probe] == "+" || text[probe] == "-" { probe += 1 }
      let from = probe
      while probe < text.count, Self.isDigit(text[probe]) { probe += 1 }
      if probe > from { cursor = probe }
    }
    index = cursor
    return Double(String(String.UnicodeScalarView(text[start..<cursor])).trimmingCharacters(in: .whitespaces))
  }

  /// An arc's flag: one digit, which may be written without a separator after it.
  private mutating func flag() -> Bool? {
    skipSeparators()
    guard index < text.count, text[index] == "0" || text[index] == "1" else { return nil }
    defer { index += 1 }
    return text[index] == "1"
  }

  mutating func read() -> Path? {
    var path = Path()
    var current = CGPoint.zero
    var start = CGPoint.zero
    var lastControl: CGPoint?
    var lastCommand: Unicode.Scalar = "M"
    var command: Unicode.Scalar?
    var opened = false

    while true {
      skipSeparators()
      guard index < text.count else { break }
      let next = text[index]
      if Self.commands.contains(next) {
        command = next
        index += 1
      } else if command == nil {
        return nil
      } else if command == "Z" || command == "z" {
        // Numbers after a close are not part of it.
        return nil
      } else if command == "M" {
        command = "L"
      } else if command == "m" {
        command = "l"
      }
      guard let active = command else { return nil }
      let relative = active.properties.isLowercase
      let origin = relative ? current : .zero
      switch active {
      case "M", "m":
        guard let x = number(), let y = number() else { return nil }
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        start = current
        path.move(to: current)
        opened = true
        lastControl = nil
      case "L", "l":
        guard opened, let x = number(), let y = number() else { return nil }
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        path.addLine(to: current)
        lastControl = nil
      case "H", "h":
        guard opened, let x = number() else { return nil }
        current = CGPoint(x: (relative ? current.x : 0) + x, y: current.y)
        path.addLine(to: current)
        lastControl = nil
      case "V", "v":
        guard opened, let y = number() else { return nil }
        current = CGPoint(x: current.x, y: (relative ? current.y : 0) + y)
        path.addLine(to: current)
        lastControl = nil
      case "C", "c":
        guard opened, let x1 = number(), let y1 = number(), let x2 = number(), let y2 = number(), let x = number(), let y = number() else { return nil }
        let c1 = CGPoint(x: origin.x + x1, y: origin.y + y1)
        let c2 = CGPoint(x: origin.x + x2, y: origin.y + y2)
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        path.addCurve(to: current, control1: c1, control2: c2)
        lastControl = c2
      case "S", "s":
        guard opened, let x2 = number(), let y2 = number(), let x = number(), let y = number() else { return nil }
        let reflected = lastControl.flatMap { "CcSs".unicodeScalars.contains(lastCommand) ? CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) : nil } ?? current
        let c2 = CGPoint(x: origin.x + x2, y: origin.y + y2)
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        path.addCurve(to: current, control1: reflected, control2: c2)
        lastControl = c2
      case "Q", "q":
        guard opened, let x1 = number(), let y1 = number(), let x = number(), let y = number() else { return nil }
        let control = CGPoint(x: origin.x + x1, y: origin.y + y1)
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        path.addQuadCurve(to: current, control: control)
        lastControl = control
      case "T", "t":
        guard opened, let x = number(), let y = number() else { return nil }
        let reflected = lastControl.flatMap { "QqTt".unicodeScalars.contains(lastCommand) ? CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) : nil } ?? current
        current = CGPoint(x: origin.x + x, y: origin.y + y)
        path.addQuadCurve(to: current, control: reflected)
        lastControl = reflected
      case "A", "a":
        guard opened, let rx = number(), let ry = number(), let rotation = number(), let large = flag(), let sweep = flag(), let x = number(), let y = number()
        else { return nil }
        let end = CGPoint(x: origin.x + x, y: origin.y + y)
        Self.arc(&path, from: current, to: end, rx: rx, ry: ry, degrees: rotation, large: large, sweep: sweep)
        current = end
        lastControl = nil
      case "Z", "z":
        path.closeSubpath()
        current = start
        lastControl = nil
      default:
        return nil
      }
      lastCommand = active
    }
    return opened ? path : nil
  }

  /// An SVG elliptical arc as cubic curves (the endpoint-to-center conversion of the SVG implementation notes).
  private static func arc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx rxIn: Double, ry ryIn: Double, degrees: Double, large: Bool, sweep: Bool) {
    var rx = abs(rxIn)
    var ry = abs(ryIn)
    if p0 == p1 { return }
    if rx == 0 || ry == 0 {
      path.addLine(to: p1)
      return
    }
    let phi = degrees * .pi / 180
    let cosPhi = cos(phi)
    let sinPhi = sin(phi)
    let dx = (p0.x - p1.x) / 2
    let dy = (p0.y - p1.y) / 2
    let x1 = cosPhi * dx + sinPhi * dy
    let y1 = -sinPhi * dx + cosPhi * dy
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if lambda > 1 {
      rx *= lambda.squareRoot()
      ry *= lambda.squareRoot()
    }
    let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    var factor = denominator == 0 ? 0 : (max(0, numerator) / denominator).squareRoot()
    if large == sweep { factor = -factor }
    let cxp = factor * rx * y1 / ry
    let cyp = -factor * ry * x1 / rx
    let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
    let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2
    func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
      let dot = ux * vx + uy * vy
      let length = (ux * ux + uy * uy).squareRoot() * (vx * vx + vy * vy).squareRoot()
      var value = acos(max(-1, min(1, dot / length)))
      if ux * vy - uy * vx < 0 { value = -value }
      return value
    }
    let theta = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
    var delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
    if !sweep && delta > 0 { delta -= 2 * .pi }
    if sweep && delta < 0 { delta += 2 * .pi }
    let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
    let step = delta / Double(segments)
    let alpha = 4.0 / 3.0 * tan(step / 4)
    var from = theta
    for _ in 0..<segments {
      let to = from + step
      func point(_ t: Double) -> (x: Double, y: Double, dx: Double, dy: Double) {
        let ex = rx * cos(t)
        let ey = ry * sin(t)
        return (
          cosPhi * ex - sinPhi * ey + cx, sinPhi * ex + cosPhi * ey + cy, -cosPhi * rx * sin(t) - sinPhi * ry * cos(t),
          -sinPhi * rx * sin(t) + cosPhi * ry * cos(t)
        )
      }
      let a = point(from)
      let b = point(to)
      path.addCurve(
        to: CGPoint(x: b.x, y: b.y), control1: CGPoint(x: a.x + alpha * a.dx, y: a.y + alpha * a.dy),
        control2: CGPoint(x: b.x - alpha * b.dx, y: b.y - alpha * b.dy))
      from = to
    }
  }
}

/// A Material Design icon drawn from its SVG path, at `size` points square and in the foreground style; nothing is drawn for a
/// path that does not parse.
public struct SvgPathIcon: View {
  let path: String?
  let size: CGFloat
  let label: String?

  public init(_ path: String?, size: CGFloat = 24, label: String? = nil) {
    self.path = path
    self.size = size
    self.label = label
  }

  public var body: some View {
    Group {
      if let shape = svgPath(path) {
        shape.applying(CGAffineTransform(scaleX: size / 24, y: size / 24)).fill()
      } else {
        Color.clear
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(label == nil)
    .accessibilityLabel(label ?? "")
  }
}
