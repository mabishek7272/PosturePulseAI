import XCTest
@testable import PostureAnalysisClient

final class MultipartBodyTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    func testBuildsSidecarFieldThenClipFilePart() throws {
        let clip = dir.appendingPathComponent("clip.mov")
        try Data([0x00, 0x01, 0xFF, 0x0D, 0x0A]).write(to: clip)
        let out = dir.appendingPathComponent("body")
        let sidecar = Data(#"{"clipId":"c1"}"#.utf8)

        try MultipartBody.write(to: out, boundary: "BOUNDARY", sidecarJSON: sidecar, clipFile: clip)

        var expected = Data()
        expected.append(Data("--BOUNDARY\r\n".utf8))
        expected.append(Data("Content-Disposition: form-data; name=\"sidecar\"\r\n".utf8))
        expected.append(Data("Content-Type: application/json\r\n\r\n".utf8))
        expected.append(sidecar)
        expected.append(Data("\r\n--BOUNDARY\r\n".utf8))
        expected.append(Data("Content-Disposition: form-data; name=\"clip\"; filename=\"clip.mov\"\r\n".utf8))
        expected.append(Data("Content-Type: video/quicktime\r\n\r\n".utf8))
        expected.append(Data([0x00, 0x01, 0xFF, 0x0D, 0x0A]))
        expected.append(Data("\r\n--BOUNDARY--\r\n".utf8))
        XCTAssertEqual(try Data(contentsOf: out), expected)
        XCTAssertEqual(MultipartBody.contentType(boundary: "BOUNDARY"), "multipart/form-data; boundary=BOUNDARY")
    }

    func testStreamsLargeClipsInChunks() throws {
        let clip = dir.appendingPathComponent("clip.mov")
        let bytes = Data((0..<300_000).map { UInt8($0 % 251) })
        try bytes.write(to: clip)
        let out = dir.appendingPathComponent("body")
        try MultipartBody.write(to: out, boundary: "B", sidecarJSON: Data("{}".utf8), clipFile: clip)
        let body = try Data(contentsOf: out)
        XCTAssertNotNil(body.range(of: bytes))
        XCTAssertTrue(body.suffix(7) == Data("\r\n--B--\r\n".utf8).suffix(7))
    }
}

final class ClipUploadClientTests: XCTestCase {
    func testPutsMultipartToTheStepRouteWithTheSessionToken() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let clip = dir.appendingPathComponent("clip.mov")
        try Data([1, 2, 3]).write(to: clip)

        let session = StubURLProtocol.session(status: 201, body: Data(#"{"clipId":"c9","status":"uploaded"}"#.utf8))
        let client = ClipUploadClient(session: session, scratchDirectory: dir)
        let response = try await client.upload(
            .init(sessionId: "s1", stepId: "static.anterior", token: "tok", clipFile: clip, sidecarJSON: Data("{}".utf8))
        )

        XCTAssertEqual(response, ClipUploadResponse(clipId: "c9", status: "uploaded"))
        let request = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/sessions/s1/clips/static.anterior")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer tok")
        XCTAssertTrue(request.value(forHTTPHeaderField: "content-type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0 != "clip.mov" }
        XCTAssertEqual(leftovers, [], "the temporary multipart body is removed")
    }

    func testNon2xxThrowsTheStatus() async throws {
        let dir = FileManager.default.temporaryDirectory
        let clip = dir.appendingPathComponent(UUID().uuidString + ".mov")
        try Data([1]).write(to: clip)
        defer { try? FileManager.default.removeItem(at: clip) }
        let client = ClipUploadClient(session: StubURLProtocol.session(status: 409, body: Data()), scratchDirectory: dir)
        do {
            _ = try await client.upload(.init(sessionId: "s", stepId: "x", token: "t", clipFile: clip, sidecarJSON: Data("{}".utf8)))
            XCTFail("expected an error")
        } catch let error as HTTPStatusError {
            XCTAssertEqual(error.status, 409)
        }
    }
}

private final class FakeUploader: ClipUploading {
    var results: [Result<ClipUploadResponse, Error>] = []
    private(set) var calls: [ClipUploadRequest] = []
    var sawClipBytes: [Data] = []

    func upload(_ request: ClipUploadRequest) async throws -> ClipUploadResponse {
        calls.append(request)
        sawClipBytes.append((try? Data(contentsOf: request.clipFile)) ?? Data())
        return try results.removeFirst().get()
    }
}

final class ClipUploadQueueTests: XCTestCase {
    private var root: URL!
    private var source: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        source = root.appendingPathComponent("recorded.mov")
        try Data([9, 8, 7]).write(to: source)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func sidecar(step: String = "static.anterior") -> ClipCapture {
        ClipCapture(
            clipId: "c1", sessionId: "s1", stepId: step, view: .anterior, recordedAt: Date(), nominalFps: 30,
            width: 1080, height: 1920, frames: [.init(index: 0, t: 0, gravity: [0, 1, 0])], intrinsics: nil,
            device: .init(model: "x", lens: .backWide, appVersion: "1"), provenance: .clipRecorder(producedAt: Date())
        )
    }

    private func queue(_ uploader: FakeUploader) -> ClipUploadQueue {
        ClipUploadQueue(directory: root.appendingPathComponent("queue"), uploader: uploader)
    }

    func testEnqueueMovesTheClipIntoThePersistedQueue() async throws {
        let q = queue(FakeUploader())
        let item = try await q.enqueue(clipFile: source, sidecar: sidecar(), token: "tok")
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path), "the clip is moved, not copied")
        let pending = await q.pending()
        XCTAssertEqual(pending.map(\.uploadId), [item.uploadId])
        XCTAssertEqual(pending.first?.stepId, "static.anterior")

        // A fresh queue over the same directory (e.g. after a relaunch) sees it too.
        let reopened = await queue(FakeUploader()).pending()
        XCTAssertEqual(reopened.map(\.uploadId), [item.uploadId])
    }

