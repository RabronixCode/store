// ---------- Stranica Artikli (vlasnik) ----------
//
// Ugovor sa serverom:
//   GET   /artikli/svi        -> [{ sifra, naziv, kategorija, bar_kod, stanje, minimalno_stanje, prodajna_cena,
//                                   nabavna_cena_ponderisana, jedinica_mere, aktivan }]
//   POST  /artikli            telo: { naziv, kategorija, bar_kod, prodajna_cena, jedinica_mere, minimalno_stanje, aktivan }
//                             -> novi artikal (isti oblik kao gore)
//   PATCH /artikli/<sifra>    telo: samo polje koje se menja, npr. { naziv: "Hleb" }
//                             -> izmenjen artikal

const telo = document.getElementById('artikli-telo');
const sablonRed = document.getElementById('red-sablon');
const brojac = document.getElementById('brojac');
const poruka = document.getElementById('poruka');
const nemaArtikala = document.getElementById('nema-artikala');
const dugmePonisti = document.getElementById('ponisti-filtere');

const dijalog = document.getElementById('dijalog-artikal');
const formaArtikal = document.getElementById('forma-artikal');
const dijalogGreska = document.getElementById('dijalog-greska');
const dugmeSacuvaj = document.getElementById('dijalog-sacuvaj');

const BROJCANE = new Set(['sifra', 'stanje', 'minimalno_stanje', 'prodajna_cena', 'nabavna_cena_ponderisana', 'aktivan']);

let artikli = [];                                   // svi artikli sa servera
let sort = { kolona: 'sifra', smer: 'asc' };        // smer: 'asc' | 'desc' | null
const filteri = {};                                 // kolona -> tekst filtera
let novaSifra = null;                               // šifra upravo dodatog artikla (da se istakne)


// ---------- Pomoćne ----------

function formatBroj(broj, decimala = 2) {
    return Number(broj).toLocaleString('sr-RS', {
        minimumFractionDigits: decimala,
        maximumFractionDigits: decimala
    });
}

function formatStanje(broj) {
    return Number(broj).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
}

// Mala slova i bez kvačica: "Čokolada" i "cokolada" se nalaze isto
function normalizuj(tekst) {
    return String(tekst ?? '')
        .toLowerCase()
        .replaceAll('đ', 'dj')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
    if (vrsta === 'uspeh') {
        clearTimeout(javi.tajmer);
        javi.tajmer = setTimeout(() => { if (poruka.textContent === tekst) javi(''); }, 4000);
    }
}

// Zajednička obrada odgovora: 401/403 vode na prijavu, ostalo baca grešku sa porukom servera
async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu radnju. Prijavi se ponovo kao vlasnik.');
    if (odgovor.status === 422) throw new Error('Neispravan unos. Proveri obavezna polja.');
    const podaci = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof podaci === 'string' ? podaci : podrazumevanaGreska);
    return podaci;
}

function porukaGreske(greska) {
    return greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message;
}


// ---------- Filtriranje i sortiranje ----------

// Brojčani filter: ">10", "<=0", "=5" ili samo deo broja ("12" nađe 12, 120, 312...)
function prolaziBroj(vrednost, filter) {
    const m = filter.replace(',', '.').match(/^(>=|<=|>|<|=)\s*(-?\d+(\.\d+)?)$/);
    if (!m) return String(vrednost).includes(filter.replace(',', '.'));
    const broj = Number(m[2]);
    switch (m[1]) {
        case '>': return vrednost > broj;
        case '<': return vrednost < broj;
        case '>=': return vrednost >= broj;
        case '<=': return vrednost <= broj;
        default: return vrednost === broj;
    }
}

function prolazi(artikal) {
    for (const [kolona, filter] of Object.entries(filteri)) {
        if (filter === '') continue;
        const vrednost = artikal[kolona];
        if (kolona === 'aktivan') {
            if (String(vrednost) !== filter) return false;
        } else if (BROJCANE.has(kolona)) {
            if (!prolaziBroj(Number(vrednost), filter.trim())) return false;
        } else if (!normalizuj(vrednost).includes(normalizuj(filter.trim()))) {
            return false;
        }
    }
    return true;
}

