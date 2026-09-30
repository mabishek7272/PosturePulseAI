import sys
from pathlib import Path

# Allows `import app.*` when running pytest from services/ml-service without an
# editable install being strictly required for tests (an editable install of
# beaive_schemas is still required - see README.md).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
