// ---------- Svi ulazi (vlasnik) ----------
//
// Ugovor sa serverom:
//   GET /ulazi        -> [{ ulaz_id, dobavljac_id, dobavljac, racun_broj, racun_poziv_na_broj, ulaz_datum,
//                           otpremnica_broj, otpremnica_datum, valuta_datum, datum_vreme,
//                           broj_stavki, ukupno_bez_pdv, ukupno_sa_pdv }]
//   GET /ulazi/<id>   -> isto zaglavlje + stavke: [{ stavka_id, sifra, naziv, jedinica_mere, sifra_dobavljac,
//                                                   kolicina, nabavna_cena, pdv, nabavna_cena_pdv }]
//   PUT /ulazi/<id>   telo: { racun_broj, racun_poziv_na_broj, ulaz_datum, otpremnica_broj, otpremnica_datum,
//                             valuta_datum, stavke: [{ stavka_id, sifra_dobavljac, kolicina, nabavna_cena, pdv }] }
//                     -> izmenjen ulaz (kao GET /ulazi/<id>)

const telo = document.getElementById('ulazi-telo');
const sablonUlaz = document.getElementById('ulaz-sablon');
const poruka = document.getElementById('poruka');
const pretraga = document.getElementById('pretraga');
const filterDobavljac = document.getElementById('filter-dobavljac');

const TEKSTUALNE = new Set(['dobavljac', 'racun_broj', 'otpremnica_broj', 'ulaz_datum', 'otpremnica_datum', 'valuta_datum', 'datum_vreme']);
const POLJA_ZAGLAVLJA = ['racun_broj', 'racun_poziv_na_broj', 'ulaz_datum', 'otpremnica_broj', 'otpremnica_datum', 'valuta_datum'];

let ulazi = [];
let sort = { kolona: 'ulaz_id', smer: 'desc' };


// ---------- Pomoćne ----------

function formatBroj(broj, decimala = 2) {
    return Number(broj).toLocaleString('sr-RS', { minimumFractionDigits: decimala, maximumFractionDigits: decimala });
}

function formatDatum(datum) {
    if (!datum) return '—';
    const [g, m, d] = String(datum).slice(0, 10).split('-');
    const vreme = String(datum).length > 10 ? ` ${String(datum).slice(11, 16)}` : '';
    return d && m && g ? `${d}.${m}.${g}.${vreme}` : datum;
}

