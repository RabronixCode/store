// ---------- Novi ulaz robe (vlasnik) ----------
//
// Ugovor sa serverom:
//   GET  /dobavljaci                                  -> [{ dobavljac_id, naziv }]
//   GET  /ulazi/artikli?q=&limit=50                   -> [{ sifra, naziv, jedinica_mere, stanje, aktivan,
//                                                          prodajna_cena, nabavna_cena_ponderisana }]
//   GET  /ulazi/veza?dobavljac_id=&sifra_artikal=     -> { ...isto kao gore, povezan,
//   GET  /ulazi/veza?dobavljac_id=&sifra_dobavljac=        sifra_dobavljac, nabavna_cena, pdv } ili null
//   GET  /ulazi/provera-dokumenta?dobavljac_id=&racun_broj=&otpremnica_broj=  -> { poruke: [...] }
//   POST /ulazi  telo: { dobavljac_id, racun_broj, racun_poziv_na_broj, ulaz_datum, otpremnica_broj,
//                        otpremnica_datum, valuta_datum,
//                        stavke: [{ sifra_artikal | novi_artikal, sifra_dobavljac, kolicina,
//                                   nabavna_cena (jedan artikal, bez PDV, PRE rabata), rabat_osnovni,
//                                   rabat_posebni, rabat_dodatni, tarifa_id,
//                                   prodajna_cena (sa PDV; null = postojećem artiklu se ne menja) }] }
//   GET  /tarife  -> [{ tarifa_id, naziv, stopa, vrsta }]
//
// Kalkulacija stavke (po jednom artiklu, sve bez PDV osim gde piše):
//   neto nabavna = nabavna × (1 − r1) × (1 − r2) × (1 − r3)      (rabati jedan na drugi)
//   rabat iznos  = nabavna − neto;  neto nab. vrednost = količina × neto
//   prenet PDV   = neto × stopa;    dobavljaču = neto + prenet PDV
//   kalk. cena   = nabavna (pre rabata) × (1 + stopa)
//   osnovica     = prodajna / (1 + stopa)
//   marža iznos  = osnovica − neto; marža % = marža iznos / neto × 100
//                -> { ulaz_id }
//   GET  /asistent/nacrt/<token>  -> nacrt ulaza koji je asistent izvukao iz dokumenta (?nacrt=<token>)
// Server proverava SVE ponovo; provere ovde su samo da korisnik odmah vidi grešku.

const forma = document.getElementById('forma-ulaz');
const dobavljacPolje = document.getElementById('dobavljac');
const stavkeOkvir = document.getElementById('stavke');
const sablonStavka = document.getElementById('stavka-sablon');
const sablonRezultat = document.getElementById('rezultat-sablon');
const poruka = document.getElementById('poruka');
const dugmeSacuvaj = document.getElementById('sacuvaj');

const MAX_REZULTATA = 50;
const KASNJENJE_MS = 200;
const NAJRANIJI_DATUM = '2000-01-01';

let cuvanjeUToku = false;
let tarife = [];            // iz /tarife; podrazumevana je 1 (dobra, opšta stopa 20%)
const PODRAZUMEVANA_TARIFA = 1;
let izmenjeno = false;      // ima nesačuvanih podataka (upozorenje pri napuštanju stranice)


// ---------- Pomoćne ----------

function danas() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBroj(broj, decimala = 2) {
    return Number(broj).toLocaleString('sr-RS', { minimumFractionDigits: decimala, maximumFractionDigits: decimala });
}

function formatKolicina(broj) {
    return Number(broj).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
}

function normalizuj(tekst) {
    return String(tekst ?? '').toLowerCase().replaceAll('đ', 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// "12,5" i "12.5" su isti broj; prazno -> null; nije broj -> NaN
function procitajBroj(input) {
    const tekst = input.value.trim().replace(',', '.');
    if (tekst === '') return null;
    return Number(tekst);
}

function javi(tekst, vrsta = '') {
    poruka.replaceChildren(tekst);
    poruka.className = vrsta;
}

async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu radnju. Prijavi se ponovo kao vlasnik.');
    const podaci = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof podaci === 'string' ? podaci : podrazumevanaGreska);
    return podaci;
}

function porukaGreske(greska) {
    return greska.message === 'Failed to fetch' ? 'Nema veze sa serverom. Ništa nije sačuvano.' : greska.message;
}

function polje(ime) {
    return forma.elements[ime];
}


// ---------- Greške uz polja ----------

function postaviGresku(ime, tekst) {
    const el = polje(ime);
    const mesto = forma.querySelector(`.greska-polja[data-za="${ime}"]`);
    if (mesto) mesto.textContent = tekst;
    if (el) el.setAttribute('aria-invalid', tekst ? 'true' : 'false');
}

function greskaStavke(red, tekst, input = null) {
    red.querySelector('.greska-stavke').textContent = tekst;
    red.classList.toggle('ima-gresku', Boolean(tekst));
    red.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (input) input.setAttribute('aria-invalid', 'true');
}

function ocistiGreske() {
    forma.querySelectorAll('.greska-polja').forEach((el) => { el.textContent = ''; });
    forma.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    stavkeOkvir.querySelectorAll('.stavka').forEach((red) => greskaStavke(red, ''));
}


// ---------- Dobavljači ----------

async function ucitajDobavljace() {
    try {
        const lista = await procitaj(await fetch('/dobavljaci'), 'Dobavljači ne mogu da se učitaju.');
        dobavljacPolje.replaceChildren(new Option('Izaberi dobavljača…', ''));
        lista.forEach((d) => dobavljacPolje.add(new Option(d.naziv, d.dobavljac_id)));
        if (lista.length === 0) {
            const veza = document.createElement('a');
            veza.href = '/vlasnik/dobavljaci.html';
            veza.textContent = 'Dodaj dobavljača';
            poruka.className = 'greska';
            poruka.replaceChildren('Još nema nijednog dobavljača. ', veza, ' pa se vrati ovde.');
        }
    } catch (greska) {
        dobavljacPolje.replaceChildren(new Option('Greška pri učitavanju', ''));
        javi(porukaGreske(greska), 'greska');
    }
}

// Promena dobavljača: šifra kod dobavljača i poslednja cena zavise od njega, pa se
// za sve izabrane artikle ponovo popune (samo polja koja je program sam popunio).
dobavljacPolje.addEventListener('change', () => {
    postaviGresku('dobavljac_id', '');
    sviRedovi().forEach((red) => {
        if (red.dataset.sifra) popuniIzVeze(red, true);
    });
});


// ---------- Stavke ----------

function sviRedovi() {
    return [...stavkeOkvir.querySelectorAll('.stavka')];
}

