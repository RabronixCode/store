// ---------- Forme za dobavljača (zajedničko za stranice Dobavljači i Dobavljač) ----------
//
//   Dobavljaci.otvoriFormu(dobavljac | null)              -> Promise<sačuvan dobavljač (ceo) | null>
//   Dobavljaci.otvoriPodstavku(vrsta, dobavljacId, s|null) -> Promise<dobavljač (ceo) | null>
//       vrsta: 'kontakti' | 'racuni' | 'jedinice'
//
// Server: GET /sifarnici, POST /dobavljaci, PUT /dobavljaci/<id>,
//         POST /dobavljaci/<id>/<vrsta>, PUT /dobavljaci/<id>/<vrsta>/<sid>
// Sve se proverava i na serveru; provere ovde su da se greška vidi odmah.

(() => {
    const TIPOVI = [
        ['P', 'P – Pravna lica / Preduzetnici'],
        ['F', 'F – Fizičko lice koje obavlja delatnost'],
        ['R', 'R – Poljoprivredni proizvođač'],
        ['J', 'J – Pravno lice / Korisnik javnih sredstava'],
        ['L', 'L – Fizičko lice'],
    ];
    const PDV_ZONE = [['0', '0 – Srbija'], ['1', '1 – AP Vojvodina'], ['2', '2 – AP Kosovo i Metohija'], ['3', '3 – Inostranstvo']];
    const VALUTE = [['RSD', 'RSD – srpski dinar'], ['EUR', 'EUR – evro'], ['USD', 'USD – američki dolar'],
                    ['CHF', 'CHF – švajcarski franak'], ['GBP', 'GBP – britanska funta'], ['BAM', 'BAM – konvertibilna marka']];

    // Polja: ime, oznaka, vrsta (text|select|check|broj), sirina (1|2 kolone), ostalo po potrebi
    const POLJA_DOBAVLJACA = [
        { sekcija: 'Osnovno' },
        { ime: 'tip', oznaka: 'Tip', vrsta: 'select', opcije: () => TIPOVI, podrazumevano: 'P', sirina: 2 },
        { ime: 'pib', oznaka: 'PIB', obavezno: true, duzina: 30, inputmode: 'numeric', pomoc: '9 cifara (fizičko lice: 13). Strani dobavljač: bilo koji format.' },
        { ime: 'naziv', oznaka: 'Kratki naziv', duzina: 100, pomoc: 'Prikazuje se svuda u programu.' },
        { ime: 'dugi_naziv', oznaka: 'Dugi naziv', duzina: 255, sirina: 2 },
        { ime: 'vlasnik', oznaka: 'Vlasnik', duzina: 100 },
        { ime: 'zemlja', oznaka: 'Zemlja', duzina: 100 },
        { sekcija: 'Adresa' },
        { ime: 'opstina', oznaka: 'Opština', vrsta: 'select', opcije: () => opcijeOpstina(), podrazumevano: 'Mladenovac' },
        { ime: 'ptt_broj', oznaka: 'PTT broj', duzina: 10, lista: 'ptt-lista', podrazumevano: '11400', pomoc: 'Kucaj broj ili mesto.' },
        { ime: 'adresa', oznaka: 'Adresa', duzina: 255 },
        { ime: 'mesto', oznaka: 'Mesto', duzina: 100 },
        { sekcija: 'Registracija' },
        { ime: 'maticni_broj', oznaka: 'Matični broj', duzina: 13, inputmode: 'numeric' },
        { ime: 'broj_gazdinstva', oznaka: 'Broj gazdinstva', duzina: 30 },
        { ime: 'registarski_broj', oznaka: 'Registarski broj', duzina: 50 },
        { ime: 'sifra_delatnosti', oznaka: 'Šifra delatnosti', duzina: 10, inputmode: 'numeric' },
        { sekcija: 'PDV' },
        { ime: 'pdv_zona', oznaka: 'PDV zona', vrsta: 'select', opcije: () => PDV_ZONE, podrazumevano: '0' },
        { ime: 'pdv_obveznik', oznaka: 'PDV obveznik', vrsta: 'select', opcije: () => [['1', 'Da'], ['0', 'Ne']], podrazumevano: '1' },
        { ime: 'e_faktura', oznaka: 'Sistem eFaktura', vrsta: 'check', onemoguceno: true, pomoc: 'Za sada se ne menja.' },
        { sekcija: 'Kontakt i status' },
        { ime: 'telefon', oznaka: 'Telefon', duzina: 50, tip: 'tel' },
        { ime: 'fax', oznaka: 'Fax', duzina: 50, tip: 'tel' },
        { ime: 'email', oznaka: 'E-mail', duzina: 255, tip: 'email' },
        { ime: 'web', oznaka: 'Web', duzina: 255 },
        { ime: 'el_dostava', oznaka: 'El. dostava', vrsta: 'check' },
        { ime: 'aktivan', oznaka: 'Status: aktivan', vrsta: 'check', podrazumevano: true },
    ];

    const PODSTAVKE = {
        kontakti: {
            naslov: 'kontakt', polja: [
                { ime: 'naziv', oznaka: 'Naziv (osoba ili centrala)', obavezno: true, duzina: 100, sirina: 2 },
                { ime: 'sluzba', oznaka: 'Služba', duzina: 100 },
                { ime: 'funkcija', oznaka: 'Funkcija', duzina: 100 },
                { ime: 'telefon', oznaka: 'Telefon', duzina: 50, tip: 'tel' },
                { ime: 'mobilni', oznaka: 'Mobilni', duzina: 50, tip: 'tel' },
                { ime: 'fax', oznaka: 'Fax', duzina: 50, tip: 'tel' },
                { ime: 'email', oznaka: 'E-mail', duzina: 255, tip: 'email' },
                { ime: 'web', oznaka: 'Web', duzina: 255, sirina: 2 },
            ]
        },
        racuni: {
            naslov: 'tekući račun', polja: [
                { ime: 'valuta', oznaka: 'Valuta', vrsta: 'select', opcije: () => VALUTE, podrazumevano: 'RSD' },
                { ime: 'banka_naziv', oznaka: 'Banka (naziv)', duzina: 150, samoDevizni: true },
                { ime: 'broj_racuna', oznaka: 'Broj računa', obavezno: true, duzina: 40, sirina: 2,
                  pomoc: 'Ceo broj od početka do kraja, npr. 160-12345-95. Nule u sredini se dopišu same, '
                       + 'a kontrolni broj (poslednje 2 cifre) se izračuna ako ga ne upišeš. Devizni: IBAN.' },
                { ime: 'dug_konto', oznaka: 'Dug konto', duzina: 10, inputmode: 'numeric', podrazumevano: '43500' },
                { ime: 'pot_konto', oznaka: 'Pot konto', duzina: 10, inputmode: 'numeric', podrazumevano: '20410' },
            ]
        },
        jedinice: {
            naslov: 'radna jedinica', polja: [
                { ime: 'naziv', oznaka: 'Naziv', obavezno: true, duzina: 150, sirina: 2 },
                { ime: 'adresa', oznaka: 'Adresa', duzina: 255, sirina: 2 },
                { ime: 'mesto', oznaka: 'Mesto', duzina: 100 },
                { ime: 'ptt_broj', oznaka: 'PTT broj', duzina: 10, lista: 'ptt-lista' },
                { ime: 'gln', oznaka: 'GLN', duzina: 13, inputmode: 'numeric', pomoc: '13 cifara (globalni broj lokacije).' },
                { ime: 'email', oznaka: 'E-mail', duzina: 255, tip: 'email' },
                { ime: 'dostava', oznaka: 'Dostava', vrsta: 'check' },
                { ime: 'aktivan', oznaka: 'Status: aktivan', vrsta: 'check', podrazumevano: true },
            ]
        },
    };


    // ---------- Šifarnici ----------

    let sifarnici = null;

    async function ucitajSifarnike() {
        if (sifarnici) return sifarnici;
        const odgovor = await fetch('/sifarnici');
        if (!odgovor.ok) throw new Error('Šifarnici (opštine, PTT, banke) ne mogu da se učitaju.');
        sifarnici = await odgovor.json();
        // Jedna zajednička lista PTT brojeva za sva polja PTT broj
        const lista = document.createElement('datalist');
        lista.id = 'ptt-lista';
        sifarnici.ptt.forEach((p) => {
            const o = document.createElement('option');
            o.value = p.broj;
            o.label = p.mesto;
            lista.append(o);
        });
        document.body.append(lista);
        return sifarnici;
    }

    function opcijeOpstina() {
        const grupe = new Map();
        sifarnici.opstine.forEach((o) => {
            if (!grupe.has(o.okrug)) grupe.set(o.okrug, []);
            grupe.get(o.okrug).push([o.naziv, o.sifra ? `${o.naziv} ${o.sifra}` : o.naziv]);
        });
        return { prazno: '— bez opštine (inostranstvo) —', grupe };
    }

    function pttOpstine(naziv) {
        return sifarnici?.opstine.find((o) => o.naziv === naziv)?.ptt || null;
    }

    function nazivBanke(sifra) {
        return sifarnici?.banke.find((b) => b.sifra === sifra)?.naziv || null;
    }

    function mestoZaPtt(broj) {
        const p = sifarnici?.ptt.find((x) => x.broj === broj);
        return p ? p.mesto : null;
    }


    // ---------- Provere (iste kao na serveru) ----------

    function pibIspravan(pib) {
        let s = 10;
        for (const c of pib.slice(0, 8)) {
            const t = (s + Number(c)) % 10 || 10;
            s = (2 * t) % 11;
        }
        return (11 - s) % 10 === Number(pib[8]);
    }

    function kontrolniBroj(banka, racun) {
        // 98 - (banka + račun na 13 cifara + "00") mod 97; BigInt jer je broj prevelik za Number
        const n = BigInt(banka + racun.padStart(13, '0')) * 100n;
        return String(98n - n % 97n).padStart(2, '0');
    }

    // Domaći račun upisan od početka do kraja -> { banka, sredina (13 cifara), kb, tacan, upisanKb } ili { greska }.
    // Ista pravila kao rastavi_racun na serveru: 160-12345-95, 160-12345, 18 cifara bez crtica,
    // ili cifre bez crtica gde su poslednje dve Kb samo ako je to tačan Kb.
    function rastaviRacun(tekst) {
        const t = tekst.replace(/\s/g, '');
        let banka, sredina, kb = '';
        if (t.includes('-')) {
            const d = t.split('-');
            if (d.length > 3) return { greska: 'Upiši kao 160-12345-95 (banka - račun - kontrolni broj).' };
            [banka, sredina, kb = ''] = d;
        } else if (!/^\d+$/.test(t)) {
            return { greska: 'Samo cifre i crtice, npr. 160-12345-95.' };
        } else if (t.length === 18) {
            [banka, sredina, kb] = [t.slice(0, 3), t.slice(3, 16), t.slice(16)];
        } else if (t.length >= 4) {
            banka = t.slice(0, 3);
            const ostatak = t.slice(3), deo = ostatak.slice(0, -2);
            if (deo.length >= 1 && deo.length <= 13 && kontrolniBroj(banka, deo) === ostatak.slice(-2)) {
                [sredina, kb] = [deo, ostatak.slice(-2)];
            } else {
                sredina = ostatak;
            }
        } else {
            return { greska: 'Prekratko. Upiši ceo broj, npr. 160-12345-95.' };
        }
        if (!/^\d{3}$/.test(banka)) return { greska: 'Prve 3 cifre su šifra banke (npr. 160).' };
        if (!/^\d{1,13}$/.test(sredina)) return { greska: 'Srednji deo računa ima od 1 do 13 cifara.' };
        if (kb && !/^\d{2}$/.test(kb)) return { greska: 'Kontrolni broj (kraj računa) ima 2 cifre.' };
        const tacan = kontrolniBroj(banka, sredina);
        return { banka, sredina: sredina.padStart(13, '0'), kb: kb || tacan, tacan, upisanKb: kb };
    }


    // ---------- Pravljenje forme ----------

    function napraviPolje(p, vrednost) {
        const omot = document.createElement('label');
        omot.className = `df-polje${p.sirina === 2 ? ' siroko' : ''}${p.vrsta === 'check' ? ' df-check' : ''}`;
        omot.dataset.ime = p.ime;
        const oznaka = document.createElement('span');
        oznaka.className = 'df-oznaka';
        oznaka.textContent = p.oznaka;
        if (p.obavezno) {
            const z = document.createElement('span');
            z.className = 'obavezno';
            z.textContent = ' *';
            oznaka.append(z);
        }

        let el;
        if (p.vrsta === 'select') {
            el = document.createElement('select');
            const opcije = p.opcije();
            if (Array.isArray(opcije)) {
                opcije.forEach(([v, t]) => el.add(new Option(t, v)));
            } else {
                el.add(new Option(opcije.prazno, ''));
                opcije.grupe.forEach((lista, okrug) => {
                    const g = document.createElement('optgroup');
                    g.label = okrug || 'Ostalo';
                    lista.forEach(([v, t]) => g.append(new Option(t, v)));
                    el.append(g);
                });
            }
            const v = vrednost ?? p.podrazumevano ?? '';
            el.value = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
            // vrednost kojoj nema mesta u listi (npr. stara opština): dodaj je da se ne izgubi
            if (v !== '' && v !== null && el.value !== String(v)) {
                el.add(new Option(String(v), String(v)), 1);
                el.value = String(v);
            }
        } else if (p.vrsta === 'check') {
            el = document.createElement('input');
            el.type = 'checkbox';
            el.checked = Boolean(vrednost ?? p.podrazumevano ?? false);
        } else {
            el = document.createElement('input');
            el.type = p.tip || 'text';
            el.maxLength = p.duzina || 255;
            el.autocomplete = 'off';
            if (p.inputmode) el.inputMode = p.inputmode;
            if (p.lista) el.setAttribute('list', p.lista);
            el.value = vrednost ?? p.podrazumevano ?? '';
        }
        el.name = p.ime;
        if (p.onemoguceno) el.disabled = true;
        if (p.obavezno) el.required = true;

        const greska = document.createElement('small');
        greska.className = 'df-greska';
        if (p.vrsta === 'check') omot.append(el, oznaka); else omot.append(oznaka, el);
        if (p.pomoc) {
            const pomoc = document.createElement('small');
            pomoc.className = 'df-pomoc';
            pomoc.textContent = p.pomoc;
            omot.append(pomoc);
        }
        omot.append(greska);
        return omot;
    }

    function napraviDijalog(naslov, polja, vrednosti) {
        const dijalog = document.createElement('dialog');
        dijalog.className = 'df-dijalog';
        const forma = document.createElement('form');
        forma.noValidate = true;
        const zaglavlje = document.createElement('header');
        const h = document.createElement('h2');
        h.textContent = naslov;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'df-x';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Zatvori');
        zaglavlje.append(h, x);

        const telo = document.createElement('div');
        telo.className = 'df-telo';
        let grupa = null;
        for (const p of polja) {
            if (p.sekcija) {
                grupa = document.createElement('fieldset');
                const legenda = document.createElement('legend');
                legenda.textContent = p.sekcija;
                grupa.append(legenda);
                telo.append(grupa);
                continue;
            }
            if (!grupa) {
                grupa = document.createElement('fieldset');
                grupa.className = 'bez-naslova';
                telo.append(grupa);
            }
            grupa.append(napraviPolje(p, vrednosti?.[p.ime]));
        }

        const podnozje = document.createElement('footer');
        const poruka = document.createElement('p');
        poruka.className = 'df-poruka';
        poruka.setAttribute('role', 'alert');
        const odustani = document.createElement('button');
        odustani.type = 'button';
        odustani.className = 'sekundarno';
        odustani.textContent = 'Odustani';
        const sacuvaj = document.createElement('button');
        sacuvaj.type = 'submit';
        sacuvaj.textContent = 'Sačuvaj';
        podnozje.append(poruka, odustani, sacuvaj);

        forma.append(zaglavlje, telo, podnozje);
        dijalog.append(forma);
        document.body.append(dijalog);
        return { dijalog, forma, poruka, sacuvaj, zatvori: [x, odustani] };
    }

    function greskaPolja(forma, ime, tekst) {
        const omot = forma.querySelector(`.df-polje[data-ime="${ime}"]`);
        if (!omot) return;
        omot.querySelector('.df-greska').textContent = tekst;
        omot.querySelector('[name]').setAttribute('aria-invalid', tekst ? 'true' : 'false');
    }

    function procitajFormu(forma, polja) {
        const podaci = {};
        for (const p of polja) {
            if (!p.ime || p.onemoguceno) continue;
            const el = forma.elements[p.ime];
            if (p.vrsta === 'check') podaci[p.ime] = el.checked;
            else if (p.ime === 'pdv_obveznik') podaci[p.ime] = el.value === '1';
            else if (p.ime === 'pdv_zona') podaci[p.ime] = Number(el.value);
            else podaci[p.ime] = el.value.trim();
        }
        return podaci;
    }

    // Otvara dijalog i vraća Promise; `posalji(podaci)` šalje na server i vraća rezultat ili baca grešku
    function prikazi({ naslov, polja, vrednosti, proveri, posalji, posle }) {
        const { dijalog, forma, poruka, sacuvaj, zatvori } = napraviDijalog(naslov, polja, vrednosti);
        posle?.(forma);
        return new Promise((resolve) => {
            let izmenjeno = false;
            const kraj = (rezultat) => { dijalog.close(); dijalog.remove(); resolve(rezultat); };
            const pokusajZatvaranja = () => {
                if (izmenjeno && !window.confirm('Odbaciti unete izmene?')) return;
                kraj(null);
            };
            zatvori.forEach((b) => b.addEventListener('click', pokusajZatvaranja));
            dijalog.addEventListener('cancel', (e) => { e.preventDefault(); pokusajZatvaranja(); });
            forma.addEventListener('input', (e) => {
                izmenjeno = true;
                if (e.target.name) greskaPolja(forma, e.target.name, '');
                poruka.textContent = '';
            });
            forma.addEventListener('submit', async (e) => {
                e.preventDefault();
                forma.querySelectorAll('.df-greska').forEach((g) => { g.textContent = ''; });
                const podaci = procitajFormu(forma, polja);
                const greske = [];
                for (const p of polja) {
                    if (p.obavezno && !podaci[p.ime]) greske.push([p.ime, `${p.oznaka} je obavezno.`]);
                }
                greske.push(...(proveri?.(podaci, forma) || []));
                if (greske.length) {
                    greske.forEach(([ime, t]) => greskaPolja(forma, ime, t));
                    poruka.textContent = 'Ispravi označena polja.';
                    forma.querySelector(`[name="${greske[0][0]}"]`)?.focus();
                    return;
                }
                sacuvaj.disabled = true;
                sacuvaj.textContent = 'Čuvanje…';
                try {
                    kraj(await posalji(podaci));
                } catch (greska) {
                    poruka.textContent = greska.message === 'Failed to fetch' ? 'Nema veze sa serverom. Ništa nije sačuvano.' : greska.message;
                } finally {
                    sacuvaj.disabled = false;
                    sacuvaj.textContent = 'Sačuvaj';
                }
            });
            dijalog.showModal();
            forma.querySelector('input:not([disabled]), select')?.focus();
        });
    }

    async function posaljiJson(url, metod, podaci, podrazumevanaGreska) {
        const odgovor = await fetch(url, {
            method: metod,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(podaci)
        });
        if (odgovor.status === 401) { window.location.href = '/login.html?greska=korisnik'; throw new Error('Nisi prijavljen.'); }
        if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu radnju. Prijavi se ponovo kao vlasnik.');
        const rezultat = await odgovor.json().catch(() => null);
        if (!odgovor.ok) throw new Error(typeof rezultat === 'string' ? rezultat : podrazumevanaGreska);
        return rezultat;
    }


    // ---------- Dobavljač ----------

    async function otvoriFormu(dobavljac = null) {
        await ucitajSifarnike();
        return prikazi({
            naslov: dobavljac ? `Izmena: ${dobavljac.naziv}` : 'Novi dobavljač',
            polja: POLJA_DOBAVLJACA,
            vrednosti: dobavljac,
            posle(forma) {
                // PTT broj -> mesto (samo ako je mesto prazno ili ga je program sam upisao)
                const ptt = forma.elements.ptt_broj, mesto = forma.elements.mesto;
                if (!dobavljac && !mesto.value) { mesto.value = mestoZaPtt(ptt.value) || ''; mesto.dataset.auto = '1'; }
                ptt.addEventListener('input', () => {
                    const m = mestoZaPtt(ptt.value.trim());
                    if (m && (!mesto.value || mesto.dataset.auto === '1')) { mesto.value = m; mesto.dataset.auto = '1'; }
                });
                mesto.addEventListener('input', () => { delete mesto.dataset.auto; });
                // Opština -> PTT broj sedišta opštine i mesto. Mesto koje je korisnik sam upisao
                // ostaje, osim ako je to bilo mesto prethodne opštine.
                const opstina = forma.elements.opstina;
                let prethodnoMesto = mestoZaPtt(pttOpstine(opstina.value));
                opstina.addEventListener('change', () => {
                    const broj = pttOpstine(opstina.value);
                    ptt.value = broj || '';
                    const m = broj ? mestoZaPtt(broj) : '';
                    if (!mesto.value || mesto.dataset.auto === '1' || mesto.value === prethodnoMesto) {
                        mesto.value = m || '';
                        mesto.dataset.auto = '1';
                    }
                    prethodnoMesto = m;
                    ptt.dispatchEvent(new Event('input', { bubbles: true }));
                });
            },
            proveri(p) {
                const greske = [];
                const pib = p.pib.replace(/\s/g, '');
                if (pib && p.pdv_zona !== 3) {
                    if (!/^\d{9}$|^\d{13}$/.test(pib)) greske.push(['pib', 'PIB mora imati 9 cifara (ili 13 za fizičko lice).']);
                    else if (pib.length === 9 && !pibIspravan(pib)) greske.push(['pib', 'PIB nije ispravan (kontrolna cifra). Proveri unos.']);
                }
                if (p.maticni_broj && !/^\d{8,13}$/.test(p.maticni_broj)) greske.push(['maticni_broj', 'Matični broj: 8 do 13 cifara.']);
                if (p.sifra_delatnosti && !/^\d{4,5}$/.test(p.sifra_delatnosti)) greske.push(['sifra_delatnosti', 'Šifra delatnosti: 4 ili 5 cifara.']);
                if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) greske.push(['email', 'E-mail nije ispravan.']);
                return greske;
            },
            posalji: (podaci) => dobavljac
                ? posaljiJson(`/dobavljaci/${dobavljac.dobavljac_id}`, 'PUT', podaci, 'Izmene nisu sačuvane.')
                : posaljiJson('/dobavljaci', 'POST', podaci, 'Dobavljač nije sačuvan.')
        });
    }


    // ---------- Kontakt / tekući račun / radna jedinica ----------

    async function otvoriPodstavku(vrsta, dobavljacId, stavka = null) {
        await ucitajSifarnike();
        const opis = PODSTAVKE[vrsta];
        return prikazi({
            naslov: `${stavka ? 'Izmena' : 'Nov'}${opis.naslov === 'radna jedinica' && !stavka ? 'a' : ''} ${opis.naslov}`,
            polja: opis.polja,
            // domaći račun se u formi prikazuje ceo: 160-0000000012345-95
            vrednosti: stavka && vrsta === 'racuni' && stavka.valuta === 'RSD'
                ? { ...stavka, broj_racuna: `${stavka.banka_sifra}-${stavka.broj_racuna}-${stavka.kontrolni_broj}` }
                : stavka,
            posle(forma) {
                if (vrsta !== 'racuni') return;
                // Domaći (RSD) račun: banka iz šifarnika + kontrolni broj; devizni: naziv banke i IBAN
                const e = forma.elements;
                const prikaziPolja = () => {
                    const domaci = e.valuta.value === 'RSD';
                    forma.querySelectorAll('.df-polje').forEach((omot) => {
                        const p = opis.polja.find((x) => x.ime === omot.dataset.ime);
                        omot.hidden = (p.samoDomaci && !domaci) || (p.samoDevizni && domaci);
                    });
                };
                const pregled = document.createElement('p');
                pregled.className = 'df-pregled';
                forma.querySelector('.df-telo').append(pregled);
                // Ispod polja: koji račun će biti zaveden (sa nulama i kontrolnim brojem) i banka
                const osveziPregled = () => {
                    const tekst = e.broj_racuna.value.trim();
                    if (e.valuta.value !== 'RSD' || !tekst) { pregled.textContent = ''; return; }
                    const r = rastaviRacun(tekst);
                    if (r.greska) {
                        pregled.textContent = tekst.replace(/\D/g, '').length >= 4 ? `⚠ ${r.greska}` : '';
                        pregled.classList.add('upozorenje');
                        return;
                    }
                    const banka = nazivBanke(r.banka);
                    const los = r.upisanKb && r.upisanKb !== r.tacan;
                    pregled.textContent = `Zavodi se: ${r.banka}-${r.sredina}-${r.kb}`
                        + (los ? `  ⚠ kontrolni broj treba da bude ${r.tacan}` : '  ✓')
                        + (r.upisanKb ? '' : '  (Kb izračunat)')
                        + `\n${banka || `⚠ Nepoznata šifra banke ${r.banka}`}`;
                    pregled.classList.toggle('upozorenje', Boolean(los || !banka));
                };
                // kad se izađe iz polja, upiši ceo broj sa nulama i kontrolnim brojem
                e.broj_racuna.addEventListener('change', () => {
                    if (e.valuta.value !== 'RSD') return;
                    const r = rastaviRacun(e.broj_racuna.value);
                    if (!r.greska && !(r.upisanKb && r.upisanKb !== r.tacan)) {
                        e.broj_racuna.value = `${r.banka}-${r.sredina}-${r.kb}`;
                    }
                    osveziPregled();
                });
                forma.addEventListener('input', () => { prikaziPolja(); osveziPregled(); });
                prikaziPolja();
                osveziPregled();
            },
            proveri(p) {
                const greske = [];
                if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) greske.push(['email', 'E-mail nije ispravan.']);
                if (vrsta === 'jedinice' && p.gln && !/^\d{13}$/.test(p.gln)) greske.push(['gln', 'GLN ima tačno 13 cifara.']);
                if (vrsta === 'racuni' && p.valuta === 'RSD') {
                    const r = p.broj_racuna ? rastaviRacun(p.broj_racuna) : null;
                    if (r?.greska) greske.push(['broj_racuna', r.greska]);
                    else if (r && r.upisanKb && r.upisanKb !== r.tacan) {
                        greske.push(['broj_racuna', `Kontrolni broj ne odgovara (treba ${r.tacan}). Proveri broj računa.`]);
                    } else if (r) {
                        p.broj_racuna = `${r.banka}-${r.sredina}-${r.kb}`;
                        p.banka_naziv = '';
                    }
                }
                return greske;
            },
            posalji: (podaci) => stavka
                ? posaljiJson(`/dobavljaci/${dobavljacId}/${vrsta}/${stavka.id}`, 'PUT', podaci, 'Izmene nisu sačuvane.')
                : posaljiJson(`/dobavljaci/${dobavljacId}/${vrsta}`, 'POST', podaci, 'Nije sačuvano.')
        });
    }

    async function obrisiPodstavku(vrsta, dobavljacId, stavkaId) {
        const odgovor = await fetch(`/dobavljaci/${dobavljacId}/${vrsta}/${stavkaId}`, { method: 'DELETE' });
        const rezultat = await odgovor.json().catch(() => null);
        if (!odgovor.ok) throw new Error(typeof rezultat === 'string' ? rezultat : 'Brisanje nije uspelo.');
        return rezultat;
    }

    window.Dobavljaci = {
        TIPOVI: Object.fromEntries(TIPOVI),
        PDV_ZONE: Object.fromEntries(PDV_ZONE),
        ucitajSifarnike, otvoriFormu, otvoriPodstavku, obrisiPodstavku, mestoZaPtt
    };
})();
