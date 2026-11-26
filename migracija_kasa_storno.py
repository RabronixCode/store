"""Migracija: kasa — način plaćanja, status računa i storno.

  racun (nove kolone):
    - nacin_placanja: 'gotovina' | 'kartica' | 'cek'   (stari računi: 'gotovina')
    - status: 'izdat' | 'delimicno_storniran' | 'storniran'
  stavka_racuna (nova kolona):
    - stornirano: koliko je od količine stavke već stornirano (vraćeno na zalihe)
  storno (nova tabela): jedan storno dokument (može obuhvatiti više računa ili jedan artikal)
  stavka_storna (nova tabela): šta je tačno stornirano: račun, stavka, artikal, količina, cena

Može da se pokrene više puta.
"""
from db import konektuj_se

KOLONE_RACUNA = [
    ("nacin_placanja", "TEXT NOT NULL DEFAULT 'gotovina' CHECK (nacin_placanja IN ('gotovina', 'kartica', 'cek'))"),
    ("status", "TEXT NOT NULL DEFAULT 'izdat' CHECK (status IN ('izdat', 'delimicno_storniran', 'storniran'))"),
]
KOLONE_STAVKE = [
    ("stornirano", "REAL NOT NULL DEFAULT 0 CHECK (stornirano >= 0)"),
]

TABELE = """
CREATE TABLE IF NOT EXISTS storno (
    storno_id INTEGER PRIMARY KEY AUTOINCREMENT,
    datum_vreme TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    korisnik TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stavka_storna (
    stavka_storna_id INTEGER PRIMARY KEY AUTOINCREMENT,
    storno_id INTEGER NOT NULL REFERENCES storno(storno_id),
    racun_id INTEGER NOT NULL REFERENCES racun(racun_id),
    stavka_id INTEGER NOT NULL REFERENCES stavka_racuna(stavka_id),
    sifra INTEGER NOT NULL REFERENCES artikal(sifra),
    naziv TEXT NOT NULL,
    jedinica_mere TEXT NOT NULL,
    kolicina REAL NOT NULL CHECK (kolicina > 0),
    cena_po_komadu REAL NOT NULL CHECK (cena_po_komadu >= 0),
    nabavna_cena REAL NOT NULL CHECK (nabavna_cena >= 0)
);
CREATE INDEX IF NOT EXISTS ix_racun_datum ON racun(datum_vreme);
CREATE INDEX IF NOT EXISTS ix_stavka_racuna_racun ON stavka_racuna(racun_id);
CREATE INDEX IF NOT EXISTS ix_stavka_storna_storno ON stavka_storna(storno_id);
CREATE INDEX IF NOT EXISTS ix_stavka_storna_racun ON stavka_storna(racun_id)
"""


def _dodaj_kolone(konekcija, tabela, kolone):
    postojece = {r[1] for r in konekcija.execute(f"PRAGMA table_info({tabela})")}
    for ime, tip in kolone:
        if ime not in postojece:
            konekcija.execute(f"ALTER TABLE {tabela} ADD COLUMN {ime} {tip}")


def migriraj(konekcija):
    konekcija.execute("BEGIN")
    try:
        _dodaj_kolone(konekcija, "racun", KOLONE_RACUNA)
        _dodaj_kolone(konekcija, "stavka_racuna", KOLONE_STAVKE)
        for naredba in TABELE.split(";"):
            if naredba.strip():
                konekcija.execute(naredba)
        konekcija.execute("COMMIT")
    except Exception:
        konekcija.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    k = konektuj_se()
    k.isolation_level = None
    migriraj(k)
    print("Računi:", k.execute("SELECT nacin_placanja, status, COUNT(*) FROM racun GROUP BY 1, 2").fetchall())
    print("integritet:", k.execute("PRAGMA integrity_check").fetchone()[0], k.execute("PRAGMA foreign_key_check").fetchall())
    k.close()
