"""Migracija: tarifa (PDV) pripada artiklu.

  artikal.tarifa_id: tarifa koja se bira pri pravljenju artikla (stranica Artikli ili nov artikal
  u ulazu robe). U stavci ulaza tarifa se samo prikazuje (sivo polje) i upisuje se tarifa artikla.

Postojeći artikli dobijaju tarifu iz poslednje stavke ulaza tog artikla, a ako ulaza nema, 1
(dobra, opšta stopa 20%). Može da se pokrene više puta.
"""
from db import konektuj_se


def migriraj(konekcija):
    konekcija.execute("BEGIN")
    try:
        kolone = {r[1] for r in konekcija.execute("PRAGMA table_info(artikal)")}
        if "tarifa_id" not in kolone:
            # Kolona sa REFERENCES u ALTER TABLE mora imati podrazumevano NULL; popunjava se odmah ispod
            konekcija.execute("ALTER TABLE artikal ADD COLUMN tarifa_id INTEGER REFERENCES tarifa(tarifa_id)")
        konekcija.execute("""
            UPDATE artikal SET tarifa_id = COALESCE(
                (SELECT s.tarifa_id FROM stavka_ulaza s
                 WHERE s.sifra_lokalna = artikal.sifra AND s.tarifa_id IS NOT NULL
                 ORDER BY s.ulaz_id DESC, s.stavka_id DESC LIMIT 1),
                1)
            WHERE tarifa_id IS NULL""")
        konekcija.execute("COMMIT")
    except Exception:
        konekcija.execute("ROLLBACK")
        raise


if __name__ == "__main__":
    k = konektuj_se()
    k.isolation_level = None
    migriraj(k)
    print("Artikli po tarifi:", k.execute(
        "SELECT tarifa_id, COUNT(*) FROM artikal GROUP BY tarifa_id").fetchall())
    print("integritet:", k.execute("PRAGMA integrity_check").fetchone()[0], k.execute("PRAGMA foreign_key_check").fetchall())
    k.close()