function redniBroj(red) {
    return sviRedovi().indexOf(red) + 1;
}

function popuniTarife(select, izabrana = PODRAZUMEVANA_TARIFA) {
    select.replaceChildren(...tarife.map((t) =>
        new Option(`${t.tarifa_id}  ${formatBroj(t.stopa)}%  ${t.naziv}`, t.tarifa_id)));
    if (tarife.some((t) => t.tarifa_id === Number(izabrana))) select.value = String(izabrana);
}

function stopaReda(red) {
    const t = tarife.find((x) => String(x.tarifa_id) === red.querySelector('[name="tarifa_id"]').value);
    return t ? t.stopa / 100 : null;
}

function prenumerisi() {
    sviRedovi().forEach((r, i) => { r.querySelector('.redni-broj').textContent = i + 1; });
}

function dodajRed(fokus = false) {
    const red = sablonStavka.content.firstElementChild.cloneNode(true);
    popuniTarife(red.querySelector('[name="tarifa_id"]'));
    stavkeOkvir.appendChild(red);
    napraviPretragu(red);
    prenumerisi();
    osveziZbir();
    if (fokus) red.querySelector('.artikal-pretraga').focus();
    return red;
}

function redJePrazan(red) {
    const v = (ime) => red.querySelector(`[name="${ime}"]`).value.trim();
    return !red.dataset.sifra
        && red.querySelector('.artikal-pretraga').value.trim() === ''
        && ['sifra_dobavljac', 'kolicina', 'nabavna_cena', 'rabat_osnovni', 'rabat_posebni', 'rabat_dodatni',
            'neto_vrednost', 'marza', 'prodajna_cena'].every((ime) => v(ime) === '');
}

function postaviInfo(red, tekst, vrsta = '') {
    const info = red.querySelector('.artikal-info');
    info.textContent = tekst;
    info.className = `artikal-info ${vrsta}`.trim();
}

// Izabran postojeći artikal
function postaviArtikal(red, a, { popuniCene = true } = {}) {
    const duplikat = sviRedovi().find((r) => r !== red && Number(r.dataset.sifra) === a.sifra);
    const pretraga = red.querySelector('.artikal-pretraga');
    if (duplikat) {
        greskaStavke(red, `Artikal ${a.sifra} je već u stavci ${redniBroj(duplikat)}. Promeni količinu tamo.`, pretraga);
        return false;
    }
    greskaStavke(red, '');
    red.dataset.sifra = a.sifra;
    red.classList.remove('nov-artikal');
    delete red._noviArtikal;
    // Za maržu: trenutno stanje, prosečna nabavna i prodajna cena artikla
    red._artikal = {
        naziv: a.naziv || '',
        bar_kod: a.bar_kod || '',
        jm: a.jedinica_mere || '',
        stanje: Number(a.stanje) || 0,
        prosek: Number(a.nabavna_cena_ponderisana) || 0,
        prodajna: Number(a.prodajna_cena) || 0
    };
    prikaziArtikal(red);
    const prodajna = red.querySelector('[name="prodajna_cena"]');
    if (prodajna.value.trim() === '' || prodajna.dataset.auto === '1') {
        prodajna.value = red._artikal.prodajna;
        prodajna.dataset.auto = '1';
    }
    pretraga.value = `${a.sifra} – ${a.naziv || '(bez naziva)'}`;
    red.querySelector('.jm').textContent = a.jedinica_mere || '';
    const delovi = [`JM: ${a.jedinica_mere || '—'}`, `stanje: ${formatKolicina(a.stanje)}`];
    if (!a.aktivan) delovi.push('NEAKTIVAN');
    postaviInfo(red, delovi.join(' · '), a.aktivan ? 'postoji' : 'upozorenje');
    if (popuniCene) popuniIzVeze(red, false);
    osveziZbir();
    izmenjeno = true;
    return true;
}

// Korisnik menja tekst posle izbora: izbor se poništava
function ponistiArtikal(red) {
    if (!red.dataset.sifra) return;
    delete red.dataset.sifra;
    delete red._artikal;
    prikaziArtikal(red);
    const prodajna = red.querySelector('[name="prodajna_cena"]');
    if (prodajna.dataset.auto === '1') { prodajna.value = ''; delete prodajna.dataset.auto; }
    red.querySelector('.jm').textContent = '';
    postaviInfo(red, '');
    osveziZbir();
}

function oznaciKaoNov(red) {
    const tekst = red.querySelector('.artikal-pretraga').value.trim();
    if (!red.dataset.sifra && tekst) {
        red.classList.add('nov-artikal');
        if (/^\d+$/.test(tekst)) {
            // Samo cifre: verovatno je kucana šifra koja ne postoji, a ne naziv
            postaviInfo(red, `Nema artikla sa šifrom ${tekst}. Za nov artikal upiši njegov naziv.`, 'upozorenje');
        } else {
            postaviInfo(red, `NOV artikal „${tekst}“: ostale podatke unosiš pri čuvanju`, 'nov');
        }
    } else {
        red.classList.remove('nov-artikal');
        if (!red.dataset.sifra) postaviInfo(red, '');
    }
}

// Šifra kod dobavljača, nabavna cena, rabati i tarifa iz poslednjeg ulaza od izabranog dobavljača.
// Popunjava samo prazna polja ili ona koja je program već sam popunio (data-auto),
// nikad ono što je korisnik ručno upisao.
function primeniVezu(red, veza, promenjenDobavljac) {
    const upisi = (ime, vrednost) => {
        const el = red.querySelector(`[name="${ime}"]`);
        const smeDaSePromeni = el.value.trim() === '' || el.dataset.auto === '1'
            || (ime === 'tarifa_id' && el.dataset.rucno !== '1');
        if (!smeDaSePromeni) return;
        if (vrednost === null || vrednost === undefined) {
            if (promenjenDobavljac && el.dataset.auto === '1' && ime !== 'tarifa_id') { el.value = ''; delete el.dataset.auto; }
            return;
        }
        el.value = ime.startsWith('rabat_') && Number(vrednost) === 0 ? '' : vrednost;
        el.dataset.auto = '1';
    };
    upisi('sifra_dobavljac', veza.sifra_dobavljac);
    upisi('nabavna_cena', veza.nabavna_cena);
    upisi('rabat_osnovni', veza.rabat_osnovni);
    upisi('rabat_posebni', veza.rabat_posebni);
    upisi('rabat_dodatni', veza.rabat_dodatni);
    upisi('tarifa_id', veza.tarifa_id ?? tarifaZaStopu(veza.pdv));
    if (!veza.povezan) {
        const info = red.querySelector('.artikal-info');
        info.textContent += ' · prvi put od ovog dobavljača';
    }
    osveziZbir();
}

