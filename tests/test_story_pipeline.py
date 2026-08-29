import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.generate_story import run_pipeline

from backend.story_pipeline import (
    append_fal_log,
    build_fal_prompt,
    normalize_cala_records,
    validate_story,
)


class StoryPipelineTests(unittest.TestCase):
    def setUp(self):
        self.period_document = {
            "query": "Spain periods",
            "results": [
                {"fact": "Granada fell in 1492.", "timeline": "1492", "title": "Source A"},
                {"fact": "The Armada sailed in 1588.", "timeline": "1588", "title": "Source B"},
            ],
        }

    def test_normalizes_period_and_event_records_with_source_indices(self):
        period = normalize_cala_records(self.period_document)
        event = normalize_cala_records({
            "results": [{"event": "A reform began in 1812.", "timeline": "1812", "title": "Source C", "source_url": "https://example.test"}],
        })

        self.assertEqual(period[0]["event"], "Granada fell in 1492.")
        self.assertEqual(period[0]["source_index"], 0)
        self.assertEqual(event[0]["event"], "A reform began in 1812.")
        self.assertEqual(event[0]["source_url"], "https://example.test")

    def test_rejects_story_with_non_chronological_events(self):
        candidates = normalize_cala_records(self.period_document)
        story = [
            {"source_indices": [1], "year": 1588, "event_title": "Armada", "fact_text": "The Armada sailed in 1588.", "narrative_copy": "Later." , "visual_brief": "Ships."},
            {"source_indices": [0], "year": 1492, "event_title": "Granada", "fact_text": "Granada fell in 1492.", "narrative_copy": "Earlier.", "visual_brief": "City."},
        ]

        with self.assertRaisesRegex(ValueError, "chronological"):
            validate_story(story, candidates, expected_count=2)

    def test_builds_prompt_from_visual_brief_and_locked_style_profile(self):
        profile = {
            "version": "museum-editorial-v1",
            "style": "muted indigo and ochre palette",
            "constraints": ["no text", "no watermark"],
        }

        prompt = build_fal_prompt({"visual_brief": "A treaty table with maps and seals."}, profile)

        self.assertIn("A treaty table with maps and seals.", prompt)
        self.assertIn("muted indigo and ochre palette", prompt)
        self.assertIn("no watermark", prompt)

    def test_appends_secret_free_fal_run_log(self):
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "fal.json"
            append_fal_log(log_path, {
                "country": "Spain",
                "events": [{"event_id": "granada", "fal_prompt": "A scene", "image_path": "image.jpg"}],
                "api_key": "must-not-be-written",
            })

            payload = json.loads(log_path.read_text())
            self.assertEqual(len(payload["runs"]), 1)
            self.assertEqual(payload["runs"][0]["country"], "Spain")
            self.assertNotIn("api_key", json.dumps(payload))

    def test_pipeline_uses_anchor_edit_for_every_event_and_writes_frontend_assets(self):
        records = [
            {"fact": f"Event {year} happened.", "timeline": str(year), "title": f"Source {year}", "source_url": "https://example.test"}
            for year in (100, 200, 300, 400, 500, 600)
        ]
        curated = {
            "era_label": "Test era",
            "era_rationale": "A test journey.",
            "events": [
                {"source_indices": [index], "year": year, "event_title": f"Event {year}", "fact_text": f"Event {year} happened.", "narrative_copy": "A moment.", "visual_brief": "A historical object."}
                for index, year in enumerate((100, 200, 300, 400, 500, 600))
            ],
        }
        profile = {
            "version": "museum-editorial-v1", "anchor_version": "museum-editorial-v1-anchor-1",
            "anchor_path": "", "generation_model": "fal-ai/flux-2-pro", "edit_model": "fal-ai/flux-2-pro/edit",
            "image_size": "landscape_16_9", "output_format": "jpeg", "style": "muted indigo and ochre palette",
            "constraints": ["no text", "no watermark"],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            anchor = root / "anchor.jpg"
            anchor.write_bytes(b"anchor")
            profile["anchor_path"] = str(anchor)
            profile_path = root / "profile.json"
            profile_path.write_text(json.dumps(profile))
            input_path = root / "knowledge.json"
            input_path.write_text(json.dumps({"results": records}))
            calls = []

            def fake_fal(model, arguments, _key):
                calls.append((model, arguments))
                return f"https://images.example.test/{len(calls)}.jpg"

            def fake_download(_url, destination):
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"jpeg")

            with patch("backend.generate_story.curate_story", return_value=curated), patch("backend.generate_story.upload_anchor", return_value="https://cdn.example.test/anchor.jpg"), patch("backend.generate_story.fal_image_url", side_effect=fake_fal), patch("backend.generate_story.download", side_effect=fake_download):
                frontend_path, events = run_pipeline(input_path, "TST", "Testland", profile_path, "openai", "fal", "gpt-5", project_root=root)

            self.assertEqual(len(events), 6)
            self.assertEqual(len(calls), 12)
            self.assertTrue(all(calls[index][0] == "fal-ai/flux-2-pro" for index in range(0, 12, 2)))
            self.assertTrue(all(calls[index][0] == "fal-ai/flux-2-pro/edit" for index in range(1, 12, 2)))
            self.assertTrue(all(calls[index][1]["image_urls"][1] == "https://cdn.example.test/anchor.jpg" for index in range(1, 12, 2)))
            self.assertTrue(all((root / event["output_image_path"]).exists() for event in events))
            self.assertEqual(len(json.loads(frontend_path.read_text())["moments"]), 6)
            self.assertEqual(len(json.loads((root / "data" / "fal.json").read_text())["runs"]), 1)


if __name__ == "__main__":
    unittest.main()
