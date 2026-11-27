"""Proširuje dobavljače: osnovni podaci, kontakti, tekući računi i radne jedinice. Bez gubitka podataka.

Šta se menja:
  dobavljac (nove kolone): tip, pib, dugi_naziv, vlasnik, zemlja, opstina, ptt_broj, adresa, mesto,
      maticni_broj, broj_gazdinstva, registarski_broj, sifra_delatnosti, pdv_zona, pdv_obveznik,
      e_faktura, telefon, fax, el_dostava, email, web, aktivan.
      Postojeća kolona naziv = KRATKI naziv (prikazuje se svuda u programu).
  Nove tabele (vezane za dobavljac_id, brišu se zajedno sa dobavljačem):
      dobavljac_kontakt, dobavljac_racun, dobavljac_jedinica
  Šifarnici (popunjavaju se iz podaci/*.csv): sif_opstina, sif_ptt, sif_banka

Postojeći dobavljači dobijaju podrazumevane vrednosti kao u formi za unos:
tip P (pravna lica), opština Mladenovac, PTT 11400 Mladenovac, PDV zona 0 (Srbija), PDV obveznik da, aktivan.

Može da se pokrene više puta: ono što već postoji se preskače, šifarnici se osvežavaju.

    python migracija_dobavljaci_detalji.py
"""

import csv
from pathlib import Path

from db import konektuj_se

PODACI = Path(__file__).resolve().parent / "podaci"

KOLONE_DOBAVLJACA = [
    ("tip", "TEXT NOT NULL DEFAULT 'P' CHECK (tip IN ('P', 'F', 'R', 'J', 'L'))"),
    ("pib", "TEXT"),
    ("dugi_naziv", "TEXT"),
    ("vlasnik", "TEXT"),
    ("zemlja", "TEXT"),
    ("opstina", "TEXT DEFAULT 'Mladenovac'"),
    ("ptt_broj", "TEXT DEFAULT '11400'"),
    ("adresa", "TEXT"),
    ("mesto", "TEXT"),
    ("maticni_broj", "TEXT"),
    ("broj_gazdinstva", "TEXT"),
    ("registarski_broj", "TEXT"),
    ("sifra_delatnosti", "TEXT"),
    ("pdv_zona", "INTEGER NOT NULL DEFAULT 0 CHECK (pdv_zona BETWEEN 0 AND 3)"),
    ("pdv_obveznik", "INTEGER NOT NULL DEFAULT 1 CHECK (pdv_obveznik IN (0, 1))"),
    ("e_faktura", "INTEGER NOT NULL DEFAULT 0 CHECK (e_faktura IN (0, 1))"),
    ("telefon", "TEXT"),
    ("fax", "TEXT"),
    ("el_dostava", "INTEGER NOT NULL DEFAULT 0 CHECK (el_dostava IN (0, 1))"),
    ("email", "TEXT"),
    ("web", "TEXT"),
    ("aktivan", "INTEGER NOT NULL DEFAULT 1 CHECK (aktivan IN (0, 1))"),
]

TABELE = """
CREATE TABLE IF NOT EXISTS sif_opstina (
    naziv TEXT PRIMARY KEY,
    okrug TEXT,
    sifra TEXT,
    ptt TEXT                         -- glavni PTT broj sedišta opštine
);
CREATE TABLE IF NOT EXISTS sif_ptt (
    broj TEXT NOT NULL,
    mesto TEXT NOT NULL,
    opstina TEXT,
    PRIMARY KEY (broj, mesto)
);
CREATE TABLE IF NOT EXISTS sif_banka (
    sifra TEXT PRIMARY KEY CHECK (length(sifra) = 3),
    naziv TEXT NOT NULL,
    maticni_broj TEXT,
    bic TEXT
);
CREATE TABLE IF NOT EXISTS dobavljac_kontakt (
    kontakt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dobavljac_id INTEGER NOT NULL REFERENCES dobavljac(dobavljac_id) ON DELETE CASCADE,
    naziv TEXT NOT NULL,
    telefon TEXT,
    mobilni TEXT,
    fax TEXT,
    web TEXT,
    email TEXT,
    sluzba TEXT,
    funkcija TEXT
);
CREATE TABLE IF NOT EXISTS dobavljac_racun (
    racun_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dobavljac_id INTEGER NOT NULL REFERENCES dobavljac(dobavljac_id) ON DELETE CASCADE,
    valuta TEXT NOT NULL DEFAULT 'RSD',
    banka_sifra TEXT,                -- 3 cifre (domaći račun), NULL za strani
    banka_naziv TEXT,
    broj_racuna TEXT NOT NULL,       -- domaći: srednji deo (do 13 cifara), strani: IBAN
    kontrolni_broj TEXT,             -- domaći: 2 cifre (mod 97)
    dug_konto TEXT DEFAULT '43500',
    pot_konto TEXT DEFAULT '20410'
);
CREATE TABLE IF NOT EXISTS dobavljac_jedinica (
    jedinica_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dobavljac_id INTEGER NOT NULL REFERENCES dobavljac(dobavljac_id) ON DELETE CASCADE,
    naziv TEXT NOT NULL,
    adresa TEXT,
    mesto TEXT,
    ptt_broj TEXT,
    gln TEXT,
    dostava INTEGER NOT NULL DEFAULT 0 CHECK (dostava IN (0, 1)),
    email TEXT,
    aktivan INTEGER NOT NULL DEFAULT 1 CHECK (aktivan IN (0, 1))
);
CREATE INDEX IF NOT EXISTS ix_kontakt_dobavljac ON dobavljac_kontakt(dobavljac_id);
CREATE INDEX IF NOT EXISTS ix_racun_dobavljac ON dobavljac_racun(dobavljac_id);
CREATE INDEX IF NOT EXISTS ix_jedinica_dobavljac ON dobavljac_jedinica(dobavljac_id);
"""