// Stare veze imaju samo PDV stopu: odgovarajuća tarifa za dobra
function tarifaZaStopu(stopa) {
    if (stopa === null || stopa === undefined) return null;
    const t = tarife.find((x) => x.vrsta === 'dobra' && x.stopa === Number(stopa));
    return t ? t.tarifa_id : null;
}

async function popuniIzVeze(red, promenjenDobavljac) {
    const dobavljacId = dobavljacPolje.value;
    if (!dobavljacId || !red.dataset.sifra) return;
    const zahtev = (red._zahtev = (red._zahtev || 0) + 1);
    try {
        const params = new URLSearchParams({ dobavljac_id: dobavljacId, sifra_artikal: red.dataset.sifra });
        const veza = await procitaj(await fetch(`/ulazi/veza?${params}`), 'Podaci o artiklu ne mogu da se učitaju.');
        if (zahtev !== red._zahtev || !veza) return;   // stigao noviji zahtev ili artikal više ne postoji
        primeniVezu(red, veza, promenjenDobavljac);
    } catch (greska) {
        greskaStavke(red, porukaGreske(greska));
    }
}

// Upisana šifra kod dobavljača, a artikal nije izabran: možda je već poznata
async function traziPoSifriDobavljaca(red) {
    const sifra = red.querySelector('[name="sifra_dobavljac"]').value.trim();
    if (red.dataset.sifra || !sifra || !dobavljacPolje.value) return;
    try {
        const params = new URLSearchParams({ dobavljac_id: dobavljacPolje.value, sifra_dobavljac: sifra });
        const a = await procitaj(await fetch(`/ulazi/veza?${params}`), 'Pretraga po šifri dobavljača ne radi.');
        if (a && !red.dataset.sifra && postaviArtikal(red, a, { popuniCene: false })) primeniVezu(red, a, false);
    } catch (greska) {
        greskaStavke(red, porukaGreske(greska));
    }
}

function ukloniRed(red) {
    red.remove();
    if (sviRedovi().length === 0) dodajRed();
    prenumerisi();
    osveziZbir();
}


// ---------- Pretraga artikla u stavci (kao na kasi) ----------

function napraviPretragu(red) {
    const polje = red.querySelector('.artikal-pretraga');
    const lista = red.querySelector('.rezultati');
    const id = `rezultati-${Math.random().toString(36).slice(2, 9)}`;
    lista.id = id;
    polje.setAttribute('aria-controls', id);

    let rezultati = [], prikazanoZa = null, aktivan = -1, tajmer = null, kontroler = null;
    let cekaEnter = false, uToku = false;

    function otvori() { lista.hidden = false; polje.setAttribute('aria-expanded', 'true'); }
    function zatvori() {
        lista.hidden = true;
        polje.setAttribute('aria-expanded', 'false');
        polje.removeAttribute('aria-activedescendant');
        aktivan = -1;
        cekaEnter = false;
    }

    function prikazi(artikli, tekst) {
        rezultati = artikli;
        prikazanoZa = tekst;
        aktivan = -1;
        lista.replaceChildren();
        if (artikli.length === 0) {
            const li = document.createElement('li');
            li.className = 'nema-rezultata';
            li.textContent = tekst ? `Nema takvog artikla – „${tekst}“ biće dodat kao NOV artikal` : 'Još nema artikala';
            lista.appendChild(li);
        } else {
            artikli.forEach((a, i) => {
                const li = sablonRezultat.content.firstElementChild.cloneNode(true);
                li.id = `${id}-${i}`;
                li.dataset.indeks = i;
                li.querySelector('[data-polje="sifra"]').textContent = a.sifra;
                li.querySelector('[data-polje="naziv"]').textContent = a.naziv || '(bez naziva)';
                li.querySelector('[data-polje="stanje"]').textContent =
                    `${formatKolicina(a.stanje)} ${a.jedinica_mere || ''}`.trim() + (a.aktivan ? '' : ' · neaktivan');
                if (!a.aktivan) li.classList.add('neaktivan');
                lista.appendChild(li);
            });
        }
        otvori();
    }

    async function ucitaj(tekst) {
        if (kontroler) kontroler.abort();
        const moj = new AbortController();
        kontroler = moj;
        uToku = true;
        try {
            const params = new URLSearchParams({ q: tekst, limit: MAX_REZULTATA });
            const artikli = await procitaj(await fetch(`/ulazi/artikli?${params}`, { signal: moj.signal }),
                                           'Pretraga artikala ne radi.');
            if (document.activeElement !== polje && !cekaEnter) return;   // korisnik je već otišao iz polja
            prikazi(artikli, tekst);
            if (cekaEnter) {
                cekaEnter = false;
                if (rezultati.length > 0) izaberi(0); else { zatvori(); predjiNaSledece(); }
            }
        } catch (greska) {
            if (greska.name === 'AbortError') return;
            zatvori();
            greskaStavke(red, porukaGreske(greska));
        } finally {
            if (kontroler === moj) uToku = false;
        }
    }

    function postaviAktivan(i) {
        const redovi = lista.querySelectorAll('.rezultat');
        if (redovi.length === 0) return;
        if (aktivan >= 0 && redovi[aktivan]) redovi[aktivan].setAttribute('aria-selected', 'false');
        aktivan = (i + redovi.length) % redovi.length;
        redovi[aktivan].setAttribute('aria-selected', 'true');
        polje.setAttribute('aria-activedescendant', redovi[aktivan].id);
        redovi[aktivan].scrollIntoView({ block: 'nearest' });
    }

    function predjiNaSledece() {
        oznaciKaoNov(red);
        red.querySelector('[name="sifra_dobavljac"]').focus();
    }

    function izaberi(i) {
        const a = rezultati[i];
        if (!a) return;
        zatvori();
        if (postaviArtikal(red, a)) red.querySelector('[name="kolicina"]').focus();
        else polje.select();
    }

    polje.addEventListener('focus', () => {
        if (!red.dataset.sifra) ucitaj(polje.value.trim());
    });
    polje.addEventListener('click', () => {
        if (lista.hidden && !uToku) ucitaj(red.dataset.sifra ? '' : polje.value.trim());
    });
    polje.addEventListener('input', () => {
        ponistiArtikal(red);
        red.classList.remove('nov-artikal');
        greskaStavke(red, '');
        izmenjeno = true;
        clearTimeout(tajmer);
        tajmer = setTimeout(() => ucitaj(polje.value.trim()), KASNJENJE_MS);
    });
    polje.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (lista.hidden) ucitaj(red.dataset.sifra ? '' : polje.value.trim());
            else postaviAktivan(aktivan + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!lista.hidden) postaviAktivan(aktivan <= 0 ? 0 : aktivan - 1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (red.dataset.sifra) { red.querySelector('[name="kolicina"]').focus(); return; }
            const tekst = polje.value.trim();
            if (!tekst) return;
            if (prikazanoZa !== tekst) {
                // Lista još ne odgovara ukucanom tekstu: sačekaj svež odgovor
                clearTimeout(tajmer);
                cekaEnter = true;
                ucitaj(tekst);
            } else if (aktivan >= 0) {
                izaberi(aktivan);
            } else {
                // Enter bez izbora strelicom: tačno poklapanje šifre ili naziva bira se samo,
                // inače se artikal tretira kao nov
                const tacno = rezultati.find((a) => String(a.sifra) === tekst || normalizuj(a.naziv) === normalizuj(tekst));
                if (tacno) izaberi(rezultati.indexOf(tacno));
                else if (rezultati.length > 0) izaberi(0);
                else { zatvori(); predjiNaSledece(); }
            }
        } else if (event.key === 'Escape') {
            zatvori();
        }
    });
    polje.addEventListener('blur', () => {
        clearTimeout(tajmer);
        // Izlazak iz polja bez izbora: ako ukucani tekst TAČNO odgovara jednom artiklu
        // (šifra ili ceo naziv), on se bira; tako se ne pravi slučajno duplikat.
        const tekst = polje.value.trim();
        if (!red.dataset.sifra && tekst && prikazanoZa === tekst) {
            const tacno = rezultati.find((a) => String(a.sifra) === tekst || normalizuj(a.naziv) === normalizuj(tekst));
            if (tacno) postaviArtikal(red, tacno);
        }
        oznaciKaoNov(red);
        zatvori();
    });
    lista.addEventListener('mousedown', (event) => event.preventDefault());
    lista.addEventListener('click', (event) => {
        const li = event.target.closest('.rezultat');
        if (li) izaberi(Number(li.dataset.indeks));
    });
}


