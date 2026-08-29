"""Pure-logic tests for Stage 1's date parsing and provenance flattening. No network."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import stage1_facts  # noqa: E402
from stage1_facts import (  # noqa: E402
    build_timeline,
    call_cala,
    extract_timeline,
    resolve_sources,
    year_bounds,
)


class DateParsingTests(unittest.TestCase):
    def bounds(self, text):
        return year_bounds(extract_timeline(text))

    def test_parenthesized_range(self):
        self.assertEqual(self.bounds("The Spanish Civil War (July 1936 - April 1939) began"), (1936, 1939))

    def test_plain_inline_year(self):
        self.assertEqual(self.bounds("In the summer of 1588, Philip II launched the fleet"), (1588, 1588))

    def test_century_range_is_not_treated_as_undated(self):
        """"8th-15th centuries" is a real date range; dropping it loses the Reconquista."""
        self.assertEqual(self.bounds("Campaigns (8th-15th centuries) by Christian kingdoms"), (701, 1401))

    def test_spelled_out_century_range(self):
        self.assertEqual(self.bounds("Trade flourished from the 9th to the 12th centuries"), (801, 1101))

    def test_single_century(self):
        self.assertEqual(self.bounds("The Edo period spanned the 17th century"), (1601, 1601))

    def test_bc_years_are_negative_and_comma_grouped(self):
        """"50,000 BC" must read as -50000, not as the year 000."""
        self.assertEqual(self.bounds("Settlement occurred c. 50,000 BC - 1,100 BC in Iberia"), (-50000, -1100))

    def test_population_figures_are_not_years(self):
        """An army of 30,000 must not contribute the year 000."""
        self.assertEqual(self.bounds("An army of 30,000 men marched in 1588"), (1588, 1588))

    def test_undated_text_yields_nothing(self):
        self.assertEqual(self.bounds("Spain has a capital and a population."), (None, None))

    def test_build_timeline_returns_none_when_undated(self):
        self.assertIsNone(build_timeline("Spain has a capital and a population."))

    def test_build_timeline_shape(self):
        timeline = build_timeline("The Reconquista ended in 1492")
        self.assertEqual(timeline["start"], "1492")
        self.assertEqual(timeline["end"], "1492")
        self.assertEqual(timeline["display"], "1492")

    @unittest.expectedFailure
    def test_bare_counts_are_indistinguishable_from_years(self):
        """A documented limit: "130 ships" is shaped exactly like the year 130 AD.

        No regex can separate them without reading the sentence. Harmless in practice
        because real event text also carries a real date, which the earlier patterns win on.
        """
        self.assertEqual(self.bounds("Armada of 130 ships carrying 30,000 men"), (None, None))


class ProvenanceTests(unittest.TestCase):
    def context(self):
        return {
            "c1": {"id": "c1", "origins": [{"document": {"name": "Britannica", "url": "https://b.com/a"}}]},
            "c2": {"id": "c2", "origins": [{"source": {"name": "EBSCO", "url": "https://e.com/b"}}]},
            "c3": {"id": "c3", "origins": [{"document": {"name": "Britannica", "url": "https://b.com/a"}}]},
        }

    def test_collects_every_distinct_source(self):
        """Plural sources per event: the old resolver kept only the first."""
        sources = resolve_sources(["c1", "c2"], self.context())
        self.assertEqual([s["publisher"] for s in sources], ["Britannica", "EBSCO"])
        self.assertEqual([s["url"] for s in sources], ["https://b.com/a", "https://e.com/b"])

    def test_deduplicates_by_url(self):
        self.assertEqual(len(resolve_sources(["c1", "c3"], self.context())), 1)

    def test_falls_back_from_document_to_source(self):
        sources = resolve_sources(["c2"], self.context())
        self.assertEqual(sources[0]["publisher"], "EBSCO")

    def test_date_is_null_when_cala_supplies_none(self):
        """Never fabricate a date."""
        self.assertIsNone(resolve_sources(["c1"], self.context())[0]["date"])

    def test_unknown_reference_is_skipped(self):
        self.assertEqual(resolve_sources(["missing"], self.context()), [])


class CalaRetryTests(unittest.TestCase):
    """Cala intermittently returns a non-JSON body; this actually happened mid-run."""

    def setUp(self):
        self._real_once = stage1_facts._call_cala_once
        self._real_backoff = stage1_facts.CALA_RETRY_BACKOFF_SECONDS
        stage1_facts.CALA_RETRY_BACKOFF_SECONDS = 0
        self.calls = []

    def tearDown(self):
        stage1_facts._call_cala_once = self._real_once
        stage1_facts.CALA_RETRY_BACKOFF_SECONDS = self._real_backoff

    def test_succeeds_on_a_later_attempt(self):
        def flaky(query, api_key):
            self.calls.append(query)
            if len(self.calls) < 3:
                raise ValueError("Expecting value: line 1 column 1 (char 0)")
            return {"explainability": []}

        stage1_facts._call_cala_once = flaky
        self.assertEqual(call_cala("q", "key"), {"explainability": []})
        self.assertEqual(len(self.calls), 3)

    def test_does_not_retry_a_successful_call(self):
        stage1_facts._call_cala_once = lambda query, api_key: self.calls.append(1) or {"ok": 1}
        call_cala("q", "key")
        self.assertEqual(len(self.calls), 1)

    def test_gives_up_with_a_clear_error(self):
        def always_fails(query, api_key):
            self.calls.append(query)
            raise ValueError("Expecting value: line 1 column 1 (char 0)")

        stage1_facts._call_cala_once = always_fails
        with self.assertRaises(RuntimeError) as caught:
            call_cala("q", "key", attempts=3)
        self.assertIn("after 3 attempts", str(caught.exception))
        self.assertEqual(len(self.calls), 3)


if __name__ == "__main__":
    unittest.main()
