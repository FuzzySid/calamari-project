"""Tests for the file-backed job store. No network, no pipeline."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from api.store import (  # noqa: E402
    FAILED,
    QUEUED,
    READY,
    RUNNING,
    FileLock,
    LockTimeout,
    Store,
    normalize_code,
)


class NormalizeCodeTests(unittest.TestCase):
    def test_uppercases_valid_codes(self):
        self.assertEqual(normalize_code("prt"), "PRT")
        self.assertEqual(normalize_code(" esp "), "ESP")

    def test_rejects_natural_earth_placeholder(self):
        """Natural Earth writes -99 for France, Norway, Kosovo and others."""
        self.assertIsNone(normalize_code("-99"))

    def test_rejects_wrong_shape(self):
        for value in ("", "ES", "SPAIN", "E1P", None, 123):
            self.assertIsNone(normalize_code(value), value)


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.output_root = root / "output"
        self.output_root.mkdir()
        self.store = Store(state_root=root / "state", output_root=self.output_root)

    def tearDown(self):
        self._tmp.cleanup()

    def make_media(self, slug, images=1, videos=1):
        images_dir = self.output_root / slug / "images"
        videos_dir = self.output_root / slug / "videos"
        images_dir.mkdir(parents=True, exist_ok=True)
        videos_dir.mkdir(parents=True, exist_ok=True)
        for index in range(images):
            (images_dir / f"0{index + 1}-event.jpeg").write_bytes(b"jpeg")
        for index in range(videos):
            (videos_dir / f"0{index + 1}-event-10s.mp4").write_bytes(b"mp4")


class RequestGenerationTests(StoreTestCase):
    def test_creates_one_job(self):
        job, created = self.store.request_generation("PRT", "Portugal")
        self.assertTrue(created)
        self.assertEqual(job["status"], QUEUED)
        self.assertEqual(job["slug"], "portugal")

    def test_second_request_reuses_the_queued_job(self):
        """Two clicks must not start two paid runs."""
        first, created_first = self.store.request_generation("PRT", "Portugal")
        second, created_second = self.store.request_generation("PRT", "Portugal")
        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.store.list_jobs()), 1)

    def test_request_while_running_reuses_the_job(self):
        first, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()
        second, created = self.store.request_generation("PRT", "Portugal")
        self.assertFalse(created)
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["status"], RUNNING)

    def test_ready_country_with_media_is_not_regenerated(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()
        self.make_media("portugal")
        self.store.finish_job(job["id"], READY)

        again, created = self.store.request_generation("PRT", "Portugal")
        self.assertFalse(created)
        self.assertEqual(again["status"], READY)
        self.assertEqual(len(self.store.list_jobs()), 1)

    def test_failed_job_allows_a_retry(self):
        first, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()
        self.store.finish_job(first["id"], FAILED, error="boom")

        retry, created = self.store.request_generation("PRT", "Portugal")
        self.assertTrue(created)
        self.assertNotEqual(retry["id"], first["id"])
        self.assertEqual(retry["status"], QUEUED)

    def test_rejects_invalid_code_and_empty_name(self):
        with self.assertRaises(ValueError):
            self.store.request_generation("-99", "France")
        with self.assertRaises(ValueError):
            self.store.request_generation("PRT", "   ")

    def test_different_countries_get_separate_jobs(self):
        self.store.request_generation("PRT", "Portugal")
        self.store.request_generation("ITA", "Italy")
        self.assertEqual(len(self.store.list_jobs()), 2)


class JobTransitionTests(StoreTestCase):
    def test_claim_marks_running_and_is_fifo(self):
        first, _ = self.store.request_generation("PRT", "Portugal")
        second, _ = self.store.request_generation("ITA", "Italy")

        claimed = self.store.claim_next_job()
        self.assertEqual(claimed["id"], first["id"])
        self.assertEqual(claimed["status"], RUNNING)
        self.assertIsNotNone(claimed["started_at"])

        self.assertEqual(self.store.claim_next_job()["id"], second["id"])
        self.assertIsNone(self.store.claim_next_job())

    def test_set_stage_records_a_human_message(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        updated = self.store.set_stage(job["id"], "images")
        self.assertEqual(updated["stage"], "images")
        self.assertEqual(updated["message"], "Painting the scenes")

    def test_finish_job_updates_country_status(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()
        self.store.finish_job(job["id"], READY)
        self.assertEqual(self.store.get_country("PRT")["status"], READY)

    def test_finish_job_records_the_error(self):
        job, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()
        finished = self.store.finish_job(job["id"], FAILED, error="stage 3 exited 1")
        self.assertEqual(finished["status"], FAILED)
        self.assertEqual(finished["error"], "stage 3 exited 1")

    def test_interrupted_running_job_is_failed_on_restart(self):
        """A killed worker must not leave a job running forever, blocking retries."""
        job, _ = self.store.request_generation("PRT", "Portugal")
        self.store.claim_next_job()

        failed_ids = self.store.fail_interrupted_jobs()
        self.assertEqual(failed_ids, [job["id"]])
        self.assertEqual(self.store.read_job(job["id"])["status"], FAILED)

        retry, created = self.store.request_generation("PRT", "Portugal")
        self.assertTrue(created)
        self.assertNotEqual(retry["id"], job["id"])

    def test_unknown_job_ids_are_handled(self):
        self.assertIsNone(self.store.read_job("nope"))
        self.assertIsNone(self.store.set_stage("nope", "facts"))
        self.assertIsNone(self.store.finish_job("nope", READY))


class SeedingTests(StoreTestCase):
    def test_seeds_a_country_generated_outside_the_api(self):
        """Spain was generated from the CLI; it must be found, not regenerated."""
        self.make_media("spain", images=5, videos=5)
        seeded = self.store.seed_from_disk(known_names=["Spain"])
        self.assertTrue(seeded)

        entry = next(c for c in self.store.list_countries() if c["slug"] == "spain")
        self.assertEqual(entry["status"], READY)
        self.assertEqual(entry["name"], "Spain")

    def test_does_not_seed_a_partial_country(self):
        self.make_media("italy", images=3, videos=0)
        self.store.seed_from_disk(known_names=["Italy"])
        self.assertEqual(self.store.list_countries(), [])

    def test_register_known_country_attaches_the_iso_code(self):
        self.make_media("spain", images=5, videos=5)
        self.store.seed_from_disk(known_names=["Spain"])
        entry = self.store.register_known_country("ESP", "Spain")
        self.assertEqual(entry["code"], "ESP")
        self.assertEqual(self.store.get_country("ESP")["status"], READY)

    def test_seeded_country_is_not_regenerated(self):
        self.make_media("spain", images=5, videos=5)
        self.store.seed_from_disk(known_names=["Spain"])
        self.store.register_known_country("ESP", "Spain")

        job, created = self.store.request_generation("ESP", "Spain")
        self.assertFalse(created)
        self.assertEqual(job["status"], READY)
        self.assertEqual(self.store.list_jobs(), [])


class MediaStateTests(StoreTestCase):
    def test_reports_images_before_videos(self):
        self.make_media("portugal", images=5, videos=0)
        self.assertEqual(self.store.media_state("Portugal"), (True, False))

    def test_reports_both_when_complete(self):
        self.make_media("portugal", images=5, videos=5)
        self.assertEqual(self.store.media_state("Portugal"), (True, True))

    def test_reports_nothing_for_an_unknown_country(self):
        self.assertEqual(self.store.media_state("Atlantis"), (False, False))


class FileLockTests(StoreTestCase):
    def test_is_exclusive_while_held(self):
        path = Path(self._tmp.name) / "state" / ".testlock"
        with FileLock(path):
            with self.assertRaises(LockTimeout):
                with FileLock(path, timeout=0.2):
                    pass

    def test_releases_on_exit(self):
        path = Path(self._tmp.name) / "state" / ".testlock"
        with FileLock(path):
            pass
        with FileLock(path, timeout=0.2):
            pass
        self.assertFalse(path.exists())

    def test_releases_when_the_body_raises(self):
        path = Path(self._tmp.name) / "state" / ".testlock"
        with self.assertRaises(RuntimeError):
            with FileLock(path):
                raise RuntimeError("boom")
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
