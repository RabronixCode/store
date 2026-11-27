// ---------- Finansije (vlasnik) ----------
//
// Ugovor sa serverom (sve vrednosti posle storna, prodajna sa PDV):
//   GET /finansije/filteri                                   -> { dobavljaci: [{dobavljac_id, naziv}], kategorije: [..] }
//   GET /finansije/artikli?od&do&artikal&kategorija&dobavljac_id&nacin
//                                                            -> { artikli: [{ sifra, naziv, jedinica_mere, kategorija, dobavljac,
//                                                                 cena, kolicina, broj_racuna, prodajna, porez, nabavna, razlika,
//                                                                 vise_cena }], zbir }
//   GET /finansije/dani?od&do&artikal (datumi YYYY-MM-DD)    -> { dani: [{ datum, broj_racuna, ukupno, gotovina, kartica, cek }], zbir }
//   GET /finansije/dan?datum&artikal                         -> { artikli, zbir, po_nacinu }
//   GET /finansije/dobavljaci?od&do&dobavljac_id&artikal     -> { dobavljaci: [{ dobavljac, broj_artikala, broj_racuna, udeo,
//                                                                 prodajna, porez, nabavna, razlika, artikli }], zbir }
//   GET /finansije/bilans?od=YYYY-MM&do=YYYY-MM&artikal      -> { meseci: [{ mesec, broj_dana, tekuci, broj_racuna,
//                                                                 nabavna, porez, prodajna, razlika }], zbir }

const poruka = document.getElementById('poruka');
const MESECI = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
const NAZIV_NACINA = { gotovina: 'Gotovina', kartica: 'Kartica', cek: 'Ček' };


// ---------- Pomoćne ----------

const formatNovac = (b) => Number(b).toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatKolicina = (b) => Number(b).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
const dv = (n) => String(n).padStart(2, '0');
const datumPolje = (d) => `${d.getFullYear()}-${dv(d.getMonth() + 1)}-${dv(d.getDate())}`;
const datumVremePolje = (d) => `${datumPolje(d)}T${dv(d.getHours())}:${dv(d.getMinutes())}`;
const mesecPolje = (d) => `${d.getFullYear()}-${dv(d.getMonth() + 1)}`;

function formatDatum(iso) {                // "2026-11-27" -> "27.11.2026."
    const [g, m, d] = iso.slice(0, 10).split('-');
    return `${d}.${m}.${g}.`;
}
function formatDatumVreme(tekst) {         // "2026-11-27 08:00:00" -> "27.11.2026. 08:00"
    return `${formatDatum(tekst)} ${tekst.slice(11, 16)}`;
}
function nazivMeseca(kljuc) {              // "2026-11" -> "novembar 2026."
    const [g, m] = kljuc.split('-');
    return `${MESECI[Number(m) - 1]} ${g}.`;
}
function danUNedelji(iso) {
    return ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'][new Date(`${iso}T12:00`).getDay()];
}

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
}

async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu stranicu. Prijavi se kao vlasnik.');
    const telo = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof telo === 'string' ? telo : podrazumevanaGreska);
    return telo;
}
const porukaGreske = (g) => (g.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : g.message);

function el(oznaka, svojstva = {}, ...deca) {
    const e = document.createElement(oznaka);
    Object.assign(e, svojstva);
    e.append(...deca);
    return e;
}


// ---------- Tabela sa sortiranjem ----------
//
// kolone: [{ kljuc, naslov, tip: 'tekst' | 'broj' | 'novac' | 'kolicina', prikaz(red) -> tekst/element, klasa(red) }]
// opcije: { zbir: red za podnožje, klik(red, tr), prosiri(red) -> element (red ispod, otvara se klikom), prazno }

const sortovi = new WeakMap();

