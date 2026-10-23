import Foundation

/// One clip waiting to be uploaded, persisted next to its files.
struct PendingClipUpload: Codable, Equatable {
    let uploadId: String
    let sessionId: String
    let stepId: String
    /// Session-scoped subject token (ADR-012, 4 h). Kept with the clip so an
    /// upload interrupted by a relaunch can still be sent while it is valid.
    let token: String
    let createdAt: Date
    var attempts: Int
}

enum ClipUploadResult: Equatable {
    case uploaded(ClipUploadResponse)
    /// Network or server trouble; the clip stays queued.
    case willRetry
    /// The server refused it (e.g. 409 while the session is paused, 401 for an
    /// expired token). The local clip is deleted - it is never kept around.
    case rejected(status: Int)
    case notFound
}

/// Persisted upload queue (ADR-013). Each clip lives in its own folder under
/// Application Support with complete file protection and no backup, and is
/// deleted as soon as the server accepts it (2xx) or refuses it.
actor ClipUploadQueue {
    private let directory: URL
    private let uploader: ClipUploading
    private let fileManager = FileManager.default

    init(directory: URL, uploader: ClipUploading) {
        self.directory = directory
        self.uploader = uploader
    }

    static func defaultDirectory() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("ClipUploads", isDirectory: true)
    }

    private func folder(_ uploadId: String) -> URL { directory.appendingPathComponent(uploadId, isDirectory: true) }
    private func clipURL(_ uploadId: String) -> URL { folder(uploadId).appendingPathComponent("clip.mov") }
    private func sidecarURL(_ uploadId: String) -> URL { folder(uploadId).appendingPathComponent("sidecar.json") }
    private func metaURL(_ uploadId: String) -> URL { folder(uploadId).appendingPathComponent("upload.json") }

    private static let protection: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.complete]

    private func ensureDirectory() throws {
        guard !fileManager.fileExists(atPath: directory.path) else { return }
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: Self.protection)
        var url = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// Moves the recorded clip into the queue together with its sidecar.
    @discardableResult
    func enqueue(clipFile: URL, sidecar: ClipCapture, token: String) throws -> PendingClipUpload {
        try ensureDirectory()
        let item = PendingClipUpload(
            uploadId: UUID().uuidString.lowercased(),
            sessionId: sidecar.sessionId,
            stepId: sidecar.stepId,
            token: token,
            createdAt: Date(),
            attempts: 0
        )
        try fileManager.createDirectory(at: folder(item.uploadId), withIntermediateDirectories: false, attributes: Self.protection)
        do {
            try fileManager.moveItem(at: clipFile, to: clipURL(item.uploadId))
            try? fileManager.setAttributes(Self.protection, ofItemAtPath: clipURL(item.uploadId).path)
            try ClipCapture.encoder.encode(sidecar).write(to: sidecarURL(item.uploadId), options: [.atomic, .completeFileProtection])
            try save(item)
        } catch {
            try? fileManager.removeItem(at: folder(item.uploadId))
            throw error
        }
        return item
    }

    private func save(_ item: PendingClipUpload) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(item).write(to: metaURL(item.uploadId), options: [.atomic, .completeFileProtection])
    }

    private func load(_ uploadId: String) -> PendingClipUpload? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: metaURL(uploadId)) else { return nil }
        return try? decoder.decode(PendingClipUpload.self, from: data)
    }

    func pending() -> [PendingClipUpload] {
        let ids = (try? fileManager.contentsOfDirectory(atPath: directory.path)) ?? []
        return ids.compactMap(load).sorted { $0.createdAt < $1.createdAt }
    }

    func send(_ uploadId: String) async -> ClipUploadResult {
        guard var item = load(uploadId), let sidecar = try? Data(contentsOf: sidecarURL(uploadId)) else { return .notFound }
        do {
            let response = try await uploader.upload(.init(
                sessionId: item.sessionId, stepId: item.stepId, token: item.token,
                clipFile: clipURL(uploadId), sidecarJSON: sidecar
            ))
            remove(uploadId)
            return .uploaded(response)
        } catch let error as HTTPStatusError where !Self.isTransient(status: error.status) {
            remove(uploadId)
            return .rejected(status: error.status)
        } catch {
            item.attempts += 1
            try? save(item)
            return .willRetry
        }
    }

    /// Tries every queued clip once, oldest first.
    func drain() async -> [String: ClipUploadResult] {
        var results: [String: ClipUploadResult] = [:]
        for item in pending() {
            results[item.uploadId] = await send(item.uploadId)
        }
        return results
    }

    /// Deletes every queued clip of a session without sending it.
    func discard(sessionId: String) {
        for item in pending() where item.sessionId == sessionId { remove(item.uploadId) }
    }

    private func remove(_ uploadId: String) {
        try? fileManager.removeItem(at: folder(uploadId))
    }

    static func isTransient(status: Int) -> Bool {
        status == 408 || status == 429 || status >= 500 || status < 0
    }
}
