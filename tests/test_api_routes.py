"""Route tests against a real file store in a temp directory. No network, no pipeline.

These assert the HTTP responses and the persisted job JSON rather than mock call counts, so
they fail if the store and the API ever disagree about what happened.
"""

import importlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from api.store import READY, Store  # noqa: E402


class RouteTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.output_root = root / "output"
        self.output_root.mkdir()

        # Point the module's module-level store and mount at the temp tree.
        self.app_module = importlib.import_module("api.app")
        self._real_store = self.app_module.store
        self._real_output = self.app_module.OUTPUT_ROOT
        self.store = Store(state_root=root / "state", output_root=self.output_root)
        self.app_module.store = self.store
        self.app_module.OUTPUT_ROOT = self.output_root
        self.client = TestClient(self.app_module.app)

    def tearDown(self):
        self.app_module.store = self._real_store
        self.app_module.OUTPUT_ROOT = self._real_output
        self._tmp.cleanup()

    def make_media(self, slug, images=1, videos=1):
        images_dir = self.output_root / slug / "images"
        videos_dir = self.output_root / slug / "videos"
        images_dir.mkdir(parents=True, exist_ok=True)
        videos_dir.mkdir(parents=True, exist_ok=True)
        for index in range(images):
            (images_dir / f"0{index + 1}-event.jpeg").write_bytes(b"jpeg-bytes")
        for index in range(videos):
            (videos_dir / f"0{index + 1}-event-10s.mp4").write_bytes(b"mp4-bytes")


class HealthTests(RouteTestCase):
    def test_health_reports_ok(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


class GenerateTests(RouteTestCase):
    def test_queues_a_job(self):
        response = self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"})
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertTrue(body["created"])
        self.assertEqual(body["job"]["status"], "queued")
        # The job really exists on disk, not just in the response.
        self.assertIsNotNone(self.store.read_job(body["job"]["id"]))

    def test_repeat_request_does_not_create_a_second_job(self):
        first = self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"}).json()
        second = self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"}).json()
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["job"]["id"], second["job"]["id"])
        self.assertEqual(len(self.store.list_jobs()), 1)

    def test_rejects_natural_earth_placeholder_code(self):
        """-99 must 422, never create a backend/output/-99 directory."""
        response = self.client.post("/api/countries/-99/generate", json={"name": "France"})
        self.assertEqual(response.status_code, 422)
        self.assertFalse((self.output_root / "-99").exists())
        self.assertEqual(self.store.list_jobs(), [])

    def test_rejects_a_malformed_code(self):
        self.assertEqual(
            self.client.post("/api/countries/ES/generate", json={"name": "Spain"}).status_code, 422
        )

    def test_rejects_a_missing_name(self):
        self.assertEqual(
            self.client.post("/api/countries/PRT/generate", json={}).status_code, 422
        )

    def test_lowercase_code_is_accepted(self):
        response = self.client.post("/api/countries/prt/generate", json={"name": "Portugal"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["job"]["code"], "PRT")


class JobRouteTests(RouteTestCase):
    def test_returns_the_job(self):
        created = self.client.post(
            "/api/countries/PRT/generate", json={"name": "Portugal"}
        ).json()["job"]
        response = self.client.get(f"/api/jobs/{created['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], created["id"])

    def test_reflects_stage_progress(self):
        created = self.client.post(
            "/api/countries/PRT/generate", json={"name": "Portugal"}
        ).json()["job"]
        self.store.claim_next_job()
        self.store.set_stage(created["id"], "videos")

        body = self.client.get(f"/api/jobs/{created['id']}").json()
        self.assertEqual(body["status"], "running")
        self.assertEqual(body["stage"], "videos")
        self.assertEqual(body["message"], "Animating the panoramas")

    def test_unknown_job_is_404(self):
        self.assertEqual(self.client.get("/api/jobs/missing").status_code, 404)


class CountriesRouteTests(RouteTestCase):
    def test_lists_nothing_initially(self):
        self.assertEqual(self.client.get("/api/countries").json(), [])

    def test_lists_a_requested_country(self):
        self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"})
        countries = self.client.get("/api/countries").json()
        self.assertEqual(len(countries), 1)
        self.assertEqual(countries[0]["code"], "PRT")
        self.assertEqual(countries[0]["slug"], "portugal")


class MediaRouteTests(RouteTestCase):
    def write_manifests(self, slug, images=1, videos=1):
        from pipeline_common import write_json

        base = self.output_root / slug
        write_json(base / "info.json", {
            "events": [{"id": "event_1", "title": "An Event",
                        "timeline": {"display": "1588"}}]
        })
        if images:
            write_json(base / "images.json", {"images": {"event_1": [
                {"order": 1, "variant": 1,
                 "local_path": str((base / "images" / "01-event.jpeg").resolve())}
            ]}})
        if videos:
            write_json(base / "videos.json", {"videos": {"event_1": [
                {"order": 1, "variant": 1,
                 "local_path": str((base / "videos" / "01-event-10s.mp4").resolve())}
            ]}})

    def test_unknown_country_is_404(self):
        self.assertEqual(self.client.get("/api/countries/PRT/media").status_code, 404)

    def test_invalid_code_is_422(self):
        self.assertEqual(self.client.get("/api/countries/-99/media").status_code, 422)

    def test_reports_images_ready_before_videos_exist(self):
        """The whole point of splitting images and videos: art is servable ~10 min earlier."""
        self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"})
        self.make_media("portugal", images=1, videos=0)
        self.write_manifests("portugal", images=1, videos=0)

        body = self.client.get("/api/countries/PRT/media").json()
        self.assertEqual(body["status"], "images_ready")
        self.assertEqual(len(body["images"]), 1)
        self.assertEqual(body["videos"], [])

    def test_reports_ready_with_both(self):
        self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"})
        self.make_media("portugal", images=1, videos=1)
        self.write_manifests("portugal", images=1, videos=1)

        body = self.client.get("/api/countries/PRT/media").json()
        self.assertEqual(body["status"], "ready")
        self.assertEqual(len(body["videos"]), 1)
        self.assertTrue(body["videos"][0]["url"].startswith("/media/portugal/videos/"))
        self.assertEqual(body["images"][0]["title"], "An Event")
        self.assertEqual(body["images"][0]["timeline"], "1588")

    def test_manifest_rows_without_files_are_omitted(self):
        """A partial stage writes its manifest anyway; never advertise a missing file."""
        self.client.post("/api/countries/PRT/generate", json={"name": "Portugal"})
        self.make_media("portugal", images=0, videos=0)
        self.write_manifests("portugal", images=1, videos=1)

        body = self.client.get("/api/countries/PRT/media").json()
        self.assertEqual(body["images"], [])
        self.assertEqual(body["videos"], [])


class SeededCountryTests(RouteTestCase):
    def test_a_seeded_country_is_ready_and_not_regenerated(self):
        self.make_media("spain", images=5, videos=5)
        self.store.seed_from_disk(known_names=["Spain"])
        self.store.register_known_country("ESP", "Spain")

        body = self.client.post("/api/countries/ESP/generate", json={"name": "Spain"}).json()
        self.assertFalse(body["created"])
        self.assertEqual(body["job"]["status"], READY)
        self.assertEqual(self.store.list_jobs(), [])


if __name__ == "__main__":
    unittest.main()