def citaj_csv(ime):
    """CSV sa ';' i komentarima (#) na početku."""
    with open(PODACI / ime, encoding="utf-8") as f:
        redovi = [r for r in f if r.strip() and not r.startswith("#")]
    return list(csv.DictReader(redovi, delimiter=";"))


def napuni_sifarnike(konekcija):
    if "ptt" not in {r[1] for r in konekcija.execute("PRAGMA table_info(sif_opstina)")}:
        konekcija.execute("ALTER TABLE sif_opstina ADD COLUMN ptt TEXT")
    konekcija.execute("DELETE FROM sif_opstina")
    konekcija.executemany("INSERT INTO sif_opstina (naziv, okrug, sifra, ptt) VALUES (?,?,?,?)",
                          [(r["naziv"], r["okrug"] or None, r["sifra"] or None, r["ptt"] or None)
                           for r in citaj_csv("opstine.csv")])
    konekcija.execute("DELETE FROM sif_ptt")
    konekcija.executemany("INSERT OR IGNORE INTO sif_ptt (broj, mesto, opstina) VALUES (?,?,?)",
                          [(r["broj"], r["mesto"], r["opstina"] or None) for r in citaj_csv("ptt.csv")])
    konekcija.execute("DELETE FROM sif_banka")
    konekcija.executemany("INSERT INTO sif_banka (sifra, naziv, maticni_broj, bic) VALUES (?,?,?,?)",
                          [(r["sifra"], r["naziv"], r["maticni_broj"] or None, r["bic"] or None) for r in citaj_csv("banke.csv")])


def migriraj(konekcija):
    konekcija.execute("BEGIN")
    try:
        postojece = {r[1] for r in konekcija.execute("PRAGMA table_info(dobavljac)")}
        for ime, tip in KOLONE_DOBAVLJACA:
            if ime not in postojece:
                konekcija.execute(f"ALTER TABLE dobavljac ADD COLUMN {ime} {tip}")
        # Postojeći dobavljači: mesto kao u podrazumevanoj PTT (Mladenovac) samo ako je adresa prazna
        konekcija.execute("UPDATE dobavljac SET mesto = 'Mladenovac' WHERE mesto IS NULL AND ptt_broj = '11400'")
        konekcija.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_dobavljac_pib ON dobavljac(pib) WHERE pib IS NOT NULL")
        for naredba in TABELE.split(";"):
            if naredba.strip():
                konekcija.execute(naredba)
        napuni_sifarnike(konekcija)
        konekcija.execute("COMMIT")
    except Exception:
        konekcija.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    import backup_baze
    backup_baze.napravi_kopiju("pre-migracije-dobavljaci_detalji")   # kopija baze pre izmene
    k = konektuj_se()
    k.isolation_level = None
    migriraj(k)
    for t in ("sif_opstina", "sif_ptt", "sif_banka", "dobavljac"):
        print(t, k.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
    print("integritet:", k.execute("PRAGMA integrity_check").fetchone()[0], k.execute("PRAGMA foreign_key_check").fetchall())
    k.close()
