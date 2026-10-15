// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AVFoundation
import AglynUI
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/*
 * What a device reads from a film before it is uploaded (the console's `probeVideoFile`): its length and frame size, a still
 * from near the start for a poster, or why none of that could be had. Neither server can decode a film, so the uploader's device
 * does it, for nothing, before the bytes move. The Kotlin apps' VideoProbe.
 */

/// What a probe found: the film's length and frame size, a JPEG poster still, or a short note on what did not happen.
public struct VideoProbeResult: Sendable {
  public var durationMs: Int?
  public var width: Int?
  public var height: Int?
  public var poster: Data?
  public var reason: String?

  public init(durationMs: Int? = nil, width: Int? = nil, height: Int? = nil, poster: Data? = nil, reason: String? = nil) {
    self.durationMs = durationMs
    self.width = width
    self.height = height
    self.poster = poster
    self.reason = reason
  }
}

/// The most a film's length, or a side of its frame, may be before it is a bug and not a measurement (`MEDIA_VIDEO_MAX_*`).
private let videoMaxDurationMs = 24 * 60 * 60 * 1000
private let videoMaxDimension = 16384

/// How far into a film its poster is taken: a tenth of the way, but never past the first second (`posterTimeSeconds`).
public func posterTimeSeconds(_ durationSeconds: Double) -> Double {
  durationSeconds.isFinite && durationSeconds > 0 ? min(1, durationSeconds * 0.1) : 0.1
}

/// The widest a poster is made, and the quality it is encoded at (`POSTER_MAX_WIDTH`, `POSTER_QUALITY`).
public let posterMaxWidth = 1920
public let posterQuality = 0.82

/// What a probe adds to an upload or replace: `video` (length and frame size, all three or none, as the server accepts them),
/// `poster` (base64, no prefix) and, only when there is no poster, `posterError` with the device's reason cut to 200 characters.
/// A probe that found nothing and said nothing adds nothing.
public func videoProbeFields(_ result: VideoProbeResult) -> [String: Any?] {
  var fields: [String: Any?] = [:]
  if let duration = result.durationMs, let width = result.width, let height = result.height,
    (1...videoMaxDurationMs).contains(duration), (1...videoMaxDimension).contains(width), (1...videoMaxDimension).contains(height)
  {
    fields["video"] = ["durationMs": duration, "width": width, "height": height]
  }
  if let poster = result.poster, !poster.isEmpty {
    fields["poster"] = poster.base64EncodedString()
  } else if let reason = result.reason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
    fields["posterError"] = String(reason.prefix(200))
  }
  return fields
}

/// Reads a picked film with AVFoundation: its length, frame size (as it plays, the track's turn applied) and a still near the
/// start. Never throws; a film this device cannot read comes back with the reason.
public func probeVideo(_ file: PickedFile) async -> VideoProbeResult {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("aglyn-probe-\(UUID().uuidString)", isDirectory: true)
  let ext = (file.name as NSString).pathExtension.isEmpty ? "mp4" : (file.name as NSString).pathExtension
  let url = directory.appendingPathComponent("film.\(ext)")
  do {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try file.data.write(to: url)
  } catch {
    return VideoProbeResult(reason: "video probe failed — could not read the file")
  }
  defer { try? FileManager.default.removeItem(at: directory) }
  let asset = AVURLAsset(url: url)
  do {
    let duration = try await asset.load(.duration)
    let seconds = CMTimeGetSeconds(duration)
    guard seconds.isFinite, seconds > 0 else { return VideoProbeResult(reason: "video reported no usable duration") }
    let durationMs = Int((seconds * 1000).rounded())
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      return VideoProbeResult(reason: "video reported no frame size")
    }
    let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
    let turned = natural.applying(transform)
    let width = Int(abs(turned.width).rounded())
    let height = Int(abs(turned.height).rounded())
    guard width > 0, height > 0 else { return VideoProbeResult(reason: "video reported no frame size") }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: posterMaxWidth, height: posterMaxWidth)
    generator.requestedTimeToleranceBefore = .positiveInfinity
    generator.requestedTimeToleranceAfter = .positiveInfinity
    let at = CMTime(seconds: posterTimeSeconds(seconds), preferredTimescale: 600)
    let image: CGImage
    do {
      image = try await generator.image(at: at).image
    } catch {
      return VideoProbeResult(durationMs: durationMs, width: width, height: height, reason: "could not read a poster frame")
    }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
      return VideoProbeResult(durationMs: durationMs, width: width, height: height, reason: "poster frame encoded to nothing")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: posterQuality] as CFDictionary)
    guard CGImageDestinationFinalize(destination), output.length > 0 else {
      return VideoProbeResult(durationMs: durationMs, width: width, height: height, reason: "poster frame encoded to nothing")
    }
    return VideoProbeResult(durationMs: durationMs, width: width, height: height, poster: output as Data)
  } catch {
    return VideoProbeResult(reason: String("video probe failed — \(error.localizedDescription)".prefix(120)))
  }
}
