"""Migracija: PDV stopa na stavci računa (za Finansije: porez u prodajnoj vrednosti).

  stavka_racuna.pdv: PDV stopa (%) artikla u trenutku prodaje. Stare stavke dobijaju stopu
  iz trenutne tarife artikla (ili 20% ako artikal nema tarifu).

Može da se pokrene više puta.
"""
from db import konektuj_se


def migriraj(konekcija):
    konekcija.execute("BEGIN")
    try:
        kolone = {r[1] for r in konekcija.execute("PRAGMA table_info(stavka_racuna)")}
        if "pdv" not in kolone:
            konekcija.execute("ALTER TABLE stavka_racuna ADD COLUMN pdv REAL CHECK (pdv >= 0)")
        konekcija.execute("""
            UPDATE stavka_racuna SET pdv = COALESCE(
                (SELECT t.stopa FROM artikal a JOIN tarifa t ON t.tarifa_id = a.tarifa_id
                 WHERE a.sifra = stavka_racuna.sifra), 20)
            WHERE pdv IS NULL""")
        konekcija.execute("COMMIT")
    except Exception:
        konekcija.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    import backup_baze
    backup_baze.napravi_kopiju("pre-migracije-pdv_prodaje")   # kopija baze pre izmene
    k = konektuj_se()
    k.isolation_level = None
    migriraj(k)
    print("Stavke po PDV:", k.execute("SELECT pdv, COUNT(*) FROM stavka_racuna GROUP BY pdv").fetchall())
    print("integritet:", k.execute("PRAGMA integrity_check").fetchone()[0], k.execute("PRAGMA foreign_key_check").fetchall())
    k.close()
