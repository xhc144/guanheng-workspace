"""Behavioral tests for actual parallelism and immutable dispatched contracts."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import validate_plan as plan


class PlanTests(unittest.TestCase):
    def test_pms_phase_can_start_without_main_but_main_requires_upgrade_and_g1(self):
        queue = json.loads((plan.ROOT / "tasks/queue.json").read_text())
        self.assertNotIn("WP-02", plan.ready_after(queue, {"WP-03"}))
        self.assertIn("WP-02:PMS", plan.ready_phases_after(queue, {"WP-03"}))
        self.assertNotIn("WP-02:MAIN", plan.ready_phases_after(queue, {"WP-01", "WP-03"}))
        done = {"WP-01", "WP-03", "WP-23"}
        self.assertNotIn("WP-02:MAIN", plan.ready_phases_after(queue, done))
        self.assertIn("WP-02:MAIN", plan.ready_phases_after(queue, done, runtime_gates={"WP-24:G1-runner"}))
        self.assertNotIn("WP-02:WINDOWS", plan.ready_phases_after(queue, done))
        self.assertIn("WP-02:WINDOWS", plan.ready_phases_after(queue, done, completed_phases={"PMS", "MAIN"}))
        with tempfile.TemporaryDirectory(prefix="guanheng-phase-negative-") as temp:
            root = Path(temp)
            shutil.copytree(plan.ROOT / "tasks", root / "tasks")
            item = next(item for item in queue if item["id"] == "WP-02")
            next(phase for phase in item["phase_gates"] if phase["id"] == "MAIN")["depends_on"] = ["WP-01"]
            (root / "tasks/queue.json").write_text(json.dumps(queue))
            self.assertEqual(self.run_validation(root), 1)

    def test_transitive_order_and_width(self):
        chain = [{"id": "a", "depends_on": []}, {"id": "b", "depends_on": ["a"]}, {"id": "c", "depends_on": ["b"]}]
        self.assertEqual(plan.maximum_antichain_size(chain), 1)
        self.assertIn("c", plan.reachability(chain)["a"])
        diamond = chain[:1] + [{"id": "b", "depends_on": ["a"]}, {"id": "c", "depends_on": ["a"]}, {"id": "d", "depends_on": ["b", "c"]}]
        self.assertEqual(plan.maximum_antichain_size(diamond), 2)
        self.assertEqual(set(plan.ready_after(diamond, {"a"})), {"b", "c"})

    def run_validation(self, root):
        with patch.object(plan, "ROOT", root), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return plan.validate()

    def test_real_plan_and_frozen_dispatch(self):
        with tempfile.TemporaryDirectory(prefix="guanheng-plan-test-") as temp:
            root = Path(temp)
            shutil.copytree(plan.ROOT / "tasks", root / "tasks")
            self.assertEqual(self.run_validation(root), 0)
            task = root / "tasks/WP-03.md"
            task.write_text(task.read_text() + "\nchanged contract\n")
            self.assertEqual(self.run_validation(root), 1)

    def test_rejects_fake_parallel_count(self):
        with tempfile.TemporaryDirectory(prefix="guanheng-plan-test-") as temp:
            root = Path(temp)
            shutil.copytree(plan.ROOT / "tasks", root / "tasks")
            queue_file = root / "tasks/queue.json"
            queue = json.loads(queue_file.read_text())
            for entry in queue:
                if entry["id"] in {"WP-13", "WP-14", "WP-28", "WP-29"}:
                    entry["depends_on"].append("WP-16")
            queue_file.write_text(json.dumps(queue))
            self.assertEqual(self.run_validation(root), 1)

    def test_rejects_duplicate_owner_and_cycle(self):
        with tempfile.TemporaryDirectory(prefix="guanheng-plan-test-") as temp:
            root = Path(temp)
            shutil.copytree(plan.ROOT / "tasks", root / "tasks")
            queue_file = root / "tasks/queue.json"
            original = queue_file.read_text()
            queue = json.loads(original)
            next(x for x in queue if x["id"] == "WP-13")["owns"].append("systems/project-ops/lib/schema.ts")
            queue_file.write_text(json.dumps(queue))
            self.assertEqual(self.run_validation(root), 1)
            queue = json.loads(original)
            next(x for x in queue if x["id"] == "WP-13")["depends_on"].append("WP-13")
            queue_file.write_text(json.dumps(queue))
            self.assertEqual(self.run_validation(root), 1)


if __name__ == "__main__":
    unittest.main()
