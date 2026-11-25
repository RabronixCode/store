import traceback

from fastapi import Cookie, Depends, FastAPI, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated
import sqlite3
from datetime import date, datetime, timedelta
import secrets
import unicodedata

from Errors.NotAdultError import NotAdultError
from Errors.DuplicateInputError import DuplicateInputError
from Errors.BadCredentials import BadCredentials
from Errors.ForbiddenAccess import ForbiddenAccess
from Errors.NotLoggedIn import NotLoggedIn

from db import konektuj_se
from dobavljaci import sacuvaj_dobavljaca, pregled_dobavljaca, jedan_dobavljac, naziv_zauzet, promeni_naziv_dobavljaca, artikli_dobavljaca
from korisnici import proveri_korisnika
from ulazi import sacuvaj_ulaz, proveri_postojanje, sacuvaj_stavka_ulaza
from artikli import sacuvaj_artikal, sacuvaj_dobavljac_artikal, azuriraj_ponderisanu_cenu, prikazi_artikle, azuriraj_stanje
from artikli import svi_artikli, jedan_artikal, izmeni_artikal, dodaj_jedan_artikal, artikal_postoji
from lozinke import hash_password, verifikuj
from sesije import napravi_sesiju, sesija_gotova, proveri_kolacic_vrati_rolu
from racuni import sacuvaj_racun, vrati_artikal_za_racun, sacuvaj_stavka_racuna
from racun_pdf import izdaj_racun


class Dobavljac(BaseModel):
    naziv: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

class Ulaz(BaseModel):
    dobavljac_id: int
    racun_broj: str
    racun_poziv_na_broj: str
    datum_vreme: date | None = None
    stavke: list

class Stavka(BaseModel):
    stavke: list

class Artikal(BaseModel):
    naziv: str
    kategorija: str
    bar_kod: str
    prodajna_cena: float
    jedinica_mere: str
    nabavna_cena: float
    dobavljac_id: int
    pdv: float
    sifra_dobavljac: int
    minimalno_stanje: Annotated[float, Field(ge=0)] = 0
    # Ako je popunjeno: artikal kod nas VEĆ postoji (npr. dodat na stranici Artikli),
    # pa se samo povezuje sa dobavljačem, umesto da se pravi novi (duplikat).
    sifra_lokalna: int | None = None

TekstObavezan = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
TekstNeobavezan = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

class NoviArtikal(BaseModel):
    naziv: TekstObavezan
    kategorija: TekstNeobavezan = ""
    bar_kod: TekstNeobavezan = ""
    prodajna_cena: Annotated[float, Field(ge=0)] = 0
    jedinica_mere: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    minimalno_stanje: Annotated[float, Field(ge=0)] = 0
    aktivan: bool = True

class IzmenaArtikla(BaseModel):
    # Šalje se samo polje koje se menja; ostala ostaju kakva jesu.
    naziv: TekstObavezan | None = None
    kategorija: TekstNeobavezan | None = None
    bar_kod: TekstNeobavezan | None = None
    jedinica_mere: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)] | None = None
    minimalno_stanje: Annotated[float, Field(ge=0)] | None = None
    aktivan: bool | None = None

class Korisnik(BaseModel):
    username: str
    password: str

class StavkaKorpe(BaseModel):
    sifra: int
    kolicina: float

class Kupovina(BaseModel):
    stavke: list[StavkaKorpe]


app = FastAPI()
app.frontend("/", directory="static", check_dir=True, fallback=None)


