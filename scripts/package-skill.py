"""Build the local installer ZIP from the checked-in skill and its distribution files."""
import os
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/sec-diagrams"
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

# Keep untracked diagrams and machine-local files out of the archive.
tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "."], cwd=SKILL)
files = {Path(name) for name in tracked.decode().split("\0") if name and os.path.lexists(SKILL / name)}
if not {Path("SKILL.md"), Path("tools/cli.ts"), Path("package-lock.json")} <= files:
    raise SystemExit("The skill files must be tracked in the Git index before packaging.")

with tempfile.TemporaryDirectory(dir=DIST) as tmp:
    archive = Path(tmp) / "sec-diagrams.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
        bundle.write(ROOT / "LICENSE", "sec-diagrams/LICENSE")
        for rel in sorted(files):
            if rel == Path("LICENSE") or rel.parts[0] == "evals":
                continue
            path = SKILL / rel
            if path.is_symlink():
                raise SystemExit(f"Unexpected symlink in bundle: {rel}")
            bundle.write(path, Path("sec-diagrams") / rel)
    archive.replace(DIST / archive.name)
print("dist/sec-diagrams.zip")