// ---------- Događaji u stavkama ----------

stavkeOkvir.addEventListener('click', (event) => {
    const dugme = event.target.closest('.ukloni-stavku');
    if (dugme) ukloniRed(dugme.closest('.stavka'));
});

stavkeOkvir.addEventListener('input', (event) => {
    const el = event.target;
    if (!el.name) return;
    const red = el.closest('.stavka');
    delete el.dataset.auto;                       // korisnik je sam promenio: više ga ne prepisujemo
    if (el.name === 'tarifa_id') el.dataset.rucno = '1';
    el.removeAttribute('aria-invalid');
    greskaStavke(red, '');
    izmenjeno = true;
    osveziZbir(red, el.name);
});

stavkeOkvir.addEventListener('change', (event) => {
    if (event.target.name === 'sifra_dobavljac') traziPoSifriDobavljaca(event.target.closest('.stavka'));
});

// Enter u poljima stavke ide na sledeće polje; u prodajnoj ceni ide na sledeću stavku (ili dodaje novu).
stavkeOkvir.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.target.name) return;
    event.preventDefault();
    const red = event.target.closest('.stavka');
    const redosled = ['sifra_dobavljac', 'tarifa_id', 'kolicina', 'nabavna_cena', 'rabat_osnovni', 'rabat_posebni',
                      'rabat_dodatni', 'neto_vrednost', 'marza', 'prodajna_cena'];
    const i = redosled.indexOf(event.target.name);
    if (i < redosled.length - 1) {
        red.querySelector(`[name="${redosled[i + 1]}"]`).focus();
    } else {
        const sledeci = red.nextElementSibling;
        if (sledeci) sledeci.querySelector('.artikal-pretraga').focus();
        else dodajRed(true);
    }
});

document.getElementById('dodaj-stavku').addEventListener('click', () => dodajRed(true));


// ---------- Kalkulacija stavke ----------

const zaokruzi = (broj, decimala) => Number(Number(broj).toFixed(decimala));
const ispravan = (b) => b !== null && Number.isFinite(b);

function procitajRabate(red) {
    return ['rabat_osnovni', 'rabat_posebni', 'rabat_dodatni'].map((ime) => {
        const b = procitajBroj(red.querySelector(`[name="${ime}"]`));
        return ispravan(b) ? b : 0;
    });
}

function prikaziArtikal(red) {
    const a = red._artikal;
    const upisi = (ime, tekst) => { red.querySelector(`[data-prikaz="${ime}"]`).textContent = tekst; };
    if (!a) {
        ['naziv', 'bar_kod', 'stanje', 'cenovnik', 'prosek_sada'].forEach((ime) => upisi(ime, '—'));
        return;
    }
    upisi('naziv', a.naziv || '—');
    upisi('bar_kod', a.bar_kod || '—');
    upisi('stanje', `${formatKolicina(a.stanje)} ${a.jm}`.trim());
    upisi('cenovnik', formatBroj(a.prodajna));
    upisi('prosek_sada', formatBroj(a.prosek, 4));
    red.querySelector('[data-prikaz="stanje"]').classList.toggle('minus', a.stanje < 0);
}

