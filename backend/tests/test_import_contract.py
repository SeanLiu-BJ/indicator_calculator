import unittest

from backend.app.csv_utils import CsvError
from backend.app.datasets import normalize_imported_csv


class ImportContractTests(unittest.TestCase):
    def test_missing_entity_column_fails(self) -> None:
        csv_text = "year,value\n2024,1\n"

        with self.assertRaisesRegex(CsvError, "entity"):
            normalize_imported_csv(csv_text=csv_text, year_override=None)

    def test_missing_year_without_override_fails(self) -> None:
        csv_text = "entity,value\nAcme,1\n"

        with self.assertRaisesRegex(CsvError, "缺少 year"):
            normalize_imported_csv(csv_text=csv_text, year_override=None)

    def test_non_numeric_year_fails(self) -> None:
        csv_text = "entity,year,value\nAcme,not-a-year,1\n"

        with self.assertRaisesRegex(CsvError, "year 非数字"):
            normalize_imported_csv(csv_text=csv_text, year_override=None)

    def test_duplicate_entity_year_fails(self) -> None:
        csv_text = "entity,year,value\nAcme,2024,1\nAcme,2024,2\n"

        with self.assertRaisesRegex(CsvError, "entity\\+year 重复"):
            normalize_imported_csv(csv_text=csv_text, year_override=None)

    def test_missing_year_with_override_succeeds(self) -> None:
        csv_text = "entity,value\nAcme,1\nBravo,2\n"

        normalized_text, schema = normalize_imported_csv(
            csv_text=csv_text,
            year_override=2025,
        )

        self.assertEqual(
            normalized_text,
            "entity,year,value\nAcme,2025,1\nBravo,2025,2\n",
        )
        self.assertEqual(schema["required"], ["entity", "year"])
        self.assertEqual(schema["types"]["year"], "int")
        self.assertEqual(schema["rowCount"], 2)

    def test_empty_year_with_override_is_filled(self) -> None:
        csv_text = "entity,year,value\nAcme,,1\nBravo,2024,2\n"

        normalized_text, _ = normalize_imported_csv(
            csv_text=csv_text,
            year_override=2026,
        )

        self.assertEqual(
            normalized_text,
            "entity,year,value\nAcme,2026,1\nBravo,2024,2\n",
        )


if __name__ == "__main__":
    unittest.main()