function nacrtajTabelu(tabela, kolone, redovi, opcije = {}) {
    const sort = sortovi.get(tabela) || opcije.sort || null;
    const lista = [...redovi];
    if (sort) {
        const k = kolone.find((x) => x.kljuc === sort.kljuc);
        const brojcana = k && k.tip !== 'tekst';
        lista.sort((a, b) => {
            const x = a[sort.kljuc], y = b[sort.kljuc];
            const r = brojcana ? (x ?? -Infinity) - (y ?? -Infinity)
                : String(x ?? '').localeCompare(String(y ?? ''), 'sr', { numeric: true, sensitivity: 'base' });
            return sort.smer === 'desc' ? -r : r;
        });
    }

    const zaglavlje = el('tr', {}, ...kolone.map((k) => {
        const th = el('th', { scope: 'col', className: k.tip && k.tip !== 'tekst' ? 'desno' : '' });
        const dugme = el('button', { type: 'button', className: 'sortiraj', textContent: k.naslov });
        if (k.opis) dugme.title = k.opis;
        dugme.addEventListener('click', () => {
            const novi = sort && sort.kljuc === k.kljuc
                ? { kljuc: k.kljuc, smer: sort.smer === 'asc' ? 'desc' : 'asc' }
                : { kljuc: k.kljuc, smer: k.tip && k.tip !== 'tekst' ? 'desc' : 'asc' };
            sortovi.set(tabela, novi);
            nacrtajTabelu(tabela, kolone, redovi, opcije);
        });
        th.setAttribute('aria-sort', sort && sort.kljuc === k.kljuc ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
        th.append(dugme);
        return th;
    }));

    const celija = (k, red) => {
        const td = el('td', { className: [k.tip && k.tip !== 'tekst' ? 'desno' : '', k.klasa ? k.klasa(red) : ''].join(' ').trim() });
        const v = k.prikaz ? k.prikaz(red) : red[k.kljuc];
        if (v instanceof Node) td.append(v);
        else td.textContent = v === null || v === undefined || v === '' ? '—'
            : k.tip === 'novac' ? formatNovac(v) : k.tip === 'kolicina' ? formatKolicina(v) : v;
        return td;
    };

    const telo = el('tbody');
    lista.forEach((red) => {
        const tr = el('tr', {}, ...kolone.map((k) => celija(k, red)));
        if (opcije.klik || opcije.prosiri) {
            tr.tabIndex = 0;
            tr.className = 'klik';
            const akcija = () => {
                if (opcije.klik) return opcije.klik(red, tr);
                const sledeci = tr.nextElementSibling;
                if (sledeci && sledeci.classList.contains('prosireno')) {
                    sledeci.remove();
                    tr.setAttribute('aria-expanded', 'false');
                } else {
                    tr.after(el('tr', { className: 'prosireno' },
                        el('td', { colSpan: kolone.length }, opcije.prosiri(red))));
                    tr.setAttribute('aria-expanded', 'true');
                }
            };
            tr.addEventListener('click', akcija);
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); akcija(); }
            });
            if (opcije.prosiri) tr.setAttribute('aria-expanded', 'false');
        }
        telo.append(tr);
    });
    if (!lista.length) {
        telo.append(el('tr', {}, el('td', { colSpan: kolone.length, className: 'prazno-red',
            textContent: opcije.prazno || 'Nema prodaje u izabranom periodu.' })));
    }

    const delovi = [el('thead', {}, zaglavlje), telo];
    if (opcije.zbir && lista.length) {
        delovi.push(el('tfoot', {}, el('tr', {}, ...kolone.map((k, i) => {
            if (i === 0) return el('th', { scope: 'row', textContent: 'UKUPNO' });
            return k.uZbiru ? celija(k, opcije.zbir) : el('td');
        }))));
    }
    tabela.replaceChildren(...delovi);
}

function karticeZbira(okvir, kartice) {
    okvir.replaceChildren(...kartice.map(([naslov, vrednost, klasa = '', opis = '']) =>
        el('div', { className: `kartica-zbira ${klasa}`, title: opis },
            el('span', { textContent: naslov }), el('strong', { textContent: vrednost }))));
}