// izvor = ime polja koje je korisnik upravo menjao. To polje se ne prepisuje, a:
//   - "neto_vrednost" -> izračuna se nabavna cena (vrednost / količina / rabati)
//   - "marza"         -> izračuna se prodajna cena
//   - sve ostalo      -> izračunaju se neto vrednost i marža
function izracunajStavku(red, izvor = null) {
    const el = (ime) => red.querySelector(`[name="${ime}"]`);
    const broj = (ime) => procitajBroj(el(ime));
    const kolicina = broj('kolicina');
    const [r1, r2, r3] = procitajRabate(red);
    const faktor = (1 - r1 / 100) * (1 - r2 / 100) * (1 - r3 / 100);
    const stopa = stopaReda(red);
    let cena = broj('nabavna_cena');

    if (izvor === 'neto_vrednost') {
        const vrednost = broj('neto_vrednost');
        if (ispravan(vrednost) && ispravan(kolicina) && kolicina > 0 && faktor > 0) {
            cena = zaokruzi(vrednost / kolicina / faktor, 6);
            el('nabavna_cena').value = cena;
            delete el('nabavna_cena').dataset.auto;
        }
    }
    const neto = ispravan(cena) && cena >= 0 ? cena * faktor : null;
    if (izvor !== 'neto_vrednost') {
        el('neto_vrednost').value = neto !== null && ispravan(kolicina) ? zaokruzi(kolicina * neto, 2) : '';
    }

    if (izvor === 'marza') {
        const marza = broj('marza');
        if (ispravan(marza) && neto !== null && stopa !== null && marza > -100) {
            el('prodajna_cena').value = zaokruzi(neto * (1 + marza / 100) * (1 + stopa), 2);
            delete el('prodajna_cena').dataset.auto;
        }
    }
    const prodajna = broj('prodajna_cena');
    const osnovica = ispravan(prodajna) && stopa !== null ? prodajna / (1 + stopa) : null;
    if (izvor !== 'marza') {
        el('marza').value = osnovica !== null && neto > 0 ? zaokruzi((osnovica - neto) / neto * 100, 2) : '';
    }

    // Prosečna nabavna posle ulaza (isto kao server: stanje <= 0 -> važi cena iz ovog ulaza)
    const a = red._artikal;
    const k = ispravan(kolicina) && kolicina > 0 ? kolicina : 0;
    const stanje = a ? a.stanje : 0;
    const prosekPosle = neto === null ? null : (stanje > 0 ? (stanje * a.prosek + k * neto) / (stanje + k) : neto);

    const prikaz = (ime, vrednost, decimala = 2, klasa = false) => {
        const dd = red.querySelector(`[data-prikaz="${ime}"]`);
        dd.textContent = vrednost === null || !Number.isFinite(vrednost) ? '—' : formatBroj(vrednost, decimala);
        if (klasa) dd.classList.toggle('minus', Number.isFinite(vrednost) && vrednost < 0);
    };
    prikaz('rabat_iznos', ispravan(cena) && neto !== null ? cena - neto : null, 4);
    prikaz('neto', neto, 4);
    prikaz('prenet', neto !== null && stopa !== null ? neto * stopa : null, 4);
    prikaz('dobavljac', neto !== null && stopa !== null ? neto * (1 + stopa) : null, 4);
    prikaz('marza_iznos', osnovica !== null && neto !== null ? osnovica - neto : null, 2, true);
    prikaz('osnovica', osnovica);
    // Kalk. cena: nabavna cena jednog artikla sa PDV (polje "Nabavna", pre rabata)
    prikaz('kalk_cena', ispravan(cena) && cena >= 0 && stopa !== null ? cena * (1 + stopa) : null, 4);
    prikaz('prosek_posle', prosekPosle, 4);
    const marzaProsek = osnovica !== null && prosekPosle > 0 ? (osnovica - prosekPosle) / prosekPosle * 100 : null;
    const mp = red.querySelector('[data-prikaz="marza_prosek"]');
    mp.textContent = marzaProsek === null ? '—' : `${formatBroj(marzaProsek)} %`;
    mp.classList.toggle('minus', marzaProsek !== null && marzaProsek < 0);
    prikaz('iznos_sa', neto !== null && stopa !== null && ispravan(kolicina) ? kolicina * neto * (1 + stopa) : null);
    el('marza').classList.toggle('minus', ispravan(broj('marza')) && broj('marza') < 0);

    // Prodajna cena drugačija od trenutne: polje se istakne (promena važi od čuvanja ulaza)
    el('prodajna_cena').classList.toggle('promenjena',
        Boolean(a) && ispravan(prodajna) && Math.abs(prodajna - a.prodajna) > 0.0001);

    return {
        bez: neto !== null && ispravan(kolicina) ? kolicina * neto : 0,
        sa: neto !== null && ispravan(kolicina) && stopa !== null ? kolicina * neto * (1 + stopa) : 0,
        rabat: ispravan(cena) && neto !== null && ispravan(kolicina) ? kolicina * (cena - neto) : 0
    };
}


// ---------- Zbir ----------

// aktivniRed/izvor: polje koje korisnik upravo kuca se ne prepisuje (vidi izracunajStavku)
function osveziZbir(aktivniRed = null, izvor = null) {
    let bez = 0, sa = 0, rabat = 0;
    sviRedovi().forEach((red) => {
        const r = izracunajStavku(red, red === aktivniRed ? izvor : null);
        bez += r.bez; sa += r.sa; rabat += r.rabat;
    });
    document.getElementById('zbir-rabat').textContent = formatBroj(rabat);
    document.getElementById('zbir-bez').textContent = formatBroj(bez);
    document.getElementById('zbir-pdv').textContent = formatBroj(sa - bez);
    document.getElementById('zbir-sa').textContent = `${formatBroj(sa)} RSD`;
}


// ---------- Provera pre čuvanja ----------

function proveriZaglavlje() {
    const v = (ime) => polje(ime).value.trim();
    const greske = [];
    const greska = (ime, tekst) => { postaviGresku(ime, tekst); greske.push(ime); };
    const sad = danas();

    if (!v('dobavljac_id')) greska('dobavljac_id', 'Izaberi dobavljača.');
    if (!v('racun_broj') && !v('otpremnica_broj')) {
        greska('racun_broj', 'Unesi broj računa ili broj otpremnice.');
        greska('otpremnica_broj', 'Unesi broj otpremnice ili broj računa.');
    }
    if (!v('ulaz_datum') && !v('otpremnica_datum')) {
        greska('ulaz_datum', 'Unesi datum računa ili datum otpremnice.');
        greska('otpremnica_datum', 'Unesi datum otpremnice ili datum računa.');
    }
    if (v('racun_poziv_na_broj') && !v('racun_broj')) greska('racun_poziv_na_broj', 'Poziv na broj ide uz račun: unesi i broj računa.');
    for (const [ime, naziv] of [['ulaz_datum', 'Datum računa'], ['otpremnica_datum', 'Datum otpremnice']]) {
        const d = v(ime);
        if (polje(ime).validity.badInput) greska(ime, 'Datum nije ispravan.');
        else if (d && d > sad) greska(ime, `${naziv} ne može biti u budućnosti.`);
        else if (d && d < NAJRANIJI_DATUM) greska(ime, `${naziv} je pre 2000. godine. Proveri unos.`);
    }
    const valuta = v('valuta_datum');
    const datumi = [v('ulaz_datum'), v('otpremnica_datum')].filter(Boolean).sort();
    if (polje('valuta_datum').validity.badInput) greska('valuta_datum', 'Datum nije ispravan.');
    else if (valuta && datumi.length && valuta < datumi[0]) greska('valuta_datum', 'Valuta ne može biti pre datuma računa/otpremnice.');
    return greske;
}