function uporedi(a, b) {
    const { kolona, smer } = sort;
    const x = a[kolona], y = b[kolona];
    // Prazne vrednosti (bez kategorije, bez bar koda) uvek idu na kraj
    const praznoX = x === null || x === '', praznoY = y === null || y === '';
    if (praznoX && praznoY) return a.sifra - b.sifra;
    if (praznoX) return 1;
    if (praznoY) return -1;

    const rezultat = BROJCANE.has(kolona)
        ? Number(x) - Number(y)
        : String(x).localeCompare(String(y), 'sr', { numeric: true, sensitivity: 'base' });
    return (smer === 'desc' ? -rezultat : rezultat) || a.sifra - b.sifra;
}

function vidljivi() {
    const lista = artikli.filter(prolazi);
    if (sort.smer) lista.sort(uporedi);
    return lista;
}


// ---------- Crtanje tabele ----------

function popuniRed(red, a) {
    red.dataset.sifra = a.sifra;
    red.classList.toggle('neaktivan', !a.aktivan);
    red.querySelector('[data-polje="sifra"]').textContent = a.sifra;

    for (const polje of ['naziv', 'kategorija', 'bar_kod', 'jedinica_mere']) {
        const celija = red.querySelector(`[data-polje="${polje}"]`);
        if (celija.classList.contains('menja-se')) continue;   // ne diraj polje koje se upravo kuca
        const prazno = a[polje] === null || a[polje] === '';
        celija.textContent = prazno ? '—' : a[polje];
        celija.classList.toggle('prazno', prazno);
    }

    const stanje = red.querySelector('[data-polje="stanje"]');
    stanje.textContent = formatStanje(a.stanje);
    stanje.classList.toggle('minus', a.stanje < 0);
    stanje.classList.toggle('na-minimumu', a.stanje >= 0 && naMinimumu(a));

    const minimum = red.querySelector('[data-polje="minimalno_stanje"]');
    if (!minimum.classList.contains('menja-se')) minimum.textContent = formatStanje(a.minimalno_stanje);

    red.querySelector('[data-polje="prodajna_cena"]').textContent = formatBroj(a.prodajna_cena);
    red.querySelector('[data-polje="nabavna_cena_ponderisana"]').textContent = formatBroj(a.nabavna_cena_ponderisana);
    red.querySelector('input[data-polje="aktivan"]').checked = Boolean(a.aktivan);
}