function danas() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizuj(tekst) {
    return String(tekst ?? '').toLowerCase().replaceAll('đ', 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function javi(el, tekst, vrsta = '') {
    el.textContent = tekst;
    el.className = vrsta;
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
    const praznoX = x === null || x === '', praznoY = y === null || y === '';
    if (praznoX && praznoY) return b.ulaz_id - a.ulaz_id;
    if (praznoX) return 1;
    if (praznoY) return -1;
    const r = TEKSTUALNE.has(kolona)
        ? String(x).localeCompare(String(y), 'sr', { numeric: true, sensitivity: 'base' })
        : x - y;
    return (smer === 'desc' ? -r : r) || b.ulaz_id - a.ulaz_id;
}

function vidljivi() {
    const trazi = normalizuj(pretraga.value.trim()).replace(/^#/, '');
    const dob = filterDobavljac.value;
    return ulazi
        .filter((u) => !dob || String(u.dobavljac_id) === dob)
        .filter((u) => !trazi || [u.ulaz_id, u.dobavljac, u.racun_broj, u.racun_poziv_na_broj, u.otpremnica_broj]
            .some((v) => normalizuj(v).includes(trazi)))
        .sort(uporedi);
}

function popuniRed(red, u) {
    const p = (ime) => red.querySelector(`[data-polje="${ime}"]`);
    red.dataset.id = u.ulaz_id;
    p('ulaz_id').textContent = u.ulaz_id;
    p('dobavljac').textContent = u.dobavljac;
    p('racun_broj').textContent = u.racun_broj || '—';
    p('racun_poziv_na_broj').textContent = u.racun_poziv_na_broj ? `poziv: ${u.racun_poziv_na_broj}` : '';
    p('ulaz_datum').textContent = formatDatum(u.ulaz_datum);
    p('otpremnica_broj').textContent = u.otpremnica_broj || '—';
    p('otpremnica_datum').textContent = formatDatum(u.otpremnica_datum);
    p('valuta_datum').textContent = formatDatum(u.valuta_datum);
    p('broj_stavki').textContent = u.broj_stavki;
    p('ukupno_bez_pdv').textContent = formatBroj(u.ukupno_bez_pdv);
    p('ukupno_sa_pdv').textContent = formatBroj(u.ukupno_sa_pdv);
    p('datum_vreme').textContent = formatDatum(u.datum_vreme);
    for (const ime of ['racun_broj', 'otpremnica_broj', 'ulaz_datum', 'otpremnica_datum', 'valuta_datum']) {
        p(ime).classList.toggle('prazno', !u[ime]);
    }
}

function nacrtaj() {
    const lista = vidljivi();
    telo.replaceChildren(...lista.map((u) => {
        const red = sablonUlaz.content.firstElementChild.cloneNode(true);
        popuniRed(red, u);
        return red;
    }));

    const nema = document.getElementById('nema-ulaza');
    nema.hidden = lista.length > 0;
    nema.textContent = ulazi.length === 0 ? 'Još nema nijednog ulaza robe.' : 'Nijedan ulaz ne odgovara pretrazi.';
    document.getElementById('brojac').textContent = `Ukupno ${ulazi.length} ulaza`;
    document.getElementById('k-broj').textContent = lista.length;
    document.getElementById('k-bez').textContent = `${formatBroj(lista.reduce((z, u) => z + u.ukupno_bez_pdv, 0))} RSD`;
    document.getElementById('k-sa').textContent = `${formatBroj(lista.reduce((z, u) => z + u.ukupno_sa_pdv, 0))} RSD`;

    document.querySelectorAll('tr.naslovi th[data-kolona]').forEach((th) => {
        const aktivna = th.dataset.kolona === sort.kolona;
        th.setAttribute('aria-sort', aktivna ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

async function ucitaj() {
    try {
        ulazi = await procitaj(await fetch('/ulazi'), 'Ulazi ne mogu da se učitaju.');
        const izabran = filterDobavljac.value;
        const dobavljaci = [...new Map(ulazi.map((u) => [u.dobavljac_id, u.dobavljac])).entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'sr'));
        filterDobavljac.replaceChildren(new Option('Svi dobavljači', ''),
            ...dobavljaci.map(([id, naziv]) => new Option(naziv, id)));
        filterDobavljac.value = izabran;
        nacrtaj();
    } catch (greska) {
        document.getElementById('brojac').textContent = '';
        javi(poruka, porukaGreske(greska), 'greska');
    }
}

document.querySelector('tr.naslovi').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-kolona]');
    if (!th || !event.target.closest('.sortiraj')) return;
    const kolona = th.dataset.kolona;
    sort = (sort.kolona === kolona)
        ? { kolona, smer: sort.smer === 'asc' ? 'desc' : 'asc' }
        : { kolona, smer: TEKSTUALNE.has(kolona) && !kolona.includes('datum') ? 'asc' : 'desc' };
    nacrtaj();
});
pretraga.addEventListener('input', nacrtaj);
filterDobavljac.addEventListener('change', nacrtaj);

telo.addEventListener('click', (event) => {
    const red = event.target.closest('tr.red-ulaz');
    if (red) otvoriUlaz(Number(red.dataset.id));
});
telo.addEventListener('keydown', (event) => {
    const red = event.target.closest('tr.red-ulaz');
    if (red && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        otvoriUlaz(Number(red.dataset.id));
    }
});


// ---------- Popup: jedan ulaz ----------

const dijalog = document.getElementById('dijalog-ulaz');
const formaIzmena = document.getElementById('forma-izmena');
const stavkeTelo = document.getElementById('stavke-telo');
const sablonStavka = document.getElementById('stavka-izmena-sablon');
const porukaIzmena = document.getElementById('poruka-izmena');
const dugmeSacuvaj = document.getElementById('sacuvaj-izmene');

let otvoren = null;        // ulaz kakav je na serveru (posle poslednjeg učitavanja/čuvanja)
let cuvanje = false;

function procitajBroj(input) {
    const t = input.value.trim().replace(',', '.');
    return t === '' ? null : Number(t);
}

function popuniDijalog(u) {
    otvoren = u;
    document.getElementById('ulaz-naslov').textContent = `Ulaz #${u.ulaz_id} · ${u.dobavljac}`;
    document.getElementById('ulaz-podnaslov').textContent = `Uneto ${formatDatum(u.datum_vreme)} · ${u.stavke.length} stavki`;
    for (const ime of POLJA_ZAGLAVLJA) {
        const el = formaIzmena.elements[ime];
        el.value = u[ime] ?? '';
        el.removeAttribute('aria-invalid');
    }
    for (const ime of ['ulaz_datum', 'otpremnica_datum']) formaIzmena.elements[ime].max = danas();

    stavkeTelo.replaceChildren(...u.stavke.map((s) => {
        const red = sablonStavka.content.firstElementChild.cloneNode(true);
        red.dataset.id = s.stavka_id;
        red.querySelector('[data-polje="sifra"]').textContent = s.sifra;
        red.querySelector('[data-polje="naziv"]').textContent = s.naziv || '(bez naziva)';
        red.querySelector('[data-polje="jedinica_mere"]').textContent = s.jedinica_mere || '—';
        red.querySelector('[name="sifra_dobavljac"]').value = s.sifra_dobavljac ?? '';
        red.querySelector('[name="kolicina"]').value = s.kolicina;
        red.querySelector('[name="nabavna_cena"]').value = s.nabavna_cena;
        red.querySelector('[name="pdv"]').value = s.pdv;
        return red;
    }));
    osveziZbirove();
    osveziDugme();
}

// Iznos po stavci i ukupno (bez PDV i sa PDV), uživo dok se kuca
function osveziZbirove() {
    let bez = 0, sa = 0;
    stavkeTelo.querySelectorAll('tr').forEach((red) => {
        const k = procitajBroj(red.querySelector('[name="kolicina"]'));
        const c = procitajBroj(red.querySelector('[name="nabavna_cena"]'));
        const p = procitajBroj(red.querySelector('[name="pdv"]'));
        const ok = [k, c, p].every((x) => x !== null && Number.isFinite(x));
        const b = ok ? k * c : null, s = ok ? k * c * (1 + p / 100) : null;
        red.querySelector('[data-polje="iznos_bez"]').textContent = ok ? formatBroj(b) : '—';
        red.querySelector('[data-polje="iznos_sa"]').textContent = ok ? formatBroj(s) : '—';
        if (ok) { bez += b; sa += s; }
    });
    document.getElementById('ukupno-bez').textContent = `${formatBroj(bez)} RSD`;
    document.getElementById('ukupno-sa').textContent = `${formatBroj(sa)} RSD`;
}

function izmenjeneStavke() {
    return [...stavkeTelo.querySelectorAll('tr')].map((red) => {
        const stara = otvoren.stavke.find((s) => s.stavka_id === Number(red.dataset.id));
        const nova = {
            stavka_id: stara.stavka_id,
            sifra_dobavljac: red.querySelector('[name="sifra_dobavljac"]').value.trim() || null,
            kolicina: procitajBroj(red.querySelector('[name="kolicina"]')),
            nabavna_cena: procitajBroj(red.querySelector('[name="nabavna_cena"]')),
            pdv: procitajBroj(red.querySelector('[name="pdv"]'))
        };
        const promenjena = nova.sifra_dobavljac !== (stara.sifra_dobavljac || null)
            || nova.kolicina !== stara.kolicina || nova.nabavna_cena !== stara.nabavna_cena || nova.pdv !== stara.pdv;
        return { red, nova, promenjena };
    });
}

function zaglavljeIzmenjeno() {
    return POLJA_ZAGLAVLJA.some((ime) => formaIzmena.elements[ime].value.trim() !== (otvoren[ime] ?? ''));
}

function imaIzmena() {
    return otvoren && (zaglavljeIzmenjeno() || izmenjeneStavke().some((x) => x.promenjena));
}

function osveziDugme() {
    dugmeSacuvaj.disabled = cuvanje || !imaIzmena();
}

async function otvoriUlaz(id) {
    javi(porukaIzmena, '');
    try {
        const u = await procitaj(await fetch(`/ulazi/${id}`), 'Ulaz ne može da se učita.');
        popuniDijalog(u);
        if (!dijalog.open) dijalog.showModal();
    } catch (greska) {
        javi(poruka, porukaGreske(greska), 'greska');
    }
}

function zatvori() {
    if (imaIzmena() && !window.confirm('Imaš nesačuvane izmene. Zatvoriti bez čuvanja?')) return;
    dijalog.close();
    otvoren = null;
}

document.getElementById('zatvori').addEventListener('click', zatvori);
document.getElementById('zatvori-x').addEventListener('click', zatvori);
dijalog.addEventListener('cancel', (event) => { event.preventDefault(); zatvori(); });
dijalog.addEventListener('click', (event) => { if (event.target === dijalog) zatvori(); });

formaIzmena.addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
    javi(porukaIzmena, '');
    osveziZbirove();
    osveziDugme();
});

// Enter u polju ne čuva slučajno; čuva se samo dugmetom
formaIzmena.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) event.preventDefault();
});