function proveriStavke() {
    const popunjeni = sviRedovi().filter((red) => !redJePrazan(red));
    let prvaGreska = null;
    const oznaci = (red, tekst, input) => {
        greskaStavke(red, tekst, input);
        prvaGreska = prvaGreska || input || red;
    };

    if (popunjeni.length === 0) {
        const red = sviRedovi()[0];
        oznaci(red, 'Dodaj bar jednu stavku: izaberi artikal i upiši količinu i cenu.', red.querySelector('.artikal-pretraga'));
        return { popunjeni, prvaGreska };
    }

    const videneSifre = new Map(), videneSifreDob = new Map();
    popunjeni.forEach((red) => {
        const pretraga = red.querySelector('.artikal-pretraga');
        const kolicinaEl = red.querySelector('[name="kolicina"]');
        const cenaEl = red.querySelector('[name="nabavna_cena"]');
        const tarifaEl = red.querySelector('[name="tarifa_id"]');
        const sifraDob = red.querySelector('[name="sifra_dobavljac"]').value.trim();
        const kolicina = procitajBroj(kolicinaEl), cena = procitajBroj(cenaEl);

        if (!red.dataset.sifra && !pretraga.value.trim()) return oznaci(red, 'Izaberi artikal ili upiši naziv novog.', pretraga);
        if (kolicina === null || kolicinaEl.validity.badInput) return oznaci(red, 'Upiši količinu.', kolicinaEl);
        if (!Number.isFinite(kolicina) || kolicina <= 0) return oznaci(red, 'Količina mora biti broj veći od 0.', kolicinaEl);
        if (cena === null || cenaEl.validity.badInput) return oznaci(red, 'Upiši nabavnu cenu bez PDV.', cenaEl);
        if (!Number.isFinite(cena) || cena < 0) return oznaci(red, 'Nabavna cena mora biti broj 0 ili veći.', cenaEl);
        if (stopaReda(red) === null) return oznaci(red, 'Izaberi tarifu.', tarifaEl);
        for (const ime of ['rabat_osnovni', 'rabat_posebni', 'rabat_dodatni']) {
            const rEl = red.querySelector(`[name="${ime}"]`);
            const r = procitajBroj(rEl);
            if (rEl.validity.badInput || (r !== null && (!Number.isFinite(r) || r < 0 || r > 100)))
                return oznaci(red, 'Rabat mora biti broj od 0 do 100 (ili prazno).', rEl);
        }
        const prodajnaEl = red.querySelector('[name="prodajna_cena"]');
        const prodajna = procitajBroj(prodajnaEl);
        if (prodajnaEl.validity.badInput || (prodajna !== null && (!Number.isFinite(prodajna) || prodajna < 0)))
            return oznaci(red, 'Prodajna cena mora biti broj 0 ili veći (ili prazno).', prodajnaEl);
        if (red.dataset.sifra) {
            const drugi = videneSifre.get(red.dataset.sifra);
            if (drugi) return oznaci(red, `Isti artikal je već u stavci ${redniBroj(drugi)}. Spoji ih u jednu stavku.`, pretraga);
            videneSifre.set(red.dataset.sifra, red);
        }
        if (sifraDob) {
            const drugi = videneSifreDob.get(sifraDob);
            if (drugi) return oznaci(red, `Šifra dobavljača „${sifraDob}“ je već u stavci ${redniBroj(drugi)}.`, red.querySelector('[name="sifra_dobavljac"]'));
            videneSifreDob.set(sifraDob, red);
        }
    });
    return { popunjeni, prvaGreska };
}

async function proveriDokumentNaServeru() {
    const params = new URLSearchParams({
        dobavljac_id: polje('dobavljac_id').value,
        racun_broj: polje('racun_broj').value.trim(),
        otpremnica_broj: polje('otpremnica_broj').value.trim()
    });
    const { poruke } = await procitaj(await fetch(`/ulazi/provera-dokumenta?${params}`), 'Provera broja računa ne radi.');
    poruke.forEach((p) => postaviGresku(p.startsWith('Račun') ? 'racun_broj' : 'otpremnica_broj', p));
    return poruke;
}


// ---------- Popup: neobavezni podaci koji fale ----------

const dijalogDopuna = document.getElementById('dijalog-dopuna');

function neobavezniKojiFale(popunjeni) {
    const fale = [];
    const v = (ime) => polje(ime).value.trim();
    if (!v('valuta_datum')) fale.push({ tekst: 'Valuta (rok plaćanja)', el: polje('valuta_datum') });
    if (v('racun_broj') && !v('racun_poziv_na_broj')) fale.push({ tekst: 'Poziv na broj', el: polje('racun_poziv_na_broj') });
    popunjeni.forEach((red) => {
        const sifraDob = red.querySelector('[name="sifra_dobavljac"]');
        if (!sifraDob.value.trim()) {
            const naziv = red.querySelector('.artikal-pretraga').value.trim();
            fale.push({ tekst: `Stavka ${redniBroj(red)} (${naziv}): šifra kod dobavljača`, el: sifraDob });
        }
        const prodajna = red.querySelector('[name="prodajna_cena"]');
        if (!red.dataset.sifra && !prodajna.value.trim()) {
            const naziv = red.querySelector('.artikal-pretraga').value.trim();
            fale.push({ tekst: `Stavka ${redniBroj(red)} (${naziv}): prodajna cena novog artikla (biće 0)`, el: prodajna });
        }
    });
    return fale;
}

function pitajZaDopunu(fale) {
    return new Promise((resolve) => {
        const lista = document.getElementById('lista-dopuna');
        lista.replaceChildren(...fale.map((f) => {
            const li = document.createElement('li');
            li.textContent = f.tekst;
            return li;
        }));
        const zavrsi = (nastavi) => {
            dijalogDopuna.removeEventListener('cancel', naOdustani);
            dijalogDopuna.close();
            resolve(nastavi);
        };
        const naOdustani = (event) => { event.preventDefault(); zavrsi(false); };
        document.getElementById('dopuna-nastavi').onclick = () => zavrsi(true);
        document.getElementById('dopuna-dopuni').onclick = () => zavrsi(false);
        dijalogDopuna.addEventListener('cancel', naOdustani);
        dijalogDopuna.showModal();
        document.getElementById('dopuna-dopuni').focus();
    });
}


// ---------- Popup: novi artikli ----------

const dijalogNovi = document.getElementById('novi-artikli-dijalog');
const listaNovih = document.getElementById('novi-artikli-lista');
const sablonNovi = document.getElementById('novi-artikal-sablon');
const preostaloEl = document.getElementById('novi-artikli-preostalo');

