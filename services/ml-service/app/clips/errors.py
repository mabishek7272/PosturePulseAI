class ClipDecodeError(Exception):
    """The clip could not be decoded (corrupt, unsupported codec, wrong size).
    The analyzer reports this as `unsupported`, never as a server error."""


class PoseModelUnavailableError(Exception):
    """The pose model file is missing - a deployment problem, not bad content."""
