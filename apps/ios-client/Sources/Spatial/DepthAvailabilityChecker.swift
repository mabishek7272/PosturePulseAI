import ARKit

/// Checks depth capability only - does NOT compute anything from depth data.
/// Depth-based scale validation (`calibrated_depth` in
/// scale-calibration-record.schema.json's method enum) is explicitly
/// deferred (docs/adr/008-scale-calibration-scope.md); only
/// `subject_specific` calibration is implemented server-side this phase.
/// This type exists so the app can detect the capability and fall back
/// honestly to 2D/subject-specific mode, not to claim a depth-based
/// measurement it doesn't make.
struct DepthAvailabilityChecker {
    static var isSceneDepthAvailable: Bool {
        ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }
}
