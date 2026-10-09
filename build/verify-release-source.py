"""Reject a release until its exact tagged source has successful trusted CI.

Read-only GitHub requests; no tag, release, checkout or credential mutation.
The Windows workflow calls this before installing/building/publishing assets.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

REQUIRED = {
    "build-and-test": ".github/workflows/ci.yml",
    "build-windows": ".github/workflows/ci.yml",
    "source-boundaries": ".github/workflows/repository-checks.yml",
}


def commit(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Expected an immutable commit SHA")
    return value


def verify(repository, tag, source, version, fetch):
    """Validate actual tag/main/CI identities; fetch receives repository paths."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository identity")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid package version")
    if tag != "v" + version:
        raise ValueError("Tag does not match the package version")
    source = commit(source)
    obj = fetch("/git/ref/tags/" + urllib.parse.quote(tag, safe=""))["object"]
    for _ in range(5):
        if obj["type"] == "commit":
            break
        if obj["type"] != "tag":
            raise ValueError("Release tag does not identify a commit")
        obj = fetch("/git/tags/" + commit(obj["sha"]))["object"]
    if obj["type"] != "commit" or commit(obj["sha"]) != source:
        raise ValueError("Checked-out source differs from the immutable release tag")

    main = commit(fetch("/git/ref/heads/main")["object"]["sha"])
    comparison = fetch("/compare/" + source + "..." + main)
    if (
        comparison["status"] not in {"identical", "ahead"}
        or commit(comparison["merge_base_commit"]["sha"]) != source
    ):
        raise ValueError("Release source is not on reviewed main")

    checks = []
    for page in range(1, 11):
        result = fetch(f"/commits/{source}/check-runs?per_page=100&page={page}")
        checks.extend(result["check_runs"])
        if len(checks) >= result["total_count"]:
            break
        if not result["check_runs"]:
            raise ValueError("Incomplete CI check response")
    else:
        raise ValueError("CI check history exceeds the bounded release review")

    verified = []
    runs = {}
    for name, expected_path in REQUIRED.items():
        candidates = [c for c in checks if c["name"] == name]
        if not candidates:
            raise ValueError("Missing required CI: " + name)
        latest = max(candidates, key=lambda c: c["id"])
        if (
            latest["status"] != "completed"
            or latest["conclusion"] != "success"
            or latest["head_sha"] != source
            or latest.get("app", {}).get("slug") != "github-actions"
        ):
            raise ValueError("Required CI is not successful and trusted: " + name)
        match = re.fullmatch(
            r"https://github\.com/"
            + re.escape(repository)
            + r"/actions/runs/(\d+)/job/\d+",
            latest.get("details_url", ""),
        )
        if not match:
            raise ValueError("Required CI has no matching workflow identity: " + name)
        run_id = match[1]
        if run_id not in runs:
            runs[run_id] = fetch("/actions/runs/" + run_id)
        run = runs[run_id]
        if (
            run["head_sha"] != source
            or run["path"] != expected_path
            or run["event"] not in {"push", "workflow_dispatch"}
            or run["head_repository"]["full_name"] != repository
            or run["status"] != "completed"
            or run["conclusion"] != "success"
        ):
            raise ValueError(
                "Required CI belongs to a different/unreviewed workflow: " + name
            )
        verified.append({"name": name, "check_id": latest["id"], "run_id": run_id})
    return {
        "source_commit": source,
        "tag": tag,
        "reviewed_main": main,
        "checks": verified,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        parser.error("GITHUB_REPOSITORY must identify the release repository")
    base = "https://api.github.com/repos/" + repository

    def fetch(path):
        headers = {"Accept": "application/vnd.github+json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(base + path, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError(
                f"GitHub source verification failed (HTTP {error.code})"
            ) from None

    try:
        source = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip()
        version = json.loads((root / "package.json").read_text())["version"]
        print(
            json.dumps(verify(repository, args.tag, source, version, fetch), indent=2)
        )
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, "Release preflight refused: " + str(error) + "\n")


if __name__ == "__main__":
    main()
