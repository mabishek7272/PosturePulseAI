import XCTest
@testable import PostureAnalysisClient

private final class InMemorySecretStore: SecretStore {
    var values: [String: String] = [:]
    func read(_ key: String) -> String? { values[key] }
    func write(_ key: String, value: String) -> Bool { values[key] = value; return true }
    func delete(_ key: String) { values[key] = nil }
}

final class SubjectIdentityStoreTests: XCTestCase {
    func testPseudoIdIsARandomUUIDAndStable() {
        let backing = InMemorySecretStore()
        let store = SubjectIdentityStore(store: backing)
        let first = store.subjectPseudoId()
        XCTAssertNotNil(UUID(uuidString: first))
        XCTAssertEqual(store.subjectPseudoId(), first)
        XCTAssertEqual(SubjectIdentityStore(store: backing).subjectPseudoId(), first)
    }

    func testConsentRecordIdRoundTripsAndClears() {
        let store = SubjectIdentityStore(store: InMemorySecretStore())
        XCTAssertNil(store.consentRecordId)
        store.saveConsentRecordId("c1")
        XCTAssertEqual(store.consentRecordId, "c1")
        store.clearConsentRecordId()
        XCTAssertNil(store.consentRecordId)
    }

    func testRequiredScopeIsOnlyDerivedEvents() {
        XCTAssertEqual(ConsentScope.allCases.filter(\.isRequired), [.derivedEvents])
        XCTAssertEqual(
            Set(ConsentScope.allCases.map(\.rawValue)),
            ["derived_events", "raw_video", "research_data_export", "wearable_integration"]
        )
    }
}