const KOLONE_ARTIKALA = [
    { kljuc: 'sifra', naslov: 'Šifra', tip: 'broj' },
    {
        kljuc: 'naziv', naslov: 'Naziv', tip: 'tekst', klasa: () => 'jako',
        prikaz: (r) => (r.vise_cena
            ? el('span', {}, r.naziv, ' ', el('span', { className: 'znacka-cene', textContent: 'više cena' }))
            : r.naziv)
    },
    { kljuc: 'jedinica_mere', naslov: 'JM', tip: 'tekst', klasa: () => 'prigusen' },
    { kljuc: 'cena', naslov: 'Prodajna cena', tip: 'novac', opis: 'Cena po kojoj je prodato (sa PDV)' },
    { kljuc: 'kolicina', naslov: 'Količina', tip: 'kolicina' },
    { kljuc: 'prodajna', naslov: 'Prodajna vrednost', tip: 'novac', uZbiru: true, klasa: () => 'jako' },
    { kljuc: 'porez', naslov: 'Porez (PDV)', tip: 'novac', uZbiru: true },
    { kljuc: 'nabavna', naslov: 'Nabavna vrednost', tip: 'novac', uZbiru: true, opis: 'Količina × prosečna nabavna cena bez PDV u trenutku prodaje' },
    { kljuc: 'razlika', naslov: 'Razlika', tip: 'novac', uZbiru: true, klasa: (r) => (r.razlika < 0 ? 'minus' : 'plus'),
      opis: 'Prodajna vrednost − (nabavna vrednost + porez)' },
    { kljuc: 'broj_racuna', naslov: 'Računa', tip: 'broj' },
];

function karticeVrednosti(z, dodatno = []) {
    return [
        ['Prodajna vrednost', `${formatNovac(z.prodajna)} RSD`, 'glavna'],
        ['Porez (PDV)', `${formatNovac(z.porez)} RSD`],
        ['Nabavna vrednost', `${formatNovac(z.nabavna)} RSD`],
        ['Razlika', `${formatNovac(z.razlika)} RSD`, z.razlika < 0 ? 'minus' : 'plus', 'Prodajna − (nabavna + porez)'],
        ...dodatno,
    ];
}


// ---------- Filteri i periodi ----------

function postaviPeriod(forma, vrsta) {
    const sada = new Date();
    const g = sada.getFullYear(), m = sada.getMonth(), d = sada.getDate();
    const tip = forma.elements.od.type;
    let od, doo;
    if (vrsta === 'danas') { od = new Date(g, m, d); doo = new Date(g, m, d, 23, 59); }
    else if (vrsta === 'nedelja') { od = new Date(g, m, d - 6); doo = new Date(g, m, d, 23, 59); }
    else if (vrsta === 'mesec') { od = new Date(g, m, 1); doo = new Date(g, m, d, 23, 59); }
    else if (vrsta === 'prosli') { od = new Date(g, m - 1, 1); doo = new Date(g, m, 0, 23, 59); }
    else if (vrsta === 'godina') { od = new Date(g, 0, 1); doo = new Date(g, m, d, 23, 59); }
    else if (vrsta === '12') { od = new Date(g, m - 11, 1); doo = new Date(g, m, 1); }
    const f = tip === 'month' ? mesecPolje : tip === 'date' ? datumPolje : datumVremePolje;
    forma.elements.od.value = f(od);
    forma.elements.do.value = f(doo);
}

function parametri(forma) {
    const p = new URLSearchParams();
    for (const e of forma.elements) {
        if (e.name && e.value.trim() !== '') p.set(e.name, e.value.trim());
    }
    return p;
}

const izvestaji = {};      // ime -> async function(forma)