// Vraća true kad su svi novi artikli popunjeni, false ako je korisnik odustao.
// Redovi za koje su podaci već uneti (a naziv nije menjan) ne pitaju se ponovo.
function popuniNoveArtikle(redovi) {
    const zaPopunu = redovi.filter((red) => {
        const tekst = red.querySelector('.artikal-pretraga').value.trim();
        return !(red._noviArtikal && red._noviZaTekst === tekst);
    });
    if (zaPopunu.length === 0) return Promise.resolve(true);

    return new Promise((resolve) => {
        listaNovih.replaceChildren();
        let preostalo = zaPopunu.length;
        preostaloEl.textContent = preostalo;

        zaPopunu.forEach((red) => {
            const f = sablonNovi.content.firstElementChild.cloneNode(true);
            const tekst = red.querySelector('.artikal-pretraga').value.trim();
            const vr = (ime) => red.querySelector(`[name="${ime}"]`).value.trim();
            f.querySelector('[data-polje="stavka"]').textContent = redniBroj(red);
            f.querySelector('[data-polje="sifra_dobavljac"]').textContent = vr('sifra_dobavljac') || '—';
            f.querySelector('[data-polje="kolicina"]').textContent = vr('kolicina');
            const rabati = procitajRabate(red).filter((r) => r > 0).map((r) => `${formatBroj(r)}%`).join(' + ');
            const tarifaTekst = red.querySelector('[name="tarifa_id"]').selectedOptions[0]?.textContent || '';
            f.querySelector('[data-polje="cena"]').textContent =
                `${vr('nabavna_cena')}${rabati ? ` − ${rabati}` : ''} / ${tarifaTekst}`;
            // Čisto brojevi u pretrazi su verovatno šifra, ne naziv
            f.elements.naziv.value = /^\d+$/.test(tekst) ? '' : tekst;
            f.addEventListener('submit', (event) => {
                event.preventDefault();
                const e = f.elements;
                const greska = f.querySelector('.greska-novog');
                const minimum = Number((e.minimalno_stanje.value || '0').replace(',', '.'));
                if (!e.naziv.value.trim()) { greska.textContent = 'Upiši naziv artikla.'; e.naziv.focus(); return; }
                if (!e.jedinica_mere.value.trim()) { greska.textContent = 'Upiši jedinicu mere.'; e.jedinica_mere.focus(); return; }
                if (!Number.isFinite(minimum) || minimum < 0) { greska.textContent = 'Minimalno stanje mora biti broj 0 ili veći.'; e.minimalno_stanje.focus(); return; }

                red._noviArtikal = {
                    naziv: e.naziv.value.trim(),
                    jedinica_mere: e.jedinica_mere.value.trim(),
                    bar_kod: e.bar_kod.value.trim(),
                    kategorija: e.kategorija.value.trim(),
                    minimalno_stanje: minimum
                };
                red._noviZaTekst = tekst;
                red.querySelector('.jm').textContent = red._noviArtikal.jedinica_mere;
                postaviInfo(red, `Nov artikal: „${red._noviArtikal.naziv}“ (${red._noviArtikal.jedinica_mere})`, 'nov');

                f.remove();
                preostalo -= 1;
                preostaloEl.textContent = preostalo;
                if (preostalo === 0) zavrsi(true);
                else listaNovih.querySelector('input[name="naziv"]')?.focus();
            });
            listaNovih.appendChild(f);
        });

        const zavrsi = (uspeh) => {
            dijalogNovi.removeEventListener('cancel', naOdustani);
            dijalogNovi.close();
            resolve(uspeh);
        };
        const naOdustani = (event) => { event.preventDefault(); zavrsi(false); };
        document.getElementById('novi-artikli-odustani').onclick = () => zavrsi(false);
        dijalogNovi.addEventListener('cancel', naOdustani);
        dijalogNovi.showModal();
        listaNovih.querySelector('input[name="naziv"]')?.focus();
    });
}


// ---------- Čuvanje ----------

function napraviZahtev(popunjeni) {
    const v = (ime) => polje(ime).value.trim() || null;
    return {
        dobavljac_id: Number(polje('dobavljac_id').value),
        racun_broj: v('racun_broj'),
        racun_poziv_na_broj: v('racun_poziv_na_broj'),
        ulaz_datum: v('ulaz_datum'),
        otpremnica_broj: v('otpremnica_broj'),
        otpremnica_datum: v('otpremnica_datum'),
        valuta_datum: v('valuta_datum'),
        stavke: popunjeni.map((red) => {
            const stavka = {
                sifra_dobavljac: red.querySelector('[name="sifra_dobavljac"]').value.trim() || null,
                kolicina: procitajBroj(red.querySelector('[name="kolicina"]')),
                nabavna_cena: procitajBroj(red.querySelector('[name="nabavna_cena"]')),
                rabat_osnovni: procitajRabate(red)[0],
                rabat_posebni: procitajRabate(red)[1],
                rabat_dodatni: procitajRabate(red)[2],
                tarifa_id: Number(red.querySelector('[name="tarifa_id"]').value),
                prodajna_cena: procitajBroj(red.querySelector('[name="prodajna_cena"]'))
            };
            if (red.dataset.sifra) stavka.sifra_artikal = Number(red.dataset.sifra);
            else stavka.novi_artikal = red._noviArtikal;
            return stavka;
        })
    };
}

forma.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (cuvanjeUToku) return;
    ocistiGreske();
    javi('');

    const greskeZaglavlja = proveriZaglavlje();
    const { popunjeni, prvaGreska } = proveriStavke();
    if (greskeZaglavlja.length || prvaGreska) {
        javi('Ulaz nije sačuvan. Ispravi označena polja.', 'greska');
        const prvo = greskeZaglavlja.length ? polje(greskeZaglavlja[0]) : prvaGreska;
        prvo.focus?.();
        prvo.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        return;
    }

    cuvanjeUToku = true;
    dugmeSacuvaj.disabled = true;
    dugmeSacuvaj.textContent = 'Provera…';
    try {
        if ((await proveriDokumentNaServeru()).length) {
            javi('Ulaz nije sačuvan: taj dokument je već unet.', 'greska');
            return;
        }

        const fale = neobavezniKojiFale(popunjeni);
        if (fale.length && !(await pitajZaDopunu(fale))) {
            fale[0].el.focus();
            fale.forEach((f) => f.el.classList.add('fali'));
            javi('Dopuni podatke pa ponovo klikni „Sačuvaj ulaz“.', '');
            return;
        }

        const novi = popunjeni.filter((red) => !red.dataset.sifra);
        if (novi.length && !(await popuniNoveArtikle(novi))) {
            javi('Čuvanje je otkazano. Uneti podaci su ostali u formi.', '');
            return;
        }

        dugmeSacuvaj.textContent = 'Čuvanje…';
        const odgovor = await fetch('/ulazi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(napraviZahtev(popunjeni))
        });
        const { ulaz_id } = await procitaj(odgovor, 'Ulaz nije sačuvan.');

        resetujFormu();
        if (window.location.search) history.replaceState(null, '', window.location.pathname);
        const veza = document.createElement('a');
        veza.href = '/vlasnik/ulazi.html';
        veza.textContent = 'Pogledaj sve ulaze';
        poruka.className = 'uspeh';
        poruka.replaceChildren(`Ulaz #${ulaz_id} je sačuvan. `, veza);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (greska) {
        javi(`Ulaz nije sačuvan. ${porukaGreske(greska)}`, 'greska');
    } finally {
        cuvanjeUToku = false;
        dugmeSacuvaj.disabled = false;
        dugmeSacuvaj.textContent = 'Sačuvaj ulaz';
    }
});

