import unittest

from backend.main import (
    build_openai_input,
    extract_response_text,
    prepare_results,
    topic_slug,
)


class MainPipelineTests(unittest.TestCase):
    def test_topic_slug_is_stable_and_readable(self):
        self.assertEqual(topic_slug("What are the most relevant historical periods of India"), "india")

    def test_openai_input_contains_only_the_historical_source_material(self):
        text = build_openai_input(
            {
                "fact": "The Indus Valley Civilization developed urban settlements.",
                "timeline": "c. 3300–1300 BC",
            }
        )

        self.assertIn("The Indus Valley Civilization developed urban settlements.", text)
        self.assertIn("c. 3300–1300 BC", text)
        self.assertIn("Return only the image prompt", text)

    def test_extracts_text_from_responses_api_output(self):
        response = {
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "A temple at dawn"}]}
            ]
        }

        self.assertEqual(extract_response_text(response), "A temple at dawn")

    def test_missing_timelines_are_preserved_as_undated(self):
        results = prepare_results([
            {"fact": "A dated event.", "timeline": "1947–1950"},
            {"fact": "A result without dates.", "timeline": ""},
        ])

        self.assertEqual(results[0]["timeline"], "1947–1950")
        self.assertEqual(results[1]["timeline"], "undated")


if __name__ == "__main__":
    unittest.main()
