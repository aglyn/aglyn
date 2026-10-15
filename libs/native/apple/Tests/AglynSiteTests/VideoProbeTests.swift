// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AVFoundation
import AglynCore
import AglynUI
import CoreVideo
import XCTest

@testable import AglynSite

private final class FilmTransport: HTTPTransport, @unchecked Sendable {
  var bodies: [[String: Any]] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    if let body = request.httpBody, let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] { bodies.append(json) }
    return (Data(#"{"mediaId":"m1"}"#.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

final class VideoProbeTests: XCTestCase {
  /// A two-second film of solid colour frames, written the way a phone would write one.
  private func film(width: Int, height: Int, seconds: Int) async throws -> Data {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("probe-\(UUID().uuidString).mp4")
    defer { try? FileManager.default.removeItem(at: url) }
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(
      mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ])
    writer.add(input)
    XCTAssertTrue(writer.startWriting())
    writer.startSession(atSourceTime: .zero)
    for frame in 0..<(seconds * 10) {
      while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 5_000_000) }
      var buffer: CVPixelBuffer?
      CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, nil, &buffer)
      let pixels = try XCTUnwrap(buffer)
      CVPixelBufferLockBaseAddress(pixels, [])
      memset(CVPixelBufferGetBaseAddress(pixels), Int32(40 + frame * 4), CVPixelBufferGetBytesPerRow(pixels) * height)
      CVPixelBufferUnlockBaseAddress(pixels, [])
      adaptor.append(pixels, withPresentationTime: CMTime(value: Int64(frame), timescale: 10))
    }
    input.markAsFinished()
    await writer.finishWriting()
    XCTAssertEqual(writer.status, .completed, "\(String(describing: writer.error))")
    return try Data(contentsOf: url)
  }

  func testAFilmIsReadForItsLengthItsFrameAndAPoster() async throws {
    let data = try await film(width: 128, height: 96, seconds: 2)
    let result = await probeVideo(PickedFile(name: "clip.mp4", mimeType: "video/mp4", data: data))
    XCTAssertNil(result.reason)
    XCTAssertEqual(try XCTUnwrap(result.durationMs), 2000, accuracy: 150)
    XCTAssertEqual(result.width, 128)
    XCTAssertEqual(result.height, 96)
    // A poster is a JPEG.
    XCTAssertEqual(try XCTUnwrap(result.poster).prefix(2).map { $0 }, [0xFF, 0xD8])
    let fields = videoProbeFields(result)
    XCTAssertEqual(Set(fields.keys), ["video", "poster"])
  }

  func testSomethingThatIsNotAFilmSaysSoAndSendsNoPoster() async {
    let result = await probeVideo(PickedFile(name: "clip.mp4", mimeType: "video/mp4", data: Data([1, 2, 3, 4])))
    XCTAssertNil(result.poster)
    XCTAssertNotNil(result.reason)
    XCTAssertEqual(Set(videoProbeFields(result).keys), ["posterError"])
  }

  func testAFilmUploadCarriesWhatTheProbeFoundAndOtherFilesCarryNone() async throws {
    let transport = FilmTransport()
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    let api = MediaAPI(api: client, scope: .site(hostID: "h1"))
    let data = try await film(width: 64, height: 48, seconds: 1)
    _ = try await api.upload(PickedFile(name: "clip.mp4", mimeType: "video/mp4", data: data), folderID: nil)
    _ = try await api.upload(PickedFile(name: "a.png", mimeType: "image/png", data: Data([1])), folderID: nil)
    let sent = try XCTUnwrap(transport.bodies.first)
    let video = try XCTUnwrap(sent["video"] as? [String: Any])
    XCTAssertEqual(video["width"] as? Int, 64)
    XCTAssertEqual(video["height"] as? Int, 48)
    XCTAssertNotNil(sent["poster"] as? String)
    XCTAssertNil(sent["posterError"])
    XCTAssertNil(transport.bodies[1]["video"])
    XCTAssertNil(transport.bodies[1]["poster"])
  }

  func testWhatAProbeAddsIsBoundedAsTheServerBoundsIt() {
    XCTAssertEqual(Set(videoProbeFields(VideoProbeResult(durationMs: 1000, width: 640, height: 360, poster: Data([1]))).keys), ["video", "poster"])
    // No poster: the reason goes instead, cut to two hundred characters; and a poster hides the reason.
    let failed = videoProbeFields(VideoProbeResult(durationMs: 1000, width: 640, height: 360, poster: nil, reason: String(repeating: "x", count: 300)))
    XCTAssertEqual(Set(failed.keys), ["video", "posterError"])
    XCTAssertEqual((failed["posterError"] as? String)?.count, 200)
    XCTAssertEqual(
      Set(videoProbeFields(VideoProbeResult(durationMs: 1000, width: 640, height: 360, poster: Data([1]), reason: "ignored")).keys), ["video", "poster"])
    // Length and frame size are all or nothing, and bounded: a day, and 16384 a side.
    for odd in [
      VideoProbeResult(durationMs: 1000, width: nil, height: 360), VideoProbeResult(durationMs: 0, width: 640, height: 360),
      VideoProbeResult(durationMs: 86_400_001, width: 640, height: 360), VideoProbeResult(durationMs: 1000, width: 16_385, height: 360),
      VideoProbeResult(), VideoProbeResult(reason: "   "),
    ] {
      XCTAssertTrue(videoProbeFields(odd).isEmpty, "\(odd)")
    }
  }

  func testAPosterIsTakenATenthOfTheWayInButNeverPastTheFirstSecond() {
    XCTAssertEqual(posterTimeSeconds(0), 0.1)
    XCTAssertEqual(posterTimeSeconds(.infinity), 0.1)
    XCTAssertEqual(posterTimeSeconds(5), 0.5)
    XCTAssertEqual(posterTimeSeconds(600), 1)
  }
}
