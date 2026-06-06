import unittest

import numpy as np

from main import trim_silence


class TrimSilenceTests(unittest.TestCase):
    def test_trim_silence_keeps_head_and_tail_guard_samples(self):
        sample_rate = 22050
        samples = np.zeros(sample_rate * 2, dtype=np.float32)
        samples[5000:11000] = 0.08

        trimmed = trim_silence(samples)

        self.assertGreater(len(trimmed), 6000)
        self.assertLess(len(trimmed), len(samples))

        leading_guard = trimmed[: int(0.15 * sample_rate)]
        trailing_guard = trimmed[-int(0.1 * sample_rate) :]
        self.assertTrue(np.any(np.abs(leading_guard) < 1e-6))
        self.assertTrue(np.any(np.abs(trailing_guard) < 1e-6))


if __name__ == "__main__":
    unittest.main()