function nacrtaj() {
    const lista = vidljivi();
    const redovi = lista.map((a) => {
        const red = sablonRed.content.firstElementChild.cloneNode(true);
        popuniRed(red, a);
        if (a.sifra === novaSifra) red.classList.add('novo');
        return red;
    });
    telo.replaceChildren(...redovi);

    nemaArtikala.hidden = lista.length > 0 || artikli.length === 0;
    const imaFiltera = Object.values(filteri).some((f) => f !== '');
    dugmePonisti.hidden = !imaFiltera;
    brojac.textContent = imaFiltera
        ? `Prikazano ${lista.length} od ${artikli.length} artikala`
        : `Ukupno ${artikli.length} artikala`;

    osveziZnacke();

    // Strelice u zaglavlju
    document.querySelectorAll('tr.naslovi th').forEach((th) => {
        const aktivna = th.dataset.kolona === sort.kolona && sort.smer;
        th.setAttribute('aria-sort', aktivna ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

async function ucitaj() {
    try {
        artikli = await procitaj(await fetch('/artikli/svi'), 'Artikli trenutno ne mogu da se učitaju.');
        nacrtaj();
    } catch (greska) {
        brojac.textContent = '';
        javi(porukaGreske(greska), 'greska');
    }
}


// ---------- Izmena u tabeli ----------

let uIzmeni = null;   // ćelija koja se trenutno menja

function zapocniIzmenu(celija) {
    if (uIzmeni) return;
    const sifra = Number(celija.closest('tr').dataset.sifra);
    const polje = celija.dataset.polje;
    const artikal = artikli.find((a) => a.sifra === sifra);
    const stara = artikal[polje] ?? '';

    const brojcano = polje === 'minimalno_stanje';
    const input = document.createElement('input');
    input.type = brojcano ? 'number' : 'text';
    input.className = 'izmena-polje' + (brojcano ? ' broj' : '');
    input.value = stara;
    if (brojcano) {
        input.min = '0';
        input.step = 'any';
        input.inputMode = 'decimal';
    } else {
        input.maxLength = polje === 'jedinica_mere' ? 10 : 255;
    }
    if (polje === 'jedinica_mere') input.setAttribute('list', 'jedinice-mere');
    if (polje === 'bar_kod') input.inputMode = 'numeric';
    input.setAttribute('aria-label', `Izmena: ${celija.closest('table').querySelector(`th[data-kolona="${polje}"]`).textContent}`);

    uIzmeni = celija;
    celija.classList.add('menja-se');
    celija.replaceChildren(input);
    input.focus();
    input.select();

    let zavrseno = false;
    const zavrsi = async (sacuvaj) => {
        if (zavrseno) return;
        zavrseno = true;
        uIzmeni = null;   // odmah: klik na drugu ćeliju može da počne novu izmenu
        const nova = input.value.trim();

        if (!sacuvaj || nova === String(stara)) {
            vratiCeliju(celija, artikal);
            return;
        }
        if (nova === '' && (polje === 'naziv' || polje === 'jedinica_mere')) {
            javi(polje === 'naziv' ? 'Naziv ne može biti prazan.' : 'Jedinica mere ne može biti prazna.', 'greska');
            vratiCeliju(celija, artikal);
            return;
        }
        let vrednost = nova;
        if (brojcano) {
            vrednost = Number(nova.replace(',', '.'));
            if (nova === '' || !Number.isFinite(vrednost) || vrednost < 0) {
                javi('Minimalno stanje mora biti broj 0 ili veći.', 'greska');
                vratiCeliju(celija, artikal);
                return;
            }
            if (vrednost === Number(stara)) { vratiCeliju(celija, artikal); return; }
        }
        celija.classList.add('cuva-se');
        input.disabled = true;
        await sacuvajIzmenu(sifra, { [polje]: vrednost });
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); zavrsi(true); }
        else if (event.key === 'Escape') { event.preventDefault(); zavrsi(false); }
    });
    input.addEventListener('blur', () => zavrsi(true));
}

function vratiCeliju(celija, artikal) {
    celija.classList.remove('menja-se', 'cuva-se');
    const red = celija.closest('tr');
    if (red) popuniRed(red, artikal);
    celija.focus({ preventScroll: true });
}

async function sacuvajIzmenu(sifra, izmena) {
    const red = telo.querySelector(`tr[data-sifra="${sifra}"]`);
    try {
        const odgovor = await fetch(`/artikli/${sifra}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(izmena)
        });
        const izmenjen = await procitaj(odgovor, 'Izmena nije sačuvana.');
        const i = artikli.findIndex((a) => a.sifra === sifra);
        artikli[i] = izmenjen;
        javi(`Artikal ${sifra} je sačuvan.`, 'uspeh');
        // Ne crtamo celu tabelu ponovo (red bi mogao da "skoči" zbog sortiranja dok radiš);
        // samo osvežimo ovaj red. Novi redosled se primeni pri sledećem sortiranju/filtriranju.
        if (red) {
            red.querySelectorAll('.cuva-se').forEach((c) => c.classList.remove('menja-se', 'cuva-se'));
            popuniRed(red, izmenjen);
            osveziZnacke();
            red.classList.remove('sacuvano');
            void red.offsetWidth;          // ponovo pokreni animaciju
            red.classList.add('sacuvano');
        }
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
        const artikal = artikli.find((a) => a.sifra === sifra);
        if (red) {
            red.querySelectorAll('.cuva-se').forEach((c) => c.classList.remove('menja-se', 'cuva-se'));
            popuniRed(red, artikal);       // vrati staru vrednost
        }
    }
}

telo.addEventListener('click', (event) => {
    const celija = event.target.closest('td.izmenjivo');
    if (celija && !celija.classList.contains('menja-se')) zapocniIzmenu(celija);
});

// Tastatura: Enter ili F2 na ćeliji započinje izmenu
telo.addEventListener('keydown', (event) => {
    const celija = event.target.closest('td.izmenjivo');
    if (!celija || event.target !== celija) return;
    if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        zapocniIzmenu(celija);
    }
});

telo.addEventListener('change', (event) => {
    const cek = event.target.closest('input[data-polje="aktivan"]');
    if (!cek) return;
    const sifra = Number(cek.closest('tr').dataset.sifra);
    sacuvajIzmenu(sifra, { aktivan: cek.checked });
});


// ---------- Zaglavlje: sortiranje i filteri ----------

document.querySelector('tr.naslovi').addEventListener('click', (event) => {
    const th = event.target.closest('th');
    if (!th || !event.target.closest('.sortiraj')) return;
    const kolona = th.dataset.kolona;
    // isti klik kruži: rastuće -> opadajuće -> bez sortiranja (po šifri)
    if (sort.kolona !== kolona) sort = { kolona, smer: 'asc' };
    else if (sort.smer === 'asc') sort.smer = 'desc';
    else sort = { kolona: 'sifra', smer: 'asc' };
    nacrtaj();
});

let filterTajmer = null;
document.querySelector('tr.filteri').addEventListener('input', (event) => {
    const el = event.target.closest('[data-filter]');
    if (!el) return;
    filteri[el.dataset.filter] = el.value;
    el.classList.toggle('aktivan-filter', el.value !== '');
    clearTimeout(filterTajmer);
    filterTajmer = setTimeout(nacrtaj, 120);
});

dugmePonisti.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((el) => {
        el.value = '';
        el.classList.remove('aktivan-filter');
    });
    for (const k of Object.keys(filteri)) delete filteri[k];
    nacrtaj();
});


// ---------- Dodavanje artikla (popup) ----------

document.getElementById('dodaj-artikal').addEventListener('click', () => {
    formaArtikal.reset();
    dijalogGreska.textContent = '';
    dijalog.showModal();
    formaArtikal.elements.naziv.focus();
});

document.getElementById('dijalog-odustani').addEventListener('click', () => dijalog.close());

// Klik na zatamnjenu pozadinu (van prozora) zatvara popup
dijalog.addEventListener('click', (event) => {
    if (event.target === dijalog) dijalog.close();
});

formaArtikal.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!formaArtikal.reportValidity()) return;

    const f = formaArtikal.elements;
    const podaci = {
        naziv: f.naziv.value.trim(),
        jedinica_mere: f.jedinica_mere.value.trim(),
        prodajna_cena: Number(f.prodajna_cena.value || 0),
        kategorija: f.kategorija.value.trim(),
        bar_kod: f.bar_kod.value.trim(),
        minimalno_stanje: Number(f.minimalno_stanje.value || 0),
        aktivan: f.aktivan.checked
    };

    dugmeSacuvaj.disabled = true;
    dijalogGreska.textContent = '';
    try {
        const odgovor = await fetch('/artikli', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(podaci)
        });
        const novi = await procitaj(odgovor, 'Artikal nije sačuvan.');
        artikli.push(novi);
        novaSifra = novi.sifra;
        dijalog.close();
        nacrtaj();
        javi(`Artikal „${novi.naziv}“ je dodat pod šifrom ${novi.sifra}.`, 'uspeh');
        const red = telo.querySelector(`tr[data-sifra="${novi.sifra}"]`);
        if (red) red.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else javi(`Artikal „${novi.naziv}“ je dodat (šifra ${novi.sifra}), ali ga trenutni filteri sakrivaju.`, 'uspeh');
    } catch (greska) {
        dijalogGreska.textContent = porukaGreske(greska);
    } finally {
        dugmeSacuvaj.disabled = false;
    }
});


// ---------- Izveštaji: Na minimumu / U minusu (popup) ----------
//
// Na minimumu: AKTIVAN artikal čije je stanje palo na minimalno stanje ili ispod
//              (vreme je za nabavku). Neaktivni se ne naručuju, pa ih ovde nema.
// U minusu:    svaki artikal sa stanjem manjim od 0 (prodato više nego što je evidentirano).
// Računa se iz već učitanih artikala, pa uvek prati izmene napravljene na ovoj stranici.

function naMinimumu(a) {
    return Boolean(a.aktivan) && a.stanje <= a.minimalno_stanje;
}

function uMinusu(a) {
    return a.stanje < 0;
}

function osveziZnacke() {
    const brMin = artikli.filter(naMinimumu).length;
    const brMinus = artikli.filter(uMinusu).length;
    document.getElementById('broj-minimum').textContent = brMin;
    document.getElementById('broj-minus').textContent = brMinus;
    document.getElementById('prikazi-minimum').classList.toggle('prazan', brMin === 0);
    document.getElementById('prikazi-minus').classList.toggle('prazan', brMinus === 0);
}

const dijalogLista = document.getElementById('dijalog-lista');

// kolone: [{ naslov, klasa, vrednost: (artikal) => tekst, oznaci?: (artikal) => klasa }]
function prikaziListu({ naslov, opis, prazno, lista, kolone }) {
    document.getElementById('lista-naslov').textContent = naslov;
    document.getElementById('lista-opis').textContent = opis;

    document.getElementById('lista-zaglavlje').replaceChildren(...kolone.map((k) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = k.naslov;
        if (k.klasa) th.className = k.klasa;
        return th;
    }));

    document.getElementById('lista-telo').replaceChildren(...lista.map((a) => {
        const tr = document.createElement('tr');
        if (!a.aktivan) tr.classList.add('neaktivan');
        for (const k of kolone) {
            const td = document.createElement('td');
            td.textContent = k.vrednost(a);
            if (k.klasa) td.className = k.klasa;
            if (k.oznaci) { const c = k.oznaci(a); if (c) td.classList.add(c); }
            tr.appendChild(td);
        }
        return tr;
    }));

    const tabela = dijalogLista.querySelector('.tabela-lista');
    const praznoPoruka = document.getElementById('lista-prazno');
    tabela.hidden = lista.length === 0;
    praznoPoruka.hidden = lista.length > 0;
    praznoPoruka.textContent = prazno;
    dijalogLista.showModal();
}

const KOLONA_SIFRA = { naslov: 'Šifra', klasa: 'broj prigusen', vrednost: (a) => a.sifra };
const KOLONA_NAZIV = { naslov: 'Naziv', klasa: 'naziv', vrednost: (a) => a.naziv };
const KOLONA_JM = { naslov: 'JM', klasa: 'prigusen', vrednost: (a) => a.jedinica_mere };

document.getElementById('prikazi-minimum').addEventListener('click', () => {
    // Prvo oni kojima najviše fali do minimuma
    const lista = artikli.filter(naMinimumu)
        .sort((a, b) => (a.stanje - a.minimalno_stanje) - (b.stanje - b.minimalno_stanje) || a.sifra - b.sifra);
    prikaziListu({
        naslov: 'Artikli na minimumu',
        opis: 'Aktivni artikli čije je stanje palo na minimalno stanje ili ispod. Vreme je za nabavku.',
        prazno: 'Nijedan artikal nije na minimumu.',
        lista,
        kolone: [
            KOLONA_SIFRA, KOLONA_NAZIV, KOLONA_JM,
            { naslov: 'Stanje', klasa: 'broj', vrednost: (a) => formatStanje(a.stanje), oznaci: (a) => a.stanje < 0 ? 'minus' : 'na-minimumu' },
            { naslov: 'Min. stanje', klasa: 'broj', vrednost: (a) => formatStanje(a.minimalno_stanje) },
            { naslov: 'Fali do minimuma', klasa: 'broj jako', vrednost: (a) => formatStanje(Math.max(0, a.minimalno_stanje - a.stanje)) }
        ]
    });
});

document.getElementById('prikazi-minus').addEventListener('click', () => {
    const lista = artikli.filter(uMinusu).sort((a, b) => a.stanje - b.stanje || a.sifra - b.sifra);
    prikaziListu({
        naslov: 'Artikli u minusu',
        opis: 'Artikli sa stanjem manjim od 0: prodato je više nego što je uneto kroz ulaz robe.',
        prazno: 'Nijedan artikal nije u minusu.',
        lista,
        kolone: [
            KOLONA_SIFRA, KOLONA_NAZIV, KOLONA_JM,
            { naslov: 'Stanje', klasa: 'broj jako', vrednost: (a) => formatStanje(a.stanje), oznaci: () => 'minus' },
            { naslov: 'Aktivan', klasa: 'sredina', vrednost: (a) => a.aktivan ? 'Da' : 'Ne' }
        ]
    });
});

document.getElementById('lista-zatvori').addEventListener('click', () => dijalogLista.close());
dijalogLista.addEventListener('click', (event) => {
    if (event.target === dijalogLista) dijalogLista.close();
});


ucitaj();
