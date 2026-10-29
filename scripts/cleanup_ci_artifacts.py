#!/usr/bin/env python3
"""Preview/prune obsolete ephemeral CI handoffs; release/unknown names fail closed."""

import argparse
import datetime as dt
import json
import os
import re
import subprocess

NAMES = {
    "reviewed-landing-runtime",
    "reviewed-tutorial-pages",
    "public-journey-browser-results",
    "production-cloud-transport-check",
    "cloud-staging-transport-check",
}
BUNDLES = re.compile(
    r"^(public-static-(?:brand|geosuite-landing|geosuite-tutorials|geosuite-guides))-[0-9a-f]{40}$"
)


def group(name):
    if name in NAMES:
        return name
    match = BUNDLES.fullmatch(name)
    return match[1] if match else None


def plan(artifacts, runs, protected_shas, now, current_run=None):
    latest = {}
    for artifact in artifacts:
        key = group(artifact["name"])
        run = runs.get(artifact["workflow_run"]["id"], {})
        if (
            key
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
        ):
            scope = key
            if (
                scope not in latest
                or artifact["created_at"] > latest[scope]["created_at"]
            ):
                latest[scope] = artifact
    result = []
    for artifact in artifacts:
        key = group(artifact["name"])
        source = artifact["workflow_run"]
        run = runs.get(source["id"], {})
        age = (
            now
            - dt.datetime.fromisoformat(artifact["created_at"].replace("Z", "+00:00"))
        ).total_seconds()
        reason = "eligible obsolete ephemeral handoff"
        if not key:
            reason = "protected release/backup/unknown name"
        elif source["id"] == current_run or run.get("status") != "completed":
            reason = "protected active or unknown run"
        elif source.get("head_branch", "").startswith(("v", "release/")):
            reason = "protected release branch"
        elif source.get("head_sha") in protected_shas:
            reason = "protected open PR head/merge source"
        elif latest.get(key, {}).get("id") == artifact["id"]:
            reason = "protected latest successful handoff for type"
        elif age < 3 * 86400:
            reason = "protected minimum three-day review window"
        result.append(
            {
                "id": artifact["id"],
                "name": artifact["name"],
                "bytes": artifact["size_in_bytes"],
                "delete": reason.startswith("eligible"),
                "reason": reason,
            }
        )
    return result


def api(endpoint, *, pages=False, delete=False):
    args = ["gh", "api"]
    if pages:
        args += ["--paginate"]
    if delete:
        args += ["--method", "DELETE"]
    output = subprocess.check_output(args + [endpoint], text=True)
    if not pages:
        return json.loads(output) if output.strip() else None
    result = []
    decoder = json.JSONDecoder()
    remaining = output.strip()
    while remaining:
        page, end = decoder.raw_decode(remaining)
        result.append(page)
        remaining = remaining[end:].lstrip()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=os.environ.get("GITHUB_REPOSITORY"),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete only eligible ephemeral artifacts; default is dry-run",
    )
    args = parser.parse_args()
    if not args.repo or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("An explicit owner/repository or GITHUB_REPOSITORY is required")
    prefix = "repos/" + args.repo
    artifacts = [
        a
        for page in api(prefix + "/actions/artifacts?per_page=100", pages=True)
        for a in page["artifacts"]
    ]
    pulls = [
        p
        for page in api(prefix + "/pulls?state=open&per_page=100", pages=True)
        for p in page
    ]
    protected = {
        sha
        for p in pulls
        for sha in [p["head"]["sha"], p.get("merge_commit_sha")]
        if sha
    }
    runs = {
        i: api(prefix + "/actions/runs/" + str(i))
        for i in {a["workflow_run"]["id"] for a in artifacts if group(a["name"])}
    }
    current = (
        int(os.environ["GITHUB_RUN_ID"]) if os.environ.get("GITHUB_RUN_ID") else None
    )
    actions = plan(
        artifacts, runs, protected, dt.datetime.now(dt.timezone.utc), current
    )
    deleted = 0
    for item in actions:
        if args.apply and item["delete"]:
            # Re-read identity and run status immediately before deletion.
            latest = api(prefix + "/actions/artifacts/" + str(item["id"]))
            if (
                latest["name"] != item["name"]
                or latest["size_in_bytes"] != item["bytes"]
            ):
                raise RuntimeError("Artifact identity changed; deletion refused")
            run = api(prefix + "/actions/runs/" + str(latest["workflow_run"]["id"]))
            if run["status"] != "completed":
                raise RuntimeError("Run is active; deletion refused")
            current_pulls = [
                p
                for page in api(prefix + "/pulls?state=open&per_page=100", pages=True)
                for p in page
            ]
            live_sources = {
                sha
                for p in current_pulls
                for sha in [p["head"]["sha"], p.get("merge_commit_sha")]
                if sha
            }
            if latest["workflow_run"].get("head_sha") in live_sources:
                item["delete"] = False
                item["reason"] = "protected PR opened or updated during cleanup"
                continue
            api(prefix + "/actions/artifacts/" + str(item["id"]), delete=True)
            deleted += item["bytes"]
            print(
                json.dumps({"deleted_artifact": item["id"], "bytes": item["bytes"]}),
                flush=True,
            )
    print(
        json.dumps(
            {
                "repository": args.repo,
                "mode": "apply" if args.apply else "dry-run",
                "deleted_bytes": deleted,
                "artifacts": actions,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