async function pokreni(forma) {
    const od = forma.elements.od.value, doo = forma.elements.do.value;
    if (!od || !doo) return javi('Upiši period „od“ i „do“.', 'greska');
    if (od > doo) return javi('„Od“ je posle „do“. Proveri period.', 'greska');
    javi('');
    forma.classList.add('ucitava');
    // Stariji odgovor (npr. dok se kuca naziv artikla) ne sme da prepiše noviji
    const moj = (forma._zahtev = (forma._zahtev || 0) + 1);
    try {
        await izvestaji[forma.dataset.izvestaj](forma, () => forma._zahtev === moj);
    } catch (g) {
        javi(porukaGreske(g), 'greska');
    } finally {
        forma.classList.remove('ucitava');
    }
}

document.querySelectorAll('form.filteri').forEach((forma) => {
    forma.addEventListener('submit', (e) => { e.preventDefault(); pokreni(forma); });
    forma.addEventListener('change', (e) => { if (e.target.matches('select')) pokreni(forma); });
    let tajmer;
    forma.elements.artikal.addEventListener('input', () => {        // pretraga artikla: odmah, bez klika
        clearTimeout(tajmer);
        tajmer = setTimeout(() => pokreni(forma), 350);
    });
    forma.querySelector('.brzo').addEventListener('click', (e) => {
        const dugme = e.target.closest('[data-period]');
        if (!dugme) return;
        postaviPeriod(forma, dugme.dataset.period);
        pokreni(forma);
    });
});


// ---------- 1. Prodaja po artiklima ----------

izvestaji.artikli = async (forma, aktuelan) => {
    const r = await procitaj(await fetch(`/finansije/artikli?${parametri(forma)}`), 'Prodaja po artiklima ne može da se učita.');
    if (!aktuelan()) return;
    karticeZbira(document.querySelector('[data-zbir="artikli"]'), karticeVrednosti(r.zbir, [
        ['Stavki / računa', `${r.zbir.broj_stavki} / ${r.zbir.broj_racuna}`],
    ]));
    nacrtajTabelu(document.getElementById('tabela-artikli'), KOLONE_ARTIKALA, r.artikli,
        { zbir: r.zbir, sort: { kljuc: 'prodajna', smer: 'desc' } });
};


// ---------- 2. Prodaja po transakcijama (po danima) ----------

const KOLONE_DANA = [
    { kljuc: 'datum', naslov: 'Datum', tip: 'tekst', klasa: () => 'jako',
      prikaz: (r) => el('span', {}, formatDatum(r.datum), ' ', el('small', { className: 'prigusen', textContent: danUNedelji(r.datum) })) },
    { kljuc: 'broj_racuna', naslov: 'Računa', tip: 'broj', uZbiru: true },
    { kljuc: 'gotovina', naslov: 'Gotovina', tip: 'novac', uZbiru: true },
    { kljuc: 'kartica', naslov: 'Kartice', tip: 'novac', uZbiru: true },
    { kljuc: 'cek', naslov: 'Čekovi', tip: 'novac', uZbiru: true },
    { kljuc: 'ukupno', naslov: 'Ukupno', tip: 'novac', uZbiru: true, klasa: () => 'jako' },
];

izvestaji.dani = async (forma, aktuelan) => {
    const r = await procitaj(await fetch(`/finansije/dani?${parametri(forma)}`), 'Prodaja po danima ne može da se učita.');
    if (!aktuelan()) return;
    const z = r.zbir;
    karticeZbira(document.querySelector('[data-zbir="dani"]'), [
        ['Ukupno', `${formatNovac(z.ukupno)} RSD`, 'glavna'],
        ['💵 Gotovina', `${formatNovac(z.gotovina)} RSD`, 'gotovina'],
        ['💳 Kartice', `${formatNovac(z.kartica)} RSD`, 'kartica'],
        ['🧾 Čekovi', `${formatNovac(z.cek)} RSD`, 'cek'],
        ['Računa', String(z.broj_racuna)],
    ]);
    nacrtajTabelu(document.getElementById('tabela-dani'), KOLONE_DANA, r.dani, {
        zbir: z, sort: { kljuc: 'datum', smer: 'desc' },
        klik: (red) => otvoriDan(red.datum, forma.elements.artikal.value.trim()),
    });
};

