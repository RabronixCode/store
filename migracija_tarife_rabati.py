"""Tarife (PDV stope) i rabati u stavkama ulaza. Dodaje u POSTOJEĆU bazu, bez gubitka podataka.

Šta se menja:
  tarifa (nova tabela): tarifa_id 0-9, naziv, stopa (%), vrsta ('dobra' / 'usluge')
  stavka_ulaza (nove kolone):
    - cena_pre_rabata: nabavna cena jednog artikla bez PDV sa računa, PRE rabata
    - rabat_osnovni, rabat_posebni, rabat_dodatni: rabati u %, primenjuju se jedan na drugi
    - tarifa_id: tarifa po kojoj je stavka primljena
    Postojeća kolona nabavna_cena sada znači NETO nabavna cena (posle rabata), bez PDV;
    po njoj se i dalje računa prosečna (ponderisana) nabavna cena.
  Stare stavke: cena_pre_rabata = nabavna_cena, rabati 0, tarifa po pdv stopi (20 -> 1, 10 -> 2, 8 -> 3, 0 -> 0).

Može da se pokrene više puta: ono što već postoji se preskače.

    python migracija_tarife_rabati.py
"""

from db import konektuj_se

TARIFE = [
    (0, "Dobra bez PDV-a", 0, "dobra"),
    (1, "Dobra opšta stopa", 20, "dobra"),
    (2, "Dobra niža stopa", 10, "dobra"),
    (3, "Dobra poljop. otkup", 8, "dobra"),
    (4, "Dobra van PDV-a", 0, "dobra"),
    (5, "Usluge bez PDV-a", 0, "usluge"),
    (6, "Usluge opšta stopa", 20, "usluge"),
    (7, "Usluge niža stopa", 10, "usluge"),
    (8, "Usluge poljop. otkup", 8, "usluge"),
    (9, "Usluge van PDV-a", 0, "usluge"),
]

TABELA_TARIFA = """
CREATE TABLE IF NOT EXISTS tarifa (
    tarifa_id INTEGER PRIMARY KEY CHECK (tarifa_id BETWEEN 0 AND 99),
    naziv TEXT NOT NULL,
    stopa REAL NOT NULL CHECK (stopa >= 0 AND stopa <= 100),
    vrsta TEXT NOT NULL CHECK (vrsta IN ('dobra', 'usluge'))
)
"""

NOVE_KOLONE = [
    ("cena_pre_rabata", "REAL CHECK (cena_pre_rabata >= 0)"),
    ("rabat_osnovni", "REAL NOT NULL DEFAULT 0 CHECK (rabat_osnovni >= 0 AND rabat_osnovni <= 100)"),
    ("rabat_posebni", "REAL NOT NULL DEFAULT 0 CHECK (rabat_posebni >= 0 AND rabat_posebni <= 100)"),
    ("rabat_dodatni", "REAL NOT NULL DEFAULT 0 CHECK (rabat_dodatni >= 0 AND rabat_dodatni <= 100)"),
    ("tarifa_id", "INTEGER REFERENCES tarifa(tarifa_id)"),
]


def migriraj(konekcija):
    konekcija.execute("BEGIN")
    try:
        konekcija.execute(TABELA_TARIFA)
        konekcija.executemany("INSERT OR IGNORE INTO tarifa (tarifa_id, naziv, stopa, vrsta) VALUES (?,?,?,?)", TARIFE)
        postojece = {r[1] for r in konekcija.execute("PRAGMA table_info(stavka_ulaza)")}
        for ime, tip in NOVE_KOLONE:
            if ime not in postojece:
                konekcija.execute(f"ALTER TABLE stavka_ulaza ADD COLUMN {ime} {tip}")
        konekcija.execute("UPDATE stavka_ulaza SET cena_pre_rabata = nabavna_cena WHERE cena_pre_rabata IS NULL")
        konekcija.execute("""
            UPDATE stavka_ulaza SET tarifa_id = CASE
                WHEN pdv = 20 THEN 1 WHEN pdv = 10 THEN 2 WHEN pdv = 8 THEN 3 WHEN pdv = 0 THEN 0 END
            WHERE tarifa_id IS NULL""")
        konekcija.execute("COMMIT")
    except Exception:
        konekcija.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    import backup_baze
    backup_baze.napravi_kopiju("pre-migracije-tarife_rabati")   # kopija baze pre izmene
    k = konektuj_se()
    k.isolation_level = None
    migriraj(k)
    print("Tarife:", k.execute("SELECT COUNT(*) FROM tarifa").fetchone()[0])
    print("Stavke bez tarife:", k.execute("SELECT COUNT(*) FROM stavka_ulaza WHERE tarifa_id IS NULL").fetchone()[0])
    k.close()
