import unittest

import numpy as np

from backend.app.engine import (
    ComputeError,
    _apply_direction,
    apply_weight_model,
    train_weight_model,
)


INDICATORS = [
    {
        "key": "a",
        "name": "A",
        "dimension2Key": "g1",
        "direction": "positive",
        "unit": None,
    },
    {
        "key": "b",
        "name": "B",
        "dimension2Key": "g1",
        "direction": "negative",
        "unit": None,
    },
    {
        "key": "c",
        "name": "C",
        "dimension2Key": "g2",
        "direction": "positive",
        "unit": None,
    },
]

INDICATOR_KEYS = ["a", "b", "c"]
DIRECTIONS = ["positive", "negative", "positive"]
TRAINING_MATRIX = np.array(
    [
        [1.0, 9.0, 2.0],
        [2.0, 7.0, 3.0],
        [4.0, 4.0, 5.0],
        [5.0, 2.0, 8.0],
    ],
    dtype=float,
)


class EngineRegressionTests(unittest.TestCase):
    def test_apply_direction_flips_negative_columns_only(self) -> None:
        actual = _apply_direction(TRAINING_MATRIX, DIRECTIONS)

        np.testing.assert_allclose(actual[:, 0], TRAINING_MATRIX[:, 0])
        np.testing.assert_allclose(actual[:, 1], -TRAINING_MATRIX[:, 1])
        np.testing.assert_allclose(actual[:, 2], TRAINING_MATRIX[:, 2])

    def test_entropy_model_training_and_application_are_stable(self) -> None:
        model = train_weight_model(
            method="entropy",
            name="entropy-baseline",
            indicator_keys=INDICATOR_KEYS,
            indicators=INDICATORS,
            x_train=TRAINING_MATRIX,
            directions=DIRECTIONS,
            trained_on_dataset_ids=["dataset-1"],
        )

        self.assertEqual(model["standardization"]["kind"], "minmax")
        self.assertAlmostEqual(sum(model["weights"].values()), 1.0, places=8)
        self.assertAlmostEqual(sum(model["dimension2Weights"].values()), 1.0, places=8)

        z, score_raw, sub_scores, sub_index_0_100 = apply_weight_model(
            model=model,
            indicators=INDICATORS,
            x=TRAINING_MATRIX,
            directions=DIRECTIONS,
        )

        self.assertEqual(z.shape, TRAINING_MATRIX.shape)
        self.assertEqual(int(np.argmax(score_raw)), 3)
        self.assertEqual(int(np.argmin(score_raw)), 0)
        self.assertEqual(set(sub_scores.keys()), {"g1", "g2"})
        for values in sub_index_0_100.values():
            self.assertTrue(np.all(values >= 0.0))
            self.assertTrue(np.all(values <= 100.0))

    def test_pca_model_returns_weights_and_metadata(self) -> None:
        model = train_weight_model(
            method="pca",
            name="pca-baseline",
            indicator_keys=INDICATOR_KEYS,
            indicators=INDICATORS,
            x_train=TRAINING_MATRIX,
            directions=DIRECTIONS,
            trained_on_dataset_ids=["dataset-1"],
        )

        self.assertEqual(model["standardization"]["kind"], "zscore")
        self.assertIsNotNone(model["pca"])
        self.assertGreaterEqual(model["pca"]["k"], 1)
        self.assertLessEqual(model["pca"]["cumulative"], 1.0)
        self.assertAlmostEqual(sum(model["weights"].values()), 1.0, places=8)

        _, score_raw, _, _ = apply_weight_model(
            model=model,
            indicators=INDICATORS,
            x=TRAINING_MATRIX,
            directions=DIRECTIONS,
        )
        self.assertEqual(int(np.argmax(score_raw)), 3)

    def test_ahp_model_uses_matrix_and_preserves_priority_order(self) -> None:
        ahp_matrix = [
            [1.0, 2.0, 4.0],
            [0.5, 1.0, 2.0],
            [0.25, 0.5, 1.0],
        ]

        model = train_weight_model(
            method="ahp",
            name="ahp-baseline",
            indicator_keys=INDICATOR_KEYS,
            indicators=INDICATORS,
            x_train=TRAINING_MATRIX,
            directions=DIRECTIONS,
            trained_on_dataset_ids=["dataset-1"],
            ahp_matrix=ahp_matrix,
        )

        self.assertEqual(model["standardization"]["kind"], "zscore")
        self.assertIsNotNone(model["ahp"])
        self.assertLess(model["ahp"]["CR"], 0.1)
        self.assertGreater(model["weights"]["a"], model["weights"]["b"])
        self.assertGreater(model["weights"]["b"], model["weights"]["c"])

    def test_entropy_training_rejects_constant_columns(self) -> None:
        invalid = np.array(
            [
                [1.0, 1.0],
                [1.0, 2.0],
                [1.0, 3.0],
            ],
            dtype=float,
        )

        with self.assertRaisesRegex(ComputeError, "max==min"):
            train_weight_model(
                method="entropy",
                name="invalid-entropy",
                indicator_keys=["x", "y"],
                indicators=[
                    {
                        "key": "x",
                        "name": "X",
                        "dimension2Key": "g1",
                        "direction": "positive",
                        "unit": None,
                    },
                    {
                        "key": "y",
                        "name": "Y",
                        "dimension2Key": "g2",
                        "direction": "positive",
                        "unit": None,
                    },
                ],
                x_train=invalid,
                directions=["positive", "positive"],
                trained_on_dataset_ids=["dataset-1"],
            )


if __name__ == "__main__":
    unittest.main()
