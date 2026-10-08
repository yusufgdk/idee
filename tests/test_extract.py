import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import extract  # noqa: E402

PAGES = [
    # Seite 1: Inhaltsverzeichnis (darf nicht als Abschnitt erkannt werden)
    "Fuser error service check ........ 120\n",
    # Seite 2: Fehlercode-Tabelle
    "Error code Description Action\n"
    "121.04 Fuser error. The fuser temperature is too low. Go to “Fuser error service check”.\n"
    "242.01 Paper jam in tray 2. Replace the tray 2 pick roller.\n"
    "999.99 Unknown thing. Contact support.\n",
    # Seite 3: Service-Check
    "Fuser error service check\n"
    "1 Check the fuser connector.\n"
    "2 Replace the fuser. See “Fuser removal”.\n",
    # Seite 4: Parts-Catalog
    "Asm-index P/N Units/mach Units/FRU Description\n"
    "1 41X1228 1 1 Fuser, 110 V\n"
    "1 41X1229 1 1 Fuser, 230 V\n"
    "2 40X8295 1 1 Tray 2 pick roller assembly\n"
    "3 41X0254 1 1 Controller board\n",
]


class ExtractTest(unittest.TestCase):
    def setUp(self):
        self.data = extract.build(PAGES, "test", ["T1"], "Test Manual", "")
        self.by_code = {e["code"]: e for e in self.data["errors"]}

    def test_parts(self):
        self.assertEqual(self.data["parts"]["41X1229"]["voltage"], "230V")
        self.assertEqual(self.data["parts"]["41X1228"]["voltage"], "110V")
        self.assertEqual(self.data["parts"]["40X8295"]["name"], "Tray 2 pick roller assembly")

    def test_code_via_service_check(self):
        self.assertEqual(sorted(self.by_code["121.04"]["frus"]), ["41X1228", "41X1229"])
        self.assertEqual(self.by_code["121.04"]["title"], "Fuser error")

    def test_code_direct(self):
        self.assertEqual(self.by_code["242.01"]["frus"], ["40X8295"])

    def test_no_guessing(self):
        self.assertEqual(self.by_code["999.99"]["frus"], [])

    def test_all_frus_in_catalog(self):
        for e in self.data["errors"]:
            for f in e["frus"]:
                self.assertIn(f, self.data["parts"])


if __name__ == "__main__":
    unittest.main()
