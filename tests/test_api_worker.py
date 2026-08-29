"""Worker tests using a fake pipeline runner. No network, no API cost."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from api.store import FAILED, READY, RUNNING, Store  # noqa: E402
from api.worker import process_job, run_forever  # noqa: E402


class WorkerTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.output_root = root / "output"
        self.output_root.mkdir()
        self.store = Store(state_root=root / "state", output_root=self.output_root)

    def tearDown(self):
        self._tmp.cleanup()

    def make_media(self, slug, images=5, videos=5):
        images_dir = self.output_root / slug / "images"
        videos_dir = self.output_root / slug / "videos"
        images_dir.mkdir(parents=True, exist_ok=True)
        videos_dir.mkdir(parents=True, exist_ok=True)
        for index in range(images):
            (images_dir / f"0{index + 1}-event.jpeg").write_bytes(b"jpeg")
        for index in range(videos):
            (videos_dir / f"0{index + 1}-event-10s.mp4").write_bytes(b"mp4")

    def successful_runner(self, stages_seen, slug="portugal"):
        def runner(name, limit=None, with_videos=False, on_stage=None, **kwargs):
            for stage in ("facts", "prompts", "images", "videos"):
                if on_stage:
                    on_stage(stage)
                stages_seen.append(stage)
            self.make_media(slug)
        return runner


class SuccessTests(WorkerTestCase):
    def test_reports_every_stage_and_marks_ready(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        claimed = self.store.claim_next_job()
        stages = []

        outcome = process_job(claimed, self.store, runner=self.successful_runner(stages))

        self.assertEqual(outcome, READY)
        self.assertEqual(stages, ["facts", "prompts", "images", "videos"])
        finished = self.store.read_job(job["id"])
        self.assertEqual(finished["status"], READY)
        self.assertEqual(finished["stage"], "videos")
        self.assertIsNone(finished["error"])
        self.assertEqual(self.store.get_country("PRT")["status"], READY)

    def test_passes_five_events_and_enables_video(self):
        """The API's contract is 5 events with video; a silent drift here is expensive."""
        self.store.request_generation("PRT", "Portugal")
        claimed = self.store.claim_next_job()
        captured = {}

        def runner(name, limit=None, with_videos=False, on_stage=None, **kwargs):
            captured.update({"name": name, "limit": limit, "with_videos": with_videos})
            self.make_media("portugal")

        process_job(claimed, self.store, runner=runner)
        self.assertEqual(captured, {"name": "Portugal", "limit": 5, "with_videos": True})


class FailureTests(WorkerTestCase):
    def test_records_a_pipeline_failure(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        claimed = self.store.claim_next_job()

        def runner(name, **kwargs):
            raise RuntimeError("stage3_images.py exited with code 1")

        outcome = process_job(claimed, self.store, runner=runner)

        self.assertEqual(outcome, FAILED)
        failed = self.store.read_job(job["id"])
        self.assertEqual(failed["status"], FAILED)
        self.assertIn("stage3_images.py exited with code 1", failed["error"])
        self.assertEqual(self.store.get_country("PRT")["status"], FAILED)

    def test_fails_when_the_pipeline_produced_nothing(self):
        """A stage can exit 0 having generated nothing; that is not 'ready'."""
        job, _ = self.store.request_generation("PRT", "Portugal")
        claimed = self.store.claim_next_job()

        process_job(claimed, self.store, runner=lambda name, **kwargs: None)

        failed = self.store.read_job(job["id"])
        self.assertEqual(failed["status"], FAILED)
        self.assertIn("no images or videos", failed["error"])

    def test_partial_output_is_not_ready(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        claimed = self.store.claim_next_job()

        def runner(name, **kwargs):
            self.make_media("portugal", images=5, videos=0)

        process_job(claimed, self.store, runner=runner)
        self.assertEqual(self.store.read_job(job["id"])["status"], FAILED)

    def test_a_failure_does_not_stop_later_jobs(self):
        first, _ = self.store.request_generation("PRT", "Portugal")
        second, _ = self.store.request_generation("ITA", "Italy")

        def runner(name, limit=None, with_videos=False, on_stage=None, **kwargs):
            if name == "Portugal":
                raise RuntimeError("boom")
            self.make_media("italy")

        processed = run_forever(self.store, runner=runner, max_jobs=2)

        self.assertEqual(processed, 2)
        self.assertEqual(self.store.read_job(first["id"])["status"], FAILED)
        self.assertEqual(self.store.read_job(second["id"])["status"], READY)


class LoopTests(WorkerTestCase):
    def test_fails_interrupted_jobs_on_start(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()  # leaves it RUNNING, as a killed worker would
        self.assertEqual(self.store.read_job(job["id"])["status"], RUNNING)

        run_forever(self.store, runner=lambda name, **kwargs: None, max_jobs=0)

        recovered = self.store.read_job(job["id"])
        self.assertEqual(recovered["status"], FAILED)
        self.assertIn("Interrupted", recovered["error"])

    def test_processes_jobs_in_order(self):
        self.store.request_generation("PRT", "Portugal")
        self.store.request_generation("ITA", "Italy")
        order = []

        def runner(name, limit=None, with_videos=False, on_stage=None, **kwargs):
            order.append(name)
            self.make_media("portugal" if name == "Portugal" else "italy")

        run_forever(self.store, runner=runner, max_jobs=2)
        self.assertEqual(order, ["Portugal", "Italy"])

    def test_empty_queue_returns_immediately(self):
        self.assertEqual(run_forever(self.store, runner=lambda **kwargs: None, max_jobs=3), 0)


if __name__ == "__main__":
    unittest.main()
