import unittest

from backend.generate_photos import (
    build_prompt,
    parse_timeline_start,
    safe_timeline_filename,
    sort_results,
    unique_output_name,
)


class GeneratePhotosTests(unittest.TestCase):
    def test_parses_year_and_bc_timeline_starts(self):
        self.assertEqual(parse_timeline_start("711–1492"), 711)
        self.assertEqual(parse_timeline_start("c. 50,000 BC – 1,100 BC"), -50000)
        self.assertEqual(parse_timeline_start("late 15th – 17th century"), 1400)
        self.assertEqual(parse_timeline_start("206 BC – 5th century AD"), -206)

    def test_sorts_results_by_timeline_start_and_preserves_ties(self):
        results = [
            {"timeline": "711–1492", "fact": "later"},
            {"timeline": "418–711", "fact": "earlier"},
            {"timeline": "711–1492", "fact": "same start"},
        ]

        ordered = sort_results(results)

        self.assertEqual([item["fact"] for item in ordered], ["earlier", "later", "same start"])

    def test_builds_prompt_from_fact_and_timeline(self):
        prompt = build_prompt(
            {
                "title": "History source",
                "fact": "Roman Hispania introduced Latin, law, and infrastructure.",
                "timeline": "206 BC – 5th century AD",
            }
        )

        self.assertIn("Roman Hispania introduced Latin, law, and infrastructure.", prompt)
        self.assertIn("206 BC – 5th century AD", prompt)
        self.assertIn("illustrated historical scene", prompt)

    def test_safe_filename_keeps_timeline_readable(self):
        self.assertEqual(
            safe_timeline_filename("c. 50,000 BC – 1,100 BC"),
            "c-50-000-BC-1-100-BC",
        )

    def test_duplicate_timelines_get_unique_output_names(self):
        used = set()
        self.assertEqual(unique_output_name("711–1492", used), "711-1492.jpg")
        self.assertEqual(unique_output_name("711–1492", used), "711-1492-2.jpg")


if __name__ == "__main__":
    unittest.main()