const dijalogDan = document.getElementById('dijalog-dan');

async function otvoriDan(datum, artikal) {
    try {
        const p = new URLSearchParams({ datum });
        if (artikal) p.set('artikal', artikal);
        const r = await procitaj(await fetch(`/finansije/dan?${p}`), 'Artikli dana ne mogu da se učitaju.');
        document.getElementById('dan-naslov').textContent = `${formatDatum(datum)} (${danUNedelji(datum)})`;
        document.getElementById('dan-podaci').textContent =
            `${r.zbir.broj_racuna} računa · ${r.zbir.broj_stavki} stavki${artikal ? ` · samo artikal „${artikal}“` : ''}`;
        const n = r.po_nacinu;
        karticeZbira(document.getElementById('dan-zbir'), [
            ['Ukupno', `${formatNovac(n.ukupno)} RSD`, 'glavna'],
            ['Gotovina', `${formatNovac(n.gotovina)} RSD`, 'gotovina'],
            ['Kartice', `${formatNovac(n.kartica)} RSD`, 'kartica'],
            ['Čekovi', `${formatNovac(n.cek)} RSD`, 'cek'],
            ['Razlika', `${formatNovac(r.zbir.razlika)} RSD`, r.zbir.razlika < 0 ? 'minus' : 'plus'],
        ]);
        nacrtajTabelu(document.getElementById('tabela-dan'), KOLONE_ARTIKALA, r.artikli,
            { zbir: r.zbir, sort: { kljuc: 'prodajna', smer: 'desc' } });
        dijalogDan.showModal();
    } catch (g) {
        javi(porukaGreske(g), 'greska');
    }
}
document.querySelectorAll('[data-zatvori]').forEach((d) => d.addEventListener('click', () => d.closest('dialog').close()));
dijalogDan.addEventListener('click', (e) => { if (e.target === dijalogDan) dijalogDan.close(); });


// ---------- 3. Prodaja po dobavljačima ----------

const KOLONE_DOBAVLJACA = [
    { kljuc: 'dobavljac', naslov: 'Dobavljač', tip: 'tekst', klasa: () => 'jako',
      prikaz: (r) => el('span', {}, el('span', { className: 'strelica', textContent: '▸ ' }), r.dobavljac) },
    { kljuc: 'broj_artikala', naslov: 'Artikala', tip: 'broj' },
    { kljuc: 'broj_racuna', naslov: 'Računa', tip: 'broj' },
    { kljuc: 'prodajna', naslov: 'Prodajna vrednost', tip: 'novac', uZbiru: true, klasa: () => 'jako' },
    { kljuc: 'porez', naslov: 'Porez (PDV)', tip: 'novac', uZbiru: true },
    { kljuc: 'nabavna', naslov: 'Nabavna vrednost', tip: 'novac', uZbiru: true },
    { kljuc: 'razlika', naslov: 'Razlika', tip: 'novac', uZbiru: true, klasa: (r) => (r.razlika < 0 ? 'minus' : 'plus') },
    { kljuc: 'udeo', naslov: 'Udeo u prometu', tip: 'broj',
      prikaz: (r) => el('span', { className: 'udeo' },
          el('span', { className: 'udeo-traka', style: `width:${Math.max(2, r.udeo)}%` }),
          el('span', { textContent: `${formatNovac(r.udeo)} %` })) },
];

izvestaji.dobavljaci = async (forma, aktuelan) => {
    const r = await procitaj(await fetch(`/finansije/dobavljaci?${parametri(forma)}`), 'Prodaja po dobavljačima ne može da se učita.');
    if (!aktuelan()) return;
    karticeZbira(document.querySelector('[data-zbir="dobavljaci"]'), karticeVrednosti(r.zbir, [
        ['Dobavljača', String(r.dobavljaci.length)],
    ]));
    nacrtajTabelu(document.getElementById('tabela-dobavljaci'), KOLONE_DOBAVLJACA, r.dobavljaci, {
        zbir: r.zbir, sort: { kljuc: 'prodajna', smer: 'desc' },
        prosiri: (red) => {
            const t = el('table', { className: 'fin-tabela ugnezdena' });
            nacrtajTabelu(t, KOLONE_ARTIKALA, red.artikli, { zbir: red, sort: { kljuc: 'prodajna', smer: 'desc' } });
            return t;
        },
    });
};