function proveri() {
    const e = formaIzmena.elements;
    const v = (ime) => e[ime].value.trim();
    const sad = danas();
    const greska = (el, tekst) => ({ el, tekst });

    if (!v('racun_broj') && !v('otpremnica_broj')) return greska(e.racun_broj, 'Unesi broj računa ili broj otpremnice.');
    if (!v('ulaz_datum') && !v('otpremnica_datum')) return greska(e.ulaz_datum, 'Unesi datum računa ili datum otpremnice.');
    if (v('racun_poziv_na_broj') && !v('racun_broj')) return greska(e.racun_poziv_na_broj, 'Poziv na broj ide uz račun: unesi i broj računa.');
    for (const [ime, naziv] of [['ulaz_datum', 'Datum računa'], ['otpremnica_datum', 'Datum otpremnice']]) {
        if (e[ime].validity.badInput) return greska(e[ime], `${naziv} nije ispravan.`);
        if (v(ime) && v(ime) > sad) return greska(e[ime], `${naziv} ne može biti u budućnosti.`);
        if (v(ime) && v(ime) < '2000-01-01') return greska(e[ime], `${naziv} je pre 2000. godine. Proveri unos.`);
    }
    const datumi = [v('ulaz_datum'), v('otpremnica_datum')].filter(Boolean).sort();
    if (v('valuta_datum') && v('valuta_datum') < datumi[0]) return greska(e.valuta_datum, 'Valuta ne može biti pre datuma računa/otpremnice.');

    for (const { red, nova } of izmenjeneStavke()) {
        const naziv = red.querySelector('[data-polje="naziv"]').textContent;
        if (nova.kolicina === null || !Number.isFinite(nova.kolicina) || nova.kolicina <= 0)
            return greska(red.querySelector('[name="kolicina"]'), `${naziv}: količina mora biti broj veći od 0.`);
        if (nova.nabavna_cena === null || !Number.isFinite(nova.nabavna_cena) || nova.nabavna_cena < 0)
            return greska(red.querySelector('[name="nabavna_cena"]'), `${naziv}: nabavna cena mora biti broj 0 ili veći.`);
        if (nova.pdv === null || !Number.isFinite(nova.pdv) || nova.pdv < 0 || nova.pdv > 100)
            return greska(red.querySelector('[name="pdv"]'), `${naziv}: PDV mora biti od 0 do 100.`);
    }
    return null;
}

