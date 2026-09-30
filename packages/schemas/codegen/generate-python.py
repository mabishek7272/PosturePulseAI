#!/usr/bin/env python3
"""Generates Pydantic v2 models from packages/schemas/src/*.schema.json.

DO NOT EDIT the output by hand - run `npm run schemas:generate` to regenerate.

Cross-file $refs are resolved first (via the Node bundler in bundle.mjs), because
datamodel-code-generator does not reliably follow relative $ref across sibling
files. The bundled, self-contained schema documents are written to a temporary
directory and then fed to datamodel-code-generator one at a time so each record
gets its own module (mirroring the generated TypeScript layout).
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMAS_ROOT = HERE.parent
DEFAULT_OUT_DIR = SCHEMAS_ROOT / "generated" / "python" / "beaive_schemas"
# Optional CLI override (used by check.mjs to render into a scratch dir without
# disturbing the committed output).
OUT_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUT_DIR


def to_pascal_case(kebab: str) -> str:
    return "".join(part.capitalize() for part in kebab.split("-"))


def run_datamodel_codegen(schema_path: Path, class_name: str, out_path: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(schema_path),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(out_path),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--class-name",
            class_name,
            "--disable-timestamp",
            "--use-schema-description",
        ],
        check=True,
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        subprocess.run(
            ["node", str(HERE / "write-bundle.mjs"), str(tmp_dir)],
            check=True,
        )

        if OUT_DIR.exists():
            shutil.rmtree(OUT_DIR)
        OUT_DIR.mkdir(parents=True, exist_ok=True)

        module_names = []
        for schema_file in sorted(tmp_dir.glob("*.schema.json")):
            name = schema_file.stem.replace(".schema", "")
            module_name = name.replace("-", "_")
            class_name = to_pascal_case(name)
            out_path = OUT_DIR / f"{module_name}.py"
            run_datamodel_codegen(schema_file, class_name, out_path)
            module_names.append(module_name)

        init_lines = [
            "# DO NOT EDIT BY HAND. Run `npm run schemas:generate` to regenerate.",
        ]
        for module_name in module_names:
            class_name = to_pascal_case(module_name.replace("_", "-"))
            init_lines.append(f"from .{module_name} import {class_name}")
        (OUT_DIR / "__init__.py").write_text("\n".join(init_lines) + "\n")

        pyproject = SCHEMAS_ROOT / "generated" / "python" / "pyproject.toml"
        if not pyproject.exists():
            pyproject.write_text(
                '[project]\n'
                'name = "beaive-schemas"\n'
                'version = "0.0.0"\n'
                'description = "Generated Pydantic bindings for beAIve canonical records - DO NOT EDIT BY HAND."\n'
                'requires-python = ">=3.11"\n'
                'dependencies = ["pydantic>=2.0"]\n\n'
                "[build-system]\n"
                'requires = ["setuptools>=68"]\n'
                'build-backend = "setuptools.build_meta"\n\n'
                "[tool.setuptools.packages.find]\n"
                'where = ["."]\n'
            )

        print(f"Generated {len(module_names)} Python modules into {OUT_DIR}")


if __name__ == "__main__":
    main()