// ---------- 4. Mini bilans ----------

const KOLONE_BILANSA = [
    { kljuc: 'mesec', naslov: 'Mesec', tip: 'tekst', klasa: () => 'jako',
      prikaz: (r) => el('span', {}, nazivMeseca(r.mesec), r.tekuci ? el('small', { className: 'tekuci', textContent: ' tekući' }) : '') },
    { kljuc: 'broj_dana', naslov: 'Broj dana', tip: 'broj', uZbiru: true },
    { kljuc: 'nabavna', naslov: 'Nabavna vrednost', tip: 'novac', uZbiru: true },
    { kljuc: 'porez', naslov: 'Porez', tip: 'novac', uZbiru: true },
    { kljuc: 'prodajna', naslov: 'Prodajna vrednost', tip: 'novac', uZbiru: true, klasa: () => 'jako' },
    { kljuc: 'razlika', naslov: 'Razlika', tip: 'novac', uZbiru: true, klasa: (r) => (r.razlika < 0 ? 'minus' : 'plus'),
      opis: 'Prodajna vrednost − (nabavna vrednost + porez)' },
];

izvestaji.bilans = async (forma, aktuelan) => {
    const r = await procitaj(await fetch(`/finansije/bilans?${parametri(forma)}`), 'Mini bilans ne može da se učita.');
    if (!aktuelan()) return;
    karticeZbira(document.querySelector('[data-zbir="bilans"]'), karticeVrednosti(r.zbir, [
        ['Dana', String(r.zbir.broj_dana)],
    ]));
    nacrtajGrafik(document.getElementById('grafik-bilans'), r.meseci);
    nacrtajTabelu(document.getElementById('tabela-bilans'), KOLONE_BILANSA, r.meseci,
        { zbir: r.zbir, sort: { kljuc: 'mesec', smer: 'asc' }, prazno: 'Nema meseci u izabranom periodu.' });
};

// Grafik: stubići = promet (prodajna vrednost), linija = razlika. Čist SVG, bez biblioteka.
function nacrtajGrafik(okvir, meseci) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = (oznaka, atributi = {}, ...deca) => {
        const e = document.createElementNS(NS, oznaka);
        for (const [k, v] of Object.entries(atributi)) e.setAttribute(k, v);
        e.append(...deca);
        return e;
    };
    if (!meseci.length) { okvir.replaceChildren(); return; }
    const W = 900, H = 320, L = 78, R = 16, T = 16, B = 44;
    const vrednosti = meseci.flatMap((m) => [m.prodajna, m.razlika]);
    let max = Math.max(0, ...vrednosti), min = Math.min(0, ...vrednosti);
    if (max === min) max = min + 1;
    // "lep" korak ose: 1, 2 ili 5 × 10^n
    const sirovi = (max - min) / 5;
    const stepen = 10 ** Math.floor(Math.log10(sirovi));
    const korak = [1, 2, 5, 10].map((x) => x * stepen).find((x) => x >= sirovi);
    max = Math.ceil(max / korak) * korak;
    min = Math.floor(min / korak) * korak;
    const y = (v) => T + (max - v) / (max - min) * (H - T - B);
    const sirina = (W - L - R) / meseci.length;
    const x = (i) => L + sirina * i + sirina / 2;

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
        'aria-label': 'Promet i razlika po mesecima' });
    for (let v = min; v <= max + korak / 2; v += korak) {
        svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'osa-nula' : 'mreza' }));
        svg.append(s('text', { x: L - 8, y: y(v) + 4, class: 'oznaka-y' },
            Math.abs(v) >= 1000 ? `${formatKolicina(v / 1000)}k` : formatKolicina(v)));
    }
    meseci.forEach((m, i) => {
        const vrh = y(Math.max(0, m.prodajna)), dno = y(Math.min(0, m.prodajna));
        const stub = s('rect', { x: x(i) - sirina * 0.32, y: vrh, width: sirina * 0.64, height: Math.max(0, dno - vrh), rx: 3, class: 'stub' },
            s('title', {}, `${nazivMeseca(m.mesec)}\nPromet: ${formatNovac(m.prodajna)} RSD\nRazlika: ${formatNovac(m.razlika)} RSD`));
        svg.append(stub);
        const [g, mm] = m.mesec.split('-');
        svg.append(s('text', { x: x(i), y: H - B + 18, class: 'oznaka-x' }, `${MESECI[Number(mm) - 1].slice(0, 3)} ${g.slice(2)}`));
    });
    const tacke = meseci.map((m, i) => `${x(i)},${y(m.razlika)}`).join(' ');
    svg.append(s('polyline', { points: tacke, class: 'linija' }));
    meseci.forEach((m, i) => svg.append(s('circle', { cx: x(i), cy: y(m.razlika), r: 4.5, class: 'tacka' },
        s('title', {}, `${nazivMeseca(m.mesec)}: razlika ${formatNovac(m.razlika)} RSD`))));
    okvir.replaceChildren(svg);
}