origins = [
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# @app.middleware("http")
# async def add_no_cache_headers(request: Request, call_next):
#     response = await call_next(request)
#     response.headers["Cache-Control"] = (
#         "no-store"
#     )
#     return response

def trenutni_korisnik(trenutna_sesija: str | None = Cookie(default=None)):
    if trenutna_sesija:
        konekcija = konektuj_se()
        rola = proveri_kolacic_vrati_rolu(konekcija, trenutna_sesija)
        if rola:
            return rola
        else:
            raise ForbiddenAccess()
    else:
        raise NotLoggedIn()
    # kolacic = proveri_kolacic(konekcija, trenutna_sesija, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    # print(kolacic, "KOLACIC")
    # if kolacic:
    #     rola = vrati_rolu(konekcija, trenutna_sesija)
    #     print(rola, "ROLA")
    #     if rola:
    #         return rola
    #     else:
    #         raise ForbiddenAccess()
    # else:
    #     raise ForbiddenAccess()



# PREUSMERAVANJE

@app.get("/vlasnik/dobavljaci.html")
async def stranica_dobavljaci(korisnik = Depends(trenutni_korisnik)):
    print("USAO U DOBAVLJACE")
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/dobavljaci.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

@app.get("/vlasnik/ulaz.html")
async def stranica_ulazi(korisnik = Depends(trenutni_korisnik)):
    print("USAO U ULAZ")
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/ulaz.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

@app.get("/vlasnik/dobavljac.html")
async def stranica_dobavljac(korisnik = Depends(trenutni_korisnik)):
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/dobavljac.html", headers={"Cache-Control": "no-store"})
    else:
        raise ForbiddenAccess()

@app.get("/vlasnik/artikli.html")
async def stranica_artikli(korisnik = Depends(trenutni_korisnik)):
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/artikli.html", headers={"Cache-Control": "no-store"})
    else:
        raise ForbiddenAccess()

@app.get("/pocetna.html")
async def stranica_pocetna(korisnik = Depends(trenutni_korisnik)):
    print("USAO U ULAZ")
    if korisnik == 'vlasnik':
        return FileResponse("static/pocetna.html", headers={"Cache-Control": "no-store"})
    elif korisnik == 'kasir':
        return FileResponse("kasa/kasa.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

@app.get("/kasa/kasa.html")
async def stranica_kasa(korisnik = Depends(trenutni_korisnik)):
    print("USAO U ULAZ")
    if korisnik == 'kasir':
        return FileResponse("kasa/kasa.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE KASIR")
# RUTE

@app.get("/dobavljaci")
async def lista_dobavljaca(korisnik = Depends(trenutni_korisnik)):
    konekcija = konektuj_se()
    konekcija.row_factory = sqlite3.Row
    veza = konekcija.cursor()
    dobavljaci = veza.execute("SELECT * FROM dobavljac").fetchall()
    return dobavljaci

@app.post("/dobavljaci")
async def kreiraj_dobavljaca(dobavljac: Dobavljac, korisnik = Depends(trenutni_korisnik)):
    proveri_duplikat(dobavljac)
    unesi_dobavljaca(dobavljac)
    return "Dobavljac sacuvan!"

# Stranica Dobavljači (samo vlasnik)

@app.get("/dobavljaci/pregled")
async def pregled_svih_dobavljaca(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return citaj_iz_baze(pregled_dobavljaca)

@app.patch("/dobavljaci/{dobavljac_id}")
async def promeni_dobavljaca(dobavljac_id: int, dobavljac: Dobavljac, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return sacuvaj_naziv_dobavljaca(dobavljac_id, dobavljac.naziv)

@app.get("/dobavljaci/{dobavljac_id}/artikli")
async def artikli_jednog_dobavljaca(dobavljac_id: int, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    dobavljac = citaj_iz_baze(jedan_dobavljac, dobavljac_id)
    if not dobavljac:
        return JSONResponse(status_code=404, content="Taj dobavljač ne postoji.")
    return {"dobavljac": dobavljac, "artikli": citaj_iz_baze(artikli_dobavljaca, dobavljac_id)}

@app.post("/ulazi")
async def kreiraj_ulaz(ulaz: Ulaz, korisnik = Depends(trenutni_korisnik)):
    unesi_ulaz(ulaz)
    return "Ulaz uspesno unet!"

@app.post("/provera-stavki")
async def proveri_stavke(stavke: Stavka, korisnik = Depends(trenutni_korisnik)):
    stavke_fale = ne_postoji(stavke.stavke)
    return stavke_fale

@app.post('/novi-artikli')
async def kreiraj_artikal(artikli: list[Artikal], korisnik = Depends(trenutni_korisnik)):
    print(artikli)
    unesi_artikle(artikli)
    return "Novi artikli uspesno uneti!"

@app.get('/provera-broj-racuna')
async def proveri_broj_racuna(dobavljac_id: str, racun_broj: str, korisnik = Depends(trenutni_korisnik)):
    return broj_racuna_postoji(dobavljac_id, racun_broj)

@app.get('/artikli')
async def pretrazi_artikle(request: Request, korisnik = Depends(trenutni_korisnik)):
    return vrati_artikle(request.query_params['q'], request.query_params['limit'])

# Stranica Artikli (samo vlasnik)

@app.get('/artikli/svi')
async def lista_svih_artikala(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return vrati_sve_artikle()

@app.post('/artikli')
async def kreiraj_jedan_artikal(artikal: NoviArtikal, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return unesi_jedan_artikal(artikal)

@app.patch('/artikli/{sifra}')
async def promeni_artikal(sifra: int, izmena: IzmenaArtikla, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return sacuvaj_izmenu_artikla(sifra, izmena)

@app.post('/racuni')
async def kreiraj_racun(kupovina: Kupovina, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'kasir':
        raise ForbiddenAccess()
    return unesi_racun(kupovina)

@app.post('/login')
async def proveri_login(korisnik: Korisnik, response: Response):
    sesija_id = korisnik_postoji(korisnik)
    if sesija_id:
        response.set_cookie(
            key="trenutna_sesija",
            value=sesija_id,
            httponly=True,
            samesite="lax",
            max_age=28800,
            secure=True
        )
        return "AAAA"

@app.get('/logout')
async def odjavi_se(request: Request, response: Response):
    zavrsi_sesiju(request.cookies.get('trenutna_sesija'))
    response.delete_cookie(key="trenutna_sesija")
    
    return True

# @app.get('/ja')
# async def autentikacija(request: Request):
#     proveri_autentikaciju(request)

# EXCEPTION-i

@app.exception_handler(NotAdultError)
def obradjivac_godina(request, e: NotAdultError):
    return JSONResponse(status_code=409, content=e.message)

@app.exception_handler(DuplicateInputError)
def obradjivac_duplikata(request, e: DuplicateInputError):
    return JSONResponse(status_code=409, content=e.message)

@app.exception_handler(BadCredentials)
def obradjivac_nepostojecih_korisnika(request, e: BadCredentials):
    return JSONResponse(status_code=401, content=e.message)

@app.exception_handler(ForbiddenAccess)
def obradjivac_zabrane_pristupa(request, e: ForbiddenAccess):
    if request.url.path.endswith(".html"):
        return RedirectResponse('/login.html?greska=sesija')
    return JSONResponse(status_code=403, content=e.message)

@app.exception_handler(NotLoggedIn)
def obradjivac_korisnickog_logovanja(request, e: NotLoggedIn):
    if request.url.path.endswith(".html"):
        return RedirectResponse('/login.html?greska=korisnik')
    return JSONResponse(status_code=401, content=e.message)

# FUNKCIJE

def proveri_duplikat(podatak: object):
    konekcija = konektuj_se()
    veza = konekcija.cursor()
    if (type(podatak) == Dobavljac):
        upit = "SELECT * FROM dobavljac WHERE naziv=?"
        vrednosti = (podatak.naziv,)
        rezultat = veza.execute(upit, vrednosti).fetchone()
    else:
        print("NIJE DOBAR PODATAK")
    if rezultat:
        raise DuplicateInputError()

def punoletan(datum_rodjenja: date):
    now = datetime.now()
    godine = now.year - datum_rodjenja.year
    if godine < 18:
        raise NotAdultError()
    elif godine == 18 and (datum_rodjenja.month, datum_rodjenja.day) > (now.month, now.day):
        raise NotAdultError()
    else:
        return True

def unesi_dobavljaca(d: Dobavljac):
    try:
        konekcija = konektuj_se()
        sacuvaj_dobavljaca(konekcija, d.naziv) # iz DOBAVLJACI.py
        konekcija.commit()
    except Exception as e:
        print(e)
    finally:
        konekcija.close()

def unesi_ulaz(u: Ulaz):
    try:
        konekcija = konektuj_se()
        ulaz_id = sacuvaj_ulaz(konekcija, u.dobavljac_id, u.racun_broj, u.racun_poziv_na_broj, u.datum_vreme)
        for stavka in u.stavke:
            sifra_artikal = proveri_postojanje(konekcija, stavka['sifra'], stavka['dobavljac_id'])
            sacuvaj_stavka_ulaza(konekcija, ulaz_id, u.dobavljac_id, stavka, sifra_artikal[0])
            azuriraj_ponderisanu_cenu(konekcija, sifra_artikal[0], stavka['kolicina'], stavka['nabavna_cena'])
        konekcija.commit()
    except sqlite3.IntegrityError as e:
        err_code = e.sqlite_errorcode
        if err_code == sqlite3.SQLITE_CONSTRAINT_UNIQUE:
            konekcija.rollback()
            raise DuplicateInputError()
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise  
    finally:
        konekcija.close()


def ne_postoji(stavke):
    try:
        konekcija = konektuj_se()
        stavke_fale = []
        for stavka in stavke:
            provera = proveri_postojanje(konekcija, stavka['sifra'], stavka['dobavljac_id'])
            if not provera:
                stavke_fale.append(stavka)
        return stavke_fale
    except sqlite3.Error as e:
        print(type(e).__name__, e.sqlite_errorcode, e.sqlite_errorname)
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise  
    finally:
        konekcija.close()

def unesi_artikle(artikli: list[Artikal]):
    try:
        konekcija = konektuj_se()
        for a in artikli:
            if a.sifra_lokalna is not None:
                # Artikal već postoji kod nas: samo ga povezujemo sa šifrom dobavljača
                if not artikal_postoji(konekcija, a.sifra_lokalna):
                    konekcija.rollback()
                    raise DuplicateInputError(f"Artikal sa našom šifrom {a.sifra_lokalna} ne postoji!")
                sifra = a.sifra_lokalna
            else:
                sifra = sacuvaj_artikal(konekcija, a)
            sacuvaj_dobavljac_artikal(konekcija, sifra, a.sifra_dobavljac, a.dobavljac_id, a.naziv, a.nabavna_cena, a.pdv)
        konekcija.commit()
    except sqlite3.IntegrityError as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        raise DuplicateInputError("Taj artikal je već povezan sa ovim dobavljačem (pod drugom šifrom dobavljača)!")
    except sqlite3.Error as e:
        print(type(e).__name__, e.sqlite_errorcode, e.sqlite_errorname)
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
    finally:
        konekcija.close()
    
def broj_racuna_postoji(dobavljac_id, broj_racuna):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        veza = konekcija.cursor()
        upit = "SELECT * FROM ulaz WHERE dobavljac_id = ? AND racun_broj = ?"
        vrednosti = (dobavljac_id, broj_racuna)
        rezultat = veza.execute(upit, vrednosti).fetchall()
        print(rezultat, "REZULTAT")
        if len(rezultat) > 0:
            raise DuplicateInputError("Racun/otpremnica sa tim brojem vec postoji!")
        else:
            return False
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
    finally:
        konekcija.close()


def korisnik_postoji(k):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        rezultat = proveri_korisnika(konekcija, k)
        if len(rezultat) > 0 and verifikuj(k.password, rezultat[0][1]):
            sesija_id = secrets.token_urlsafe(64)
            print(sesija_id)
            napravi_sesiju(konekcija, rezultat[0][0], sesija_id, datetime.now(), datetime.now() + timedelta(hours=8))
            konekcija.commit()
            return sesija_id
        else:
            raise BadCredentials()
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
    finally:
        konekcija.close()

def zavrsi_sesiju(trenutna_sesija):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        print(trenutna_sesija)
        sesija_gotova(konekcija, trenutna_sesija, datetime.now())
        konekcija.commit()
    except Exception:
        raise
    finally:
        konekcija.close()

def vrati_artikle(text, limit):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row

        artikli = prikazi_artikle(konekcija, za_like(text), limit)
        print(artikli)
        return artikli
    except:
        raise
    finally:
        konekcija.close()

def citaj_iz_baze(funkcija, *argumenti):
    """Otvori konekciju, pozovi funkciju koja samo čita, zatvori konekciju."""
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        return funkcija(konekcija, *argumenti)
    finally:
        konekcija.close()

def sacuvaj_naziv_dobavljaca(dobavljac_id, naziv):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        if naziv_zauzet(konekcija, naziv, dobavljac_id):
            raise DuplicateInputError(f"Dobavljač „{naziv}“ već postoji!")
        if promeni_naziv_dobavljaca(konekcija, dobavljac_id, naziv) == 0:
            return JSONResponse(status_code=404, content="Taj dobavljač ne postoji.")
        konekcija.commit()
        return jedan_dobavljac(konekcija, dobavljac_id)
    except Exception:
        konekcija.rollback()
        raise
    finally:
        konekcija.close()

def vrati_sve_artikle():
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        return svi_artikli(konekcija)
    finally:
        konekcija.close()

def unesi_jedan_artikal(a: NoviArtikal):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        sifra = dodaj_jedan_artikal(
            konekcija, a.naziv, a.kategorija or None, a.bar_kod or None,
            a.prodajna_cena, a.jedinica_mere, 1 if a.aktivan else 0, a.minimalno_stanje
        )
        konekcija.commit()
        return jedan_artikal(konekcija, sifra)
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

def sacuvaj_izmenu_artikla(sifra, izmena: IzmenaArtikla):
    izmene = izmena.model_dump(exclude_unset=True)
    # Kolone koje ne smeju biti prazne: null znači "nije poslato", ne "obriši"
    izmene = {k: v for k, v in izmene.items() if not (v is None and k in ("naziv", "jedinica_mere", "minimalno_stanje", "aktivan"))}
    if "aktivan" in izmene:
        izmene["aktivan"] = 1 if izmene["aktivan"] else 0
    for k in ("kategorija", "bar_kod"):
        if k in izmene and not izmene[k]:
            izmene[k] = None   # prazno polje se čuva kao NULL
    if not izmene:
        return JSONResponse(status_code=400, content="Nema izmena.")

    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        if izmeni_artikal(konekcija, sifra, izmene) == 0:
            return JSONResponse(status_code=404, content=f"Artikal sa šifrom {sifra} ne postoji.")
        konekcija.commit()
        return jedan_artikal(konekcija, sifra)
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

def unesi_racun(kupovina: Kupovina):
    # Cena i nabavna cena se uzimaju iz baze, ne sa stranice (da se ne bi mogle podmetnuti)
    if len(kupovina.stavke) == 0:
        return JSONResponse(status_code=400, content="Korpa je prazna.")
    for s in kupovina.stavke:
        if s.kolicina <= 0:
            return JSONResponse(status_code=400, content=f"Količina za šifru {s.sifra} mora biti veća od 0.")

    try:
        konekcija = konektuj_se()
        korisnik = "kasir"   # TODO: kasnije uzeti iz sesije
        racun_id, datum_vreme = sacuvaj_racun(konekcija, korisnik)

        stavke_racuna = []
        for s in kupovina.stavke:
            artikal = vrati_artikal_za_racun(konekcija, s.sifra)
            if not artikal:
                konekcija.rollback()
                return JSONResponse(status_code=404, content=f"Artikal sa šifrom {s.sifra} ne postoji.")
            sifra, naziv, jedinica_mere, prodajna_cena, nabavna_cena, aktivan = artikal
            if not aktivan:
                # Npr. vlasnik ga je isključio dok je već bio u korpi
                konekcija.rollback()
                return JSONResponse(status_code=409, content=f"Artikal „{naziv}“ (šifra {sifra}) više nije aktivan. Izbaci ga iz korpe.")
            sacuvaj_stavka_racuna(konekcija, racun_id, sifra, naziv, jedinica_mere, s.kolicina, prodajna_cena, nabavna_cena)
            azuriraj_stanje(konekcija, -s.kolicina, sifra)   # prodato se skida sa stanja
            stavke_racuna.append({
                "sifra": sifra,
                "naziv": naziv,
                "jedinica_mere": jedinica_mere,
                "kolicina": s.kolicina,
                "cena_po_komadu": prodajna_cena,
            })

        konekcija.commit()
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

    # Račun je već sačuvan u bazi; ako PDF ne uspe, to ne poništava prodaju
    try:
        putanja = izdaj_racun(racun_id, datum_vreme, korisnik, stavke_racuna)
        pdf = putanja.name
    except Exception as e:
        print(type(e).__name__, e)
        traceback.print_exc()
        pdf = None

    return {"racun_id": racun_id, "pdf": pdf}

# TEKST

def normalizuj(tekst):
    if tekst is None:
        return ""
    tekst = tekst.lower().replace("đ", "dj")   # đ nema razlaganje, mora ručno
    razlozeno = unicodedata.normalize("NFD", tekst)
    return "".join(c for c in razlozeno if not unicodedata.combining(c))

def za_like(tekst):
    tekst = normalizuj(tekst)
    return tekst.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")