    func testSuccessfulUploadDeletesTheLocalClip() async throws {
        let uploader = FakeUploader()
        uploader.results = [.success(ClipUploadResponse(clipId: "srv-1", status: "uploaded"))]
        let q = queue(uploader)
        let item = try await q.enqueue(clipFile: source, sidecar: sidecar(), token: "tok")

        let result = await q.send(item.uploadId)

        XCTAssertEqual(result, .uploaded(ClipUploadResponse(clipId: "srv-1", status: "uploaded")))
        XCTAssertEqual(uploader.sawClipBytes, [Data([9, 8, 7])])
        XCTAssertEqual(uploader.calls.first?.sessionId, "s1")
        XCTAssertEqual(uploader.calls.first?.token, "tok")
        let sent = try JSONSerialization.jsonObject(with: try XCTUnwrap(uploader.calls.first?.sidecarJSON)) as? [String: Any]
        XCTAssertEqual(sent?["stepId"] as? String, "static.anterior")
        let pendingAfter = await q.pending()
        XCTAssertTrue(pendingAfter.isEmpty)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("queue").path)
        XCTAssertEqual(leftovers, [])
    }

    func testTransientFailureKeepsTheClipForRetry() async throws {
        let uploader = FakeUploader()
        uploader.results = [.failure(URLError(.notConnectedToInternet)), .failure(HTTPStatusError(status: 503)),
                            .success(ClipUploadResponse(clipId: "srv-2", status: "uploaded"))]
        let q = queue(uploader)
        let item = try await q.enqueue(clipFile: source, sidecar: sidecar(), token: "tok")

        let first = await q.send(item.uploadId)
        XCTAssertEqual(first, .willRetry)
        let second = await q.send(item.uploadId)
        XCTAssertEqual(second, .willRetry)
        let pending = await q.pending()
        XCTAssertEqual(pending.first?.attempts, 2)
        let third = await q.drain()
        XCTAssertEqual(third, [item.uploadId: .uploaded(ClipUploadResponse(clipId: "srv-2", status: "uploaded"))])
        let pendingAfter = await q.pending()
        XCTAssertTrue(pendingAfter.isEmpty)
    }

    func testRejectedUploadIsDroppedAndTheClipDeleted() async throws {
        let uploader = FakeUploader()
        uploader.results = [.failure(HTTPStatusError(status: 409))]
        let q = queue(uploader)
        let item = try await q.enqueue(clipFile: source, sidecar: sidecar(), token: "tok")

        let result = await q.send(item.uploadId)

        XCTAssertEqual(result, .rejected(status: 409))
        let pendingAfter = await q.pending()
        XCTAssertTrue(pendingAfter.isEmpty)
    }

    func testDiscardRemovesEveryPendingClipOfASession() async throws {
        let q = queue(FakeUploader())
        _ = try await q.enqueue(clipFile: source, sidecar: sidecar(), token: "tok")
        await q.discard(sessionId: "s1")
        let pendingAfter = await q.pending()
        XCTAssertTrue(pendingAfter.isEmpty)
    }
}

final class StepStatusClientTests: XCTestCase {
    func testDecodesStepStatusesWithTheSubjectToken() async throws {
        let body = #"""
        [{"stepId":"static.anterior","status":"analyzed","usable":false,"reasons":["out_of_frame"]},
         {"stepId":"static.posterior","status":"processing","usable":null,"reasons":[]},
         {"stepId":"static.left_lateral","status":"missing","reasons":[]}]
        """#
        let client = StepStatusClient(session: StubURLProtocol.session(status: 200, body: Data(body.utf8)))
        let statuses = try await client.fetch(credentials: SessionCredentials(sessionId: "s1", token: "tok"))
        XCTAssertEqual(StubURLProtocol.requests.last?.url?.path, "/sessions/s1/steps")
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "authorization"), "Bearer tok")
        XCTAssertEqual(statuses.map(\.status), [.analyzed, .processing, .missing])
        XCTAssertEqual(statuses[0].usable, false)
        XCTAssertEqual(statuses[0].reasons, ["out_of_frame"])
        XCTAssertNil(statuses[1].usable)
    }

    func testAlsoAcceptsAWrappedStepsObject() async throws {
        let body = #"{"steps":[{"stepId":"a","status":"failed","usable":false,"reasons":[]}]}"#
        let client = StepStatusClient(session: StubURLProtocol.session(status: 200, body: Data(body.utf8)))
        let statuses = try await client.fetch(credentials: SessionCredentials(sessionId: "s1", token: "tok"))
        XCTAssertEqual(statuses.map(\.status), [.failed])
    }
}