// ---------- Jezičci ----------

const jezicci = [...document.querySelectorAll('[role="tab"]')];
const ucitano = new Set();

function izaberiJezicak(tab, fokus = false) {
    jezicci.forEach((t) => {
        const izabran = t === tab;
        t.setAttribute('aria-selected', String(izabran));
        t.tabIndex = izabran ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !izabran;
    });
    if (fokus) tab.focus();
    try { sessionStorage.setItem('finansije-jezicak', tab.id); } catch { /* nema skladišta */ }
    const forma = document.getElementById(tab.getAttribute('aria-controls')).querySelector('form.filteri');
    if (!ucitano.has(forma)) { ucitano.add(forma); pokreni(forma); }
}

jezicci.forEach((t, i) => {
    t.addEventListener('click', () => izaberiJezicak(t));
    t.addEventListener('keydown', (e) => {
        const pomeraj = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (pomeraj) { e.preventDefault(); izaberiJezicak(jezicci[(i + pomeraj + jezicci.length) % jezicci.length], true); }
    });
});


// ---------- Početak ----------

async function pocni() {
    // podrazumevani periodi: artikli i dobavljači ovaj mesec, transakcije poslednjih 7 dana, bilans ova godina
    postaviPeriod(document.querySelector('[data-izvestaj="artikli"]'), 'mesec');
    postaviPeriod(document.querySelector('[data-izvestaj="dani"]'), 'nedelja');
    postaviPeriod(document.querySelector('[data-izvestaj="dobavljaci"]'), 'mesec');
    postaviPeriod(document.querySelector('[data-izvestaj="bilans"]'), 'godina');
    try {
        const f = await procitaj(await fetch('/finansije/filteri'), 'Filteri ne mogu da se učitaju.');
        document.querySelectorAll('select[data-lista="dobavljaci"]').forEach((s) =>
            s.append(...f.dobavljaci.map((d) => new Option(d.naziv, d.dobavljac_id))));
        document.querySelectorAll('select[data-lista="kategorije"]').forEach((s) =>
            s.append(...f.kategorije.map((k) => new Option(k, k))));
    } catch (g) {
        javi(porukaGreske(g), 'greska');
    }
    let pocetni = jezicci[0];
    try { pocetni = document.getElementById(sessionStorage.getItem('finansije-jezicak')) || pocetni; } catch { /* */ }
    izaberiJezicak(pocetni);
}

pocni();
