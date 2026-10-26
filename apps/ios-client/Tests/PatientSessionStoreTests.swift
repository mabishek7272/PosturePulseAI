import XCTest
@testable import PostureAnalysisClient

private final class InMemorySecretStore: SecretStore {
    var values: [String: String] = [:]
    func read(_ key: String) -> String? { values[key] }
    func write(_ key: String, value: String) -> Bool { values[key] = value; return true }
    func delete(_ key: String) { values[key] = nil }
}

final class PatientSessionStoreTests: XCTestCase {
    func testStartsWithNoToken() {
        let store = PatientSessionStore(store: InMemorySecretStore())
        XCTAssertNil(store.token)
    }

    func testSaveThenTokenReturnsTheSavedValue() {
        let store = PatientSessionStore(store: InMemorySecretStore())
        store.save(token: "jwt-123")
        XCTAssertEqual(store.token, "jwt-123")
    }

    func testClearThenTokenReturnsNil() {
        let store = PatientSessionStore(store: InMemorySecretStore())
        store.save(token: "jwt-123")
        store.clear()
        XCTAssertNil(store.token)
    }
}
