"""Release failures must stop before a build or publication starts."""

import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "release_source", ROOT / "build/verify-release-source.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

SOURCE, MAIN, ANNOTATION = "1" * 40, "2" * 40, "3" * 40
REPO = "example/geosuite"


def evidence():
    checks = []
    data = {
        "/git/ref/tags/v3.1.1": {"object": {"type": "commit", "sha": SOURCE}},
        "/git/ref/heads/main": {"object": {"type": "commit", "sha": MAIN}},
        f"/compare/{SOURCE}...{MAIN}": {
            "status": "ahead",
            "merge_base_commit": {"sha": SOURCE},
        },
    }
    for index, (name, workflow) in enumerate(release.REQUIRED.items(), start=1):
        checks.append(
            {
                "id": index,
                "name": name,
                "head_sha": SOURCE,
                "status": "completed",
                "conclusion": "success",
                "app": {"slug": "github-actions"},
                "details_url": f"https://github.com/{REPO}/actions/runs/{index}/job/10",
            }
        )
        data[f"/actions/runs/{index}"] = {
            "path": workflow,
            "head_sha": SOURCE,
            "event": "push",
            "status": "completed",
            "conclusion": "success",
            "head_repository": {"full_name": REPO},
        }
    data[f"/commits/{SOURCE}/check-runs?per_page=100&page=1"] = {
        "total_count": len(checks),
        "check_runs": checks,
    }
    return data


class ReleaseSource(unittest.TestCase):
    def verify(self, data):
        return release.verify(REPO, "v3.1.1", SOURCE, "3.1.1", data.__getitem__)

    def test_exact_tag_on_main_with_completed_trusted_ci(self):
        result = self.verify(evidence())
        self.assertEqual(result["source_commit"], SOURCE)
        self.assertEqual(
            {row["name"] for row in result["checks"]}, set(release.REQUIRED)
        )

    def test_annotated_tag_and_identical_main(self):
        data = evidence()
        data["/git/ref/tags/v3.1.1"]["object"] = {"type": "tag", "sha": ANNOTATION}
        data["/git/tags/" + ANNOTATION] = {"object": {"type": "commit", "sha": SOURCE}}
        data["/git/ref/heads/main"]["object"]["sha"] = SOURCE
        data[f"/compare/{SOURCE}...{SOURCE}"] = {
            "status": "identical",
            "merge_base_commit": {"sha": SOURCE},
        }
        self.assertEqual(self.verify(data)["reviewed_main"], SOURCE)

    def test_tag_version_mismatch_is_rejected_before_network(self):
        with self.assertRaisesRegex(ValueError, "package version"):
            release.verify(
                REPO, "v3.1.0", SOURCE, "3.1.1", lambda _: self.fail("network")
            )

    def test_tag_for_another_source_is_rejected(self):
        data = evidence()
        data["/git/ref/tags/v3.1.1"]["object"]["sha"] = MAIN
        with self.assertRaisesRegex(ValueError, "immutable release tag"):
            self.verify(data)

    def test_unreviewed_source_is_rejected(self):
        for change in [
            {"status": "behind", "merge_base_commit": {"sha": SOURCE}},
            {"status": "ahead", "merge_base_commit": {"sha": MAIN}},
        ]:
            with self.subTest(change=change):
                data = evidence()
                data[f"/compare/{SOURCE}...{MAIN}"] = change
                with self.assertRaisesRegex(ValueError, "reviewed main"):
                    self.verify(data)

    def test_missing_or_nonpassing_required_check_is_rejected(self):
        key = f"/commits/{SOURCE}/check-runs?per_page=100&page=1"
        for status, conclusion in [
            ("completed", "failure"),
            ("completed", "cancelled"),
            ("completed", "skipped"),
            ("in_progress", None),
        ]:
            with self.subTest(status=status, conclusion=conclusion):
                data = evidence()
                data[key]["check_runs"][0].update(status=status, conclusion=conclusion)
                with self.assertRaisesRegex(ValueError, "not successful"):
                    self.verify(data)
        data = evidence()
        data[key]["check_runs"].pop(0)
        data[key]["total_count"] -= 1
        with self.assertRaisesRegex(ValueError, "Missing required CI"):
            self.verify(data)

    def test_older_success_cannot_hide_a_failed_latest_rerun(self):
        data = evidence()
        key = f"/commits/{SOURCE}/check-runs?per_page=100&page=1"
        later = copy.deepcopy(data[key]["check_runs"][0])
        later.update(id=100, conclusion="failure")
        data[key]["check_runs"].insert(0, later)
        data[key]["total_count"] += 1
        with self.assertRaisesRegex(ValueError, "not successful"):
            self.verify(data)

    def test_forged_provider_or_workflow_is_rejected(self):
        key = f"/commits/{SOURCE}/check-runs?per_page=100&page=1"
        for change in [
            {"app": {"slug": "unrelated-app"}},
            {"head_sha": MAIN},
            {"details_url": "https://example.invalid/actions/runs/1/job/10"},
        ]:
            with self.subTest(change=change):
                data = evidence()
                data[key]["check_runs"][0].update(change)
                with self.assertRaises(ValueError):
                    self.verify(data)
        for change in [
            {"path": ".github/workflows/different.yml"},
            {"head_sha": MAIN},
            {"event": "pull_request"},
            {"head_repository": {"full_name": "unreviewed/fork"}},
            {"status": "in_progress", "conclusion": None},
        ]:
            with self.subTest(change=change):
                data = evidence()
                data["/actions/runs/1"].update(change)
                with self.assertRaisesRegex(
                    ValueError, "different/unreviewed workflow"
                ):
                    self.verify(data)

    def test_pagination_cannot_hide_pending_required_checks(self):
        data = evidence()
        key = f"/commits/{SOURCE}/check-runs?per_page=100&page=1"
        remaining = data[key]["check_runs"][1:]
        data[key]["check_runs"] = data[key]["check_runs"][:1]
        data[f"/commits/{SOURCE}/check-runs?per_page=100&page=2"] = {
            "total_count": 3,
            "check_runs": remaining,
        }
        remaining[0].update(status="in_progress", conclusion=None)
        with self.assertRaisesRegex(ValueError, "not successful"):
            self.verify(data)
        remaining[0].update(status="completed", conclusion="success")
        self.assertEqual(len(self.verify(data)["checks"]), 3)


if __name__ == "__main__":
    unittest.main()