formaIzmena.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (cuvanje || !imaIzmena()) return;
    const g = proveri();
    if (g) {
        g.el.setAttribute('aria-invalid', 'true');
        g.el.focus();
        javi(porukaIzmena, g.tekst, 'greska');
        return;
    }

    const e = formaIzmena.elements;
    const zahtev = Object.fromEntries(POLJA_ZAGLAVLJA.map((ime) => [ime, e[ime].value.trim() || null]));
    zahtev.stavke = izmenjeneStavke().filter((x) => x.promenjena).map((x) => x.nova);

    cuvanje = true;
    osveziDugme();
    dugmeSacuvaj.textContent = 'Čuvanje…';
    try {
        const odgovor = await fetch(`/ulazi/${otvoren.ulaz_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(zahtev)
        });
        const u = await procitaj(odgovor, 'Izmene nisu sačuvane.');
        popuniDijalog(u);
        javi(porukaIzmena, 'Izmene su sačuvane.', 'uspeh');
        // Osveži i red u spisku
        const i = ulazi.findIndex((x) => x.ulaz_id === u.ulaz_id);
        if (i >= 0) ulazi[i] = { ...ulazi[i], ...u, broj_stavki: u.stavke.length };
        nacrtaj();
    } catch (greska) {
        javi(porukaIzmena, `Nije sačuvano. ${porukaGreske(greska)}`, 'greska');
    } finally {
        cuvanje = false;
        dugmeSacuvaj.textContent = 'Sačuvaj izmene';
        osveziDugme();
    }
});

ucitaj();
