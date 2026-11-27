"""Backup baze prodavnica.db.

Pokretanje:
    python backup_baze.py                         # dnevni backup (Windows ga pokreće svako veče u 22:00)
    python backup_baze.py --razlog pre-migracije  # posebna kopija, npr. pre izmene baze

Šta radi:
  1. Pravi ispravnu kopiju baze i dok server radi (SQLite backup, ne obično kopiranje fajla,
     koje bi moglo da uhvati bazu usred upisa računa).
  2. Proverava kopiju (PRAGMA integrity_check). Neispravna kopija se briše i javlja se greška.
  3. Kopiju stavlja u LOKALNI folder i u OneDrive folder (OneDrive je sam šalje u oblak).
  4. Briše stare dnevne kopije: čuva 14 dnevnih, 8 nedeljnih i 12 mesečnih.
     Kopije "pre-..." (pre migracija) čuvaju se posebno, poslednjih 20.
  5. Sve upisuje u backup.log u lokalnom folderu.

Vraćanje: ugasi server, iskopiraj izabranu kopiju preko prodavnica.db, upali server.
"""
import argparse
import os
import re
import shutil
import sqlite3
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------- Podešavanja ----------
BAZA = Path(__file__).resolve().parent / "prodavnica.db"
LOKALNI_FOLDER = Path.home() / "ProdavnicaBackup"
_onedrive = os.environ.get("OneDrive") or os.environ.get("OneDriveConsumer")
ONEDRIVE_FOLDER = Path(_onedrive) / "Prodavnica backup" if _onedrive else None   # None = bez kopije u oblaku
CUVAJ_DNEVNIH, CUVAJ_NEDELJNIH, CUVAJ_MESECNIH = 14, 8, 12
CUVAJ_POSEBNIH = 20

IME = re.compile(r"^prodavnica_(\d{4}-\d{2}-\d{2})_(\d{4})(?:_(.+))?\.db$")


def _log(poruka):
    LOKALNI_FOLDER.mkdir(parents=True, exist_ok=True)
    red = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {poruka}"
    print(red)
    with open(LOKALNI_FOLDER / "backup.log", "a", encoding="utf-8") as f:
        f.write(red + "\n")


def _proveri(putanja):
    k = sqlite3.connect(f"file:{putanja}?mode=ro", uri=True)
    try:
        rezultat = k.execute("PRAGMA integrity_check").fetchone()[0]
        racuna = k.execute("SELECT COUNT(*) FROM racun").fetchone()[0]
        artikala = k.execute("SELECT COUNT(*) FROM artikal").fetchone()[0]
    finally:
        k.close()
    if rezultat != "ok":
        raise RuntimeError(f"kopija nije ispravna: {rezultat}")
    return racuna, artikala


def _ociscen_razlog(razlog):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", razlog).strip("-")[:40] if razlog else ""


def napravi_kopiju(razlog=""):
    """Napravi i proveri kopiju; vrati putanju lokalne kopije. Baca izuzetak ako ne uspe."""
    if not BAZA.exists():
        raise FileNotFoundError(f"baza ne postoji: {BAZA}")
    razlog = _ociscen_razlog(razlog)
    ime = f"prodavnica_{datetime.now():%Y-%m-%d_%H%M}{'_' + razlog if razlog else ''}.db"
    LOKALNI_FOLDER.mkdir(parents=True, exist_ok=True)
    cilj = LOKALNI_FOLDER / ime
    privremeni = cilj.with_suffix(".db.tmp")

    try:
        izvor = sqlite3.connect(f"file:{BAZA}?mode=ro", uri=True)
        odrediste = sqlite3.connect(privremeni)
        try:
            izvor.backup(odrediste)      # ispravna kopija i dok server upisuje
        finally:
            odrediste.close()
            izvor.close()
        racuna, artikala = _proveri(privremeni)
    except Exception:
        privremeni.unlink(missing_ok=True)   # nikad ne ostaje polovična kopija
        raise
    os.replace(privremeni, cilj)
    velicina = cilj.stat().st_size / 1024
    _log(f"OK  {cilj}  ({velicina:.0f} KB, računa {racuna}, artikala {artikala})")

    if ONEDRIVE_FOLDER:
        try:
            ONEDRIVE_FOLDER.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cilj, ONEDRIVE_FOLDER / ime)
            _log(f"OK  kopija u OneDrive: {ONEDRIVE_FOLDER / ime}")
        except Exception as e:           # lokalna kopija postoji; oblak se javlja kao greška
            _log(f"GREŠKA  OneDrive kopija nije uspela: {e}")
    return cilj


def koje_brisati(imena, danas=None):
    """Od naziva kopija vrati one koje treba obrisati (pravilo 14 dnevnih / 8 nedeljnih / 12 mesečnih;
    posebne kopije "pre-..." poslednjih 20). Nepoznata imena se ne diraju."""
    danas = danas or date.today()
    redovne, posebne = [], []
    for ime in imena:
        m = IME.match(ime)
        if not m:
            continue
        kada = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H%M")
        (posebne if m.group(3) else redovne).append((kada, ime))
    redovne.sort(reverse=True)
    posebne.sort(reverse=True)

    zadrzi = {ime for _, ime in posebne[:CUVAJ_POSEBNIH]}
    if redovne:
        zadrzi.add(redovne[0][1])                              # najnovija uvek ostaje
    vidjeno = {"dan": set(), "nedelja": set(), "mesec": set()}
    for kada, ime in redovne:                                  # od najnovije: prva u svakom periodu ostaje
        d = kada.date()
        kljucevi = {
            "dan": (d, (danas - d).days < CUVAJ_DNEVNIH),
            "nedelja": (d.isocalendar()[:2], (danas - d).days < CUVAJ_NEDELJNIH * 7),
            "mesec": ((d.year, d.month), (danas.year - d.year) * 12 + danas.month - d.month < CUVAJ_MESECNIH),
        }
        for vrsta, (kljuc, u_roku) in kljucevi.items():
            if u_roku and kljuc not in vidjeno[vrsta]:
                vidjeno[vrsta].add(kljuc)
                zadrzi.add(ime)
    return sorted(ime for _, ime in redovne + posebne if ime not in zadrzi)


def ocisti_stare(folder):
    if not folder or not folder.exists():
        return
    for ime in koje_brisati([p.name for p in folder.iterdir() if p.is_file()]):
        (folder / ime).unlink()
        _log(f"obrisana stara kopija {folder / ime}")


def main():
    argumenti = argparse.ArgumentParser(description="Backup baze prodavnica.db")
    argumenti.add_argument("--razlog", default="", help="npr. pre-migracije (takve kopije se čuvaju posebno)")
    a = argumenti.parse_args()
    try:
        napravi_kopiju(a.razlog)
        ocisti_stare(LOKALNI_FOLDER)
        ocisti_stare(ONEDRIVE_FOLDER)
        return 0
    except Exception as e:
        _log(f"GREŠKA  backup nije uspeo: {type(e).__name__}: {e}")
        _log(traceback.format_exc().strip().replace("\n", " | "))
        return 1


if __name__ == "__main__":
    sys.exit(main())