// Enter u poljima zaglavlja ne šalje formu (slučajno čuvanje); šalje se samo dugmetom
forma.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('.polja-dokument input')) event.preventDefault();
});

// Polja koja idu u paru ("ovo ILI ono"): popunjavanje jednog briše grešku i kod drugog
const PAROVI = {
    racun_broj: 'otpremnica_broj', otpremnica_broj: 'racun_broj',
    ulaz_datum: 'otpremnica_datum', otpremnica_datum: 'ulaz_datum'
};

forma.addEventListener('input', (event) => {
    if (event.target.closest('.polja-dokument')) {
        postaviGresku(event.target.name, '');
        if (PAROVI[event.target.name]) postaviGresku(PAROVI[event.target.name], '');
        izmenjeno = true;
    }
    event.target.classList?.remove('fali');
    // Stara poruka "nije sačuvano" više ne važi čim korisnik nešto ispravi
    if (poruka.className === 'greska') javi('');
});


// ---------- Poništavanje ----------

function resetujFormu() {
    forma.reset();
    ocistiGreske();
    forma.querySelectorAll('.fali').forEach((el) => el.classList.remove('fali'));
    polje('ulaz_datum').value = danas();          // datum računa je uvek podrazumevano danas
    stavkeOkvir.replaceChildren();
    dodajRed();
    document.getElementById('nacrt-info').hidden = true;
    izmenjeno = false;
}

document.getElementById('ponisti').addEventListener('click', () => {
    if (izmenjeno && !window.confirm('Obrisati sve uneto u ovaj ulaz?')) return;
    resetujFormu();
    javi('');
});

window.addEventListener('beforeunload', (event) => {
    if (izmenjeno && !cuvanjeUToku) event.preventDefault();
});


// ---------- Nacrt iz asistenta (?nacrt=...) ----------
// Asistent je pročitao račun/otpremnicu; ovde se samo POPUNJAVA forma. Čuva korisnik, kao i inače.

function upisiVrednost(red, ime, vrednost) {
    const el = red.querySelector(`[name="${ime}"]`);
    if (vrednost === null || vrednost === undefined) return;
    el.value = vrednost;
    delete el.dataset.auto;              // korisnikov (dokumentov) podatak: program ga ne prepisuje
    if (ime === 'tarifa_id') el.dataset.rucno = '1';
}

async function nadjiArtikal(sifra) {
    const dobavljacId = dobavljacPolje.value;
    if (dobavljacId) {
        const params = new URLSearchParams({ dobavljac_id: dobavljacId, sifra_artikal: sifra });
        return procitaj(await fetch(`/ulazi/veza?${params}`), 'Artikal ne može da se učita.');
    }
    const lista = await procitaj(await fetch(`/ulazi/artikli?${new URLSearchParams({ q: sifra, limit: 5 })}`),
                                 'Artikal ne može da se učita.');
    return lista.find((a) => a.sifra === sifra) || null;
}

async function ucitajNacrt() {
    const token = new URLSearchParams(window.location.search).get('nacrt');
    if (!token) return;
    let n;
    try {
        n = await procitaj(await fetch(`/asistent/nacrt/${encodeURIComponent(token)}`), 'Nacrt ulaza ne može da se učita.');
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
        return;
    }

    const napomene = [...(n.napomene || [])];
    if (n.dobavljac_id && [...dobavljacPolje.options].some((o) => o.value === String(n.dobavljac_id))) {
        dobavljacPolje.value = String(n.dobavljac_id);
    } else {
        napomene.unshift(`Dobavljač nije prepoznat${n.dobavljac_naziv ? ` („${n.dobavljac_naziv}“ na dokumentu)` : ''}: izaberi ga ručno.`);
    }
    for (const ime of ['racun_broj', 'racun_poziv_na_broj', 'ulaz_datum', 'otpremnica_broj', 'otpremnica_datum', 'valuta_datum']) {
        polje(ime).value = n[ime] || '';
    }
    if (!n.ulaz_datum && !n.otpremnica_datum) napomene.push('Datum nije pročitan: upiši datum računa ili otpremnice.');

    stavkeOkvir.replaceChildren();
    for (const [i, s] of (n.stavke || []).entries()) {
        const red = dodajRed();
        if (s.sifra_artikal) {
            try {
                const a = await nadjiArtikal(s.sifra_artikal);
                if (a) postaviArtikal(red, a, { popuniCene: false });
                else napomene.push(`Stavka ${i + 1}: artikal ${s.sifra_artikal} nije nađen, upisan je kao nov.`);
            } catch (greska) {
                greskaStavke(red, porukaGreske(greska));
            }
        }
        if (!red.dataset.sifra) {
            red.querySelector('.artikal-pretraga').value = s.naziv || '';
            oznaciKaoNov(red);
        }
        upisiVrednost(red, 'sifra_dobavljac', s.sifra_dobavljac);
        upisiVrednost(red, 'kolicina', s.kolicina);
        upisiVrednost(red, 'nabavna_cena', s.nabavna_cena);
        for (const r of ['rabat_osnovni', 'rabat_posebni', 'rabat_dodatni']) {
            if (s[r]) upisiVrednost(red, r, s[r]);
        }
        upisiVrednost(red, 'tarifa_id', s.tarifa_id ?? tarifaZaStopu(s.pdv));
        upisiVrednost(red, 'prodajna_cena', s.prodajna_cena);
        if (s.kolicina === null || s.nabavna_cena === null || (s.tarifa_id ?? tarifaZaStopu(s.pdv)) === null) {
            napomene.push(`Stavka ${i + 1} (${s.naziv || 'bez naziva'}): neki brojevi nisu pročitani, dopuni ih.`);
        }
    }
    if (sviRedovi().length === 0) dodajRed();
    osveziZbir();

    const lista = document.getElementById('nacrt-napomene');
    lista.replaceChildren(...napomene.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
    }));
    document.getElementById('nacrt-info').hidden = false;
    izmenjeno = true;
}


// ---------- Početak ----------

async function ucitajTarife() {
    try {
        tarife = await procitaj(await fetch('/tarife'), 'Tarife ne mogu da se učitaju.');
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
    }
}

for (const ime of ['ulaz_datum', 'otpremnica_datum']) polje(ime).max = danas();
ucitajTarife().then(() => {
    resetujFormu();
    return ucitajDobavljace();
}).then(ucitajNacrt);
