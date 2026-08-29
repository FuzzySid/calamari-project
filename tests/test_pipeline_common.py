"""Pure-logic tests for the shared pipeline helpers. No network, no API keys."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from pipeline_common import (  # noqa: E402
    append_run_log,
    country_paths,
    deterministic_seed,
    load_dotenv,
    scrub_secrets,
    slugify,
    write_json,
)

import os  # noqa: E402
import tempfile  # noqa: E402


class SlugifyTests(unittest.TestCase):
    def test_lowercases_and_hyphenates(self):
        self.assertEqual(slugify("Spain"), "spain")
        self.assertEqual(slugify("United Kingdom"), "united-kingdom")

    def test_folds_accents_to_ascii(self):
        """Slugs become filenames and URLs, so they must survive any filesystem."""
        self.assertEqual(slugify("Côte d'Ivoire"), "cote-d-ivoire")
        self.assertEqual(slugify("España"), "espana")

    def test_strips_leading_and_trailing_separators(self):
        self.assertEqual(slugify("  Japan!  "), "japan")


class CountryPathsTests(unittest.TestCase):
    def test_every_artifact_lives_under_one_country_directory(self):
        paths = country_paths("Spain", output_root="/tmp/out")
        self.assertEqual(paths["slug"], "spain")
        self.assertEqual(paths["dir"], Path("/tmp/out/spain"))
        self.assertEqual(paths["info"], Path("/tmp/out/spain/info.json"))
        self.assertEqual(paths["prompts"], Path("/tmp/out/spain/prompts_image.json"))
        self.assertEqual(paths["images"], Path("/tmp/out/spain/images.json"))
        self.assertEqual(paths["images_dir"], Path("/tmp/out/spain/images"))
        self.assertEqual(paths["run_log"], Path("/tmp/out/spain/run_log.json"))

    def test_countries_never_share_a_directory(self):
        """A failure on one country must not be able to touch another's outputs."""
        spain = country_paths("Spain", output_root="/tmp/out")
        japan = country_paths("Japan", output_root="/tmp/out")
        self.assertNotEqual(spain["dir"], japan["dir"])

    def test_rejects_a_name_that_slugs_to_nothing(self):
        with self.assertRaises(ValueError):
            country_paths("!!!", output_root="/tmp/out")


class DeterministicSeedTests(unittest.TestCase):
    def test_is_stable_across_calls(self):
        """--force must reproduce the same image, not a new one."""
        first = deterministic_seed("spain", "reconquista_1492", "equirect-360-v1")
        second = deterministic_seed("spain", "reconquista_1492", "equirect-360-v1")
        self.assertEqual(first, second)

    def test_differs_across_countries_events_versions_and_variants(self):
        base = deterministic_seed("spain", "civil_war_1936", "equirect-360-v1")
        self.assertNotEqual(base, deterministic_seed("japan", "civil_war_1936", "equirect-360-v1"))
        self.assertNotEqual(base, deterministic_seed("spain", "armada_1588", "equirect-360-v1"))
        self.assertNotEqual(base, deterministic_seed("spain", "civil_war_1936", "other-v2"))
        self.assertNotEqual(base, deterministic_seed("spain", "civil_war_1936", "equirect-360-v1", variant=2))

    def test_stays_in_fal_seed_range(self):
        for country in ("spain", "japan", "brazil", "india"):
            seed = deterministic_seed(country, "event_1900", "equirect-360-v1")
            self.assertGreaterEqual(seed, 0)
            self.assertLess(seed, 2147483647)


class ScrubSecretsTests(unittest.TestCase):
    def test_redacts_credentials_at_any_depth(self):
        scrubbed = scrub_secrets(
            {"api_key": "sk-live", "nested": {"Authorization": "Bearer x", "keep": "visible"}}
        )
        self.assertEqual(scrubbed["api_key"], "[REDACTED]")
        self.assertEqual(scrubbed["nested"]["Authorization"], "[REDACTED]")
        self.assertEqual(scrubbed["nested"]["keep"], "visible")

    def test_redacts_inside_lists(self):
        scrubbed = scrub_secrets({"runs": [{"fal_key": "secret", "seed": 42}]})
        self.assertEqual(scrubbed["runs"][0]["fal_key"], "[REDACTED]")
        self.assertEqual(scrubbed["runs"][0]["seed"], 42)


class AppendRunLogTests(unittest.TestCase):
    def test_appends_without_dropping_earlier_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "run_log.json"
            append_run_log(log, {"country": "Spain", "order": 1})
            append_run_log(log, {"country": "Spain", "order": 2})
            document = json.loads(log.read_text(encoding="utf-8"))
            self.assertEqual([run["order"] for run in document["runs"]], [1, 2])
            self.assertIn("generated_at", document["runs"][0])

    def test_scrubs_secrets_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "run_log.json"
            append_run_log(log, {"fal_key": "secret-value"})
            self.assertNotIn("secret-value", log.read_text(encoding="utf-8"))

    def test_survives_a_corrupt_log(self):
        """A corrupt log must not abort a run that already cost paid API calls."""
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "run_log.json"
            log.write_text("{not json", encoding="utf-8")
            append_run_log(log, {"order": 1})
            document = json.loads(log.read_text(encoding="utf-8"))
            self.assertEqual(len(document["runs"]), 1)


class LoadDotenvTests(unittest.TestCase):
    def test_does_not_override_exported_variables(self):
        """An explicitly exported shell variable must win over the .env file."""
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text('EXPORTED_WINS=from-file\nFROM_FILE="quoted"\n', encoding="utf-8")
            os.environ["EXPORTED_WINS"] = "from-shell"
            os.environ.pop("FROM_FILE", None)
            try:
                load_dotenv(env_file)
                self.assertEqual(os.environ["EXPORTED_WINS"], "from-shell")
                self.assertEqual(os.environ["FROM_FILE"], "quoted")
            finally:
                os.environ.pop("EXPORTED_WINS", None)
                os.environ.pop("FROM_FILE", None)


class WriteJsonTests(unittest.TestCase):
    def test_creates_parent_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "deep" / "nested" / "info.json"
            write_json(target, {"events": []})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"events": []})

    def test_leaves_no_temporary_file_behind(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "info.json"
            write_json(target, {"ok": True})
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["info.json"])


if __name__ == "__main__":
    unittest.main()
