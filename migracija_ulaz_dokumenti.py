"""Prepravlja tabele ulaz i dobavljac_artikal u POSTOJEĆOJ bazi, bez gubitka podataka.

Šta se menja:
  ulaz
    - racun_broj više nije obavezan (ulaz može imati samo otpremnicu)
    - nove kolone: ulaz_datum (datum računa), otpremnica_broj, otpremnica_datum, valuta_datum
    - datum_vreme sada znači "kad je ulaz unet u program" (datum i vreme, upisuje server)
    - pravila u samoj bazi: mora postojati broj računa ILI broj otpremnice,
      i datum računa ILI datum otpremnice; broj otpremnice je jedinstven po dobavljaču
    - stari ulazi: dosadašnji datum_vreme je bio datum računa, pa se kopira u ulaz_datum
  dobavljac_artikal
    - sifra_dobavljac više nije obavezna (artikal može da se poveže sa dobavljačem
      i kad njegova šifra nije poznata)

SQLite ne ume da ukloni NOT NULL kroz ALTER TABLE, pa se tabela pravi iznova
(nova tabela -> kopiranje podataka -> brisanje stare -> preimenovanje), sve u jednoj
transakciji: ako bilo šta pukne, baza ostaje kakva je bila.

Može da se pokrene više puta: ako je baza već prepravljena, ne radi ništa.

    python migracija_ulaz_dokumenti.py
"""

from db import konektuj_se

NOVI_ULAZ = """
CREATE TABLE ulaz_novi (
    ulaz_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dobavljac_id INTEGER NOT NULL,
    racun_broj TEXT,
    racun_poziv_na_broj TEXT,
    ulaz_datum TEXT,
    otpremnica_broj TEXT,
    otpremnica_datum TEXT,
    valuta_datum TEXT,
    datum_vreme TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    CONSTRAINT fk_ulaz_dobavljac FOREIGN KEY (dobavljac_id) REFERENCES dobavljac(dobavljac_id),
    CONSTRAINT uq_ulaz_racun UNIQUE (dobavljac_id, racun_broj),
    CONSTRAINT uq_ulaz_otpremnica UNIQUE (dobavljac_id, otpremnica_broj),
    CONSTRAINT ck_ulaz_dokument CHECK (racun_broj IS NOT NULL OR otpremnica_broj IS NOT NULL),
    CONSTRAINT ck_ulaz_datum CHECK (ulaz_datum IS NOT NULL OR otpremnica_datum IS NOT NULL)
)
"""

NOVI_DOBAVLJAC_ARTIKAL = """
CREATE TABLE dobavljac_artikal_novi (
    dobavljac_id INTEGER NOT NULL,
    sifra_artikal INTEGER NOT NULL,
    sifra_dobavljac TEXT,
    naziv TEXT,
    nabavna_cena_bez_pdv REAL NOT NULL DEFAULT 0.0000 CHECK (nabavna_cena_bez_pdv >= 0),
    pdv REAL NOT NULL DEFAULT 20.00 CHECK (pdv >= 0),
    PRIMARY KEY (dobavljac_id, sifra_artikal),
    CONSTRAINT fk_dob_art_dobavljac FOREIGN KEY (dobavljac_id) REFERENCES dobavljac(dobavljac_id),
    CONSTRAINT fk_dob_art_artikal FOREIGN KEY (sifra_artikal) REFERENCES artikal(sifra),
    CONSTRAINT uq_dobavljac_sifra_dob UNIQUE (dobavljac_id, sifra_dobavljac)
)
"""


def kolone(konekcija, tabela):
    return [red[1] for red in konekcija.execute(f"PRAGMA table_info({tabela})")]


import backup_baze
backup_baze.napravi_kopiju("pre-migracije-ulaz_dokumenti")   # kopija baze pre izmene
konekcija = konektuj_se()

if "otpremnica_broj" in kolone(konekcija, "ulaz"):
    print("Baza je već prepravljena, nema izmena.")
    konekcija.close()
    raise SystemExit

# Strani ključevi se gase SAMO za vreme prepravke (stavka_ulaza pokazuje na ulaz),
# pa se na kraju proveri da su sve veze i dalje ispravne.
konekcija.execute("PRAGMA foreign_keys = OFF")
try:
    konekcija.execute("BEGIN")

    konekcija.execute(NOVI_ULAZ)
    konekcija.execute("""
        INSERT INTO ulaz_novi (ulaz_id, dobavljac_id, racun_broj, racun_poziv_na_broj,
                               ulaz_datum, otpremnica_broj, otpremnica_datum, valuta_datum, datum_vreme)
        SELECT ulaz_id, dobavljac_id, NULLIF(TRIM(racun_broj), ''), NULLIF(TRIM(racun_poziv_na_broj), ''),
               datum_vreme, NULL, NULL, NULL, datum_vreme
        FROM ulaz
    """)
    konekcija.execute("DROP TABLE ulaz")
    konekcija.execute("ALTER TABLE ulaz_novi RENAME TO ulaz")

    konekcija.execute(NOVI_DOBAVLJAC_ARTIKAL)
    konekcija.execute("""
        INSERT INTO dobavljac_artikal_novi
        SELECT dobavljac_id, sifra_artikal, NULLIF(TRIM(sifra_dobavljac), ''), naziv, nabavna_cena_bez_pdv, pdv
        FROM dobavljac_artikal
    """)
    konekcija.execute("DROP TABLE dobavljac_artikal")
    konekcija.execute("ALTER TABLE dobavljac_artikal_novi RENAME TO dobavljac_artikal")

    greske = konekcija.execute("PRAGMA foreign_key_check").fetchall()
    if greske:
        raise RuntimeError(f"Neispravne veze posle prepravke: {greske}")

    konekcija.execute("COMMIT")
    print("Tabele ulaz i dobavljac_artikal su prepravljene.")
except Exception:
    konekcija.execute("ROLLBACK")
    print("Prepravka NIJE uspela, baza je ostala kakva je bila.")
    raise
finally:
    konekcija.execute("PRAGMA foreign_keys = ON")
    konekcija.close()
