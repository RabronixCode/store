// ---------- Stranica Dobavljači (vlasnik) ----------
//
// Ugovor sa serverom:
//   GET /dobavljaci/pregled -> [{ dobavljac_id, naziv, dugi_naziv, pib, tip, mesto, telefon, email, aktivan,
//                                broj_artikala, broj_ulaza, poslednji_ulaz }]
//   GET /dobavljaci/<id>    -> svi podaci (za izmenu)
//   Unos i izmena: dobavljac-forma.js (Dobavljaci.otvoriFormu)

const poruka = document.getElementById('poruka');
const telo = document.getElementById('dobavljaci-telo');
const sablon = document.getElementById('dobavljac-sablon');
const brojac = document.getElementById('brojac');
const nema = document.getElementById('nema-dobavljaca');
const pretraga = document.getElementById('pretraga');
const filterStatus = document.getElementById('filter-status');

const BROJCANE = new Set(['broj_artikala', 'broj_ulaza', 'aktivan']);

let dobavljaci = [];
let sort = { kolona: 'naziv', smer: 'asc' };
let istaknutId = null;   // upravo dodat ili izmenjen dobavljač


// ---------- Pomoćne ----------

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
    if (vrsta === 'uspeh') {
        clearTimeout(javi.tajmer);
        javi.tajmer = setTimeout(() => { if (poruka.textContent === tekst) javi(''); }, 4000);
    }
}

function normalizuj(tekst) {
    return String(tekst ?? '').toLowerCase().replaceAll('đ', 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "2026-11-24" -> "24.11.2026."
function formatDatum(datum) {
    if (!datum) return '—';
    const [g, m, d] = String(datum).slice(0, 10).split('-');
    return d && m && g ? `${d}.${m}.${g}.` : datum;
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
    return greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message;
}


// ---------- Spisak ----------

function uporedi(a, b) {
    const { kolona, smer } = sort;
    const x = a[kolona], y = b[kolona];
    const praznoX = x === null || x === undefined || x === '', praznoY = y === null || y === undefined || y === '';
    if (praznoX && praznoY) return a.naziv.localeCompare(b.naziv, 'sr');
    if (praznoX) return 1;            // prazno uvek na kraj
    if (praznoY) return -1;
    const r = BROJCANE.has(kolona)
        ? x - y
        : String(x).localeCompare(String(y), 'sr', { numeric: true, sensitivity: 'base' });
    return (smer === 'desc' ? -r : r) || a.naziv.localeCompare(b.naziv, 'sr');
}

function nacrtaj() {
    const trazi = normalizuj(pretraga.value.trim());
    const status = filterStatus.value;
    const lista = dobavljaci
        .filter((d) => status === '' || String(d.aktivan) === status)
        .filter((d) => !trazi || [d.naziv, d.dugi_naziv, d.pib, d.mesto, d.telefon, d.email]
            .some((v) => normalizuj(v).includes(trazi)))
        .sort(uporedi);

    telo.replaceChildren(...lista.map((d) => {
        const red = sablon.content.firstElementChild.cloneNode(true);
        red.dataset.id = d.dobavljac_id;
        red.classList.toggle('neaktivan', !d.aktivan);
        const polje = (ime) => red.querySelector(`[data-polje="${ime}"]`);
        const veza = polje('naziv');
        veza.textContent = d.naziv;
        veza.href = `/vlasnik/dobavljac.html?id=${d.dobavljac_id}`;
        polje('dugi_naziv').textContent = d.dugi_naziv && d.dugi_naziv !== d.naziv ? d.dugi_naziv : '';
        const pib = polje('pib');
        pib.textContent = d.pib || 'nema PIB';
        pib.classList.toggle('fali', !d.pib);
        polje('mesto').textContent = d.mesto || '—';
        polje('telefon').textContent = d.telefon || '—';
        polje('broj_artikala').textContent = d.broj_artikala;
        polje('broj_ulaza').textContent = d.broj_ulaza;
        polje('poslednji_ulaz').textContent = formatDatum(d.poslednji_ulaz);
        const status = polje('aktivan');
        status.textContent = d.aktivan ? 'Aktivan' : 'Neaktivan';
        status.classList.add(d.aktivan ? 'zelena' : 'siva');
        if (d.dobavljac_id === istaknutId) red.classList.add('novo');
        return red;
    }));

    nema.hidden = lista.length > 0;
    nema.textContent = dobavljaci.length === 0
        ? 'Još nema dobavljača. Dodaj prvog dugmetom „+ Novi dobavljač“.'
        : 'Nijedan dobavljač ne odgovara pretrazi.';
    const aktivnih = dobavljaci.filter((d) => d.aktivan).length;
    brojac.textContent = lista.length === dobavljaci.length
        ? `Ukupno ${dobavljaci.length} dobavljača (aktivnih ${aktivnih})`
        : `Prikazano ${lista.length} od ${dobavljaci.length} dobavljača`;

    document.querySelectorAll('tr.naslovi th[data-kolona]').forEach((th) => {
        const aktivna = th.dataset.kolona === sort.kolona;
        th.setAttribute('aria-sort', aktivna ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

async function ucitaj() {
    try {
        dobavljaci = await procitaj(await fetch('/dobavljaci/pregled'), 'Dobavljači trenutno ne mogu da se učitaju.');
        nacrtaj();
    } catch (greska) {
        brojac.textContent = '';
        javi(porukaGreske(greska), 'greska');
    }
}


// ---------- Unos i izmena ----------

async function sacuvajIPrikazi(promis, tekstUspeha) {
    try {
        const d = await promis;
        if (!d) return;                     // odustao
        istaknutId = d.dobavljac_id;
        await ucitaj();
        javi(tekstUspeha(d), 'uspeh');
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
    }
}

document.getElementById('novi-dobavljac').addEventListener('click', () => {
    sacuvajIPrikazi(Dobavljaci.otvoriFormu(null), (d) => `Dobavljač „${d.naziv}“ je sačuvan.`);
});

telo.addEventListener('click', async (event) => {
    const red = event.target.closest('tr.red-dobavljac');
    if (!red) return;
    if (event.target.closest('.izmeni')) {
        try {
            const ceo = await procitaj(await fetch(`/dobavljaci/${red.dataset.id}`), 'Podaci dobavljača ne mogu da se učitaju.');
            sacuvajIPrikazi(Dobavljaci.otvoriFormu(ceo), (d) => `Izmene za „${d.naziv}“ su sačuvane.`);
        } catch (greska) {
            javi(porukaGreske(greska), 'greska');
        }
        return;
    }
    // Klik bilo gde u redu (ne samo na naziv) otvara dobavljača
    if (!event.target.closest('a')) window.location.href = red.querySelector('.dobavljac-veza').href;
});


// ---------- Sortiranje, pretraga, filter ----------

document.querySelector('tr.naslovi').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-kolona]');
    if (!th || !event.target.closest('.sortiraj')) return;
    const kolona = th.dataset.kolona;
    sort = (sort.kolona === kolona)
        ? { kolona, smer: sort.smer === 'asc' ? 'desc' : 'asc' }
        : { kolona, smer: BROJCANE.has(kolona) || kolona === 'poslednji_ulaz' ? 'desc' : 'asc' };
    nacrtaj();
});

pretraga.addEventListener('input', nacrtaj);
filterStatus.addEventListener('change', nacrtaj);

ucitaj();
