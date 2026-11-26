// ---------- AI asistent (početna vlasnika) ----------
//
// Ugovor sa serverom:
//   POST /asistent/poruka   multipart: tekst, fajlovi[] (slike/PDF)
//                           -> { odgovor (markdown), fajlovi: [{ naziv, url }], nacrti: [{ url, stavki }] }
//   POST /asistent/novi     -> briše istoriju razgovora na serveru
// Odgovor se prikazuje kao DOM (textContent), nikad kao innerHTML: model ne može da ubaci HTML/skriptu.

(() => {
    const porukeEl = document.getElementById('asistent-poruke');
    const forma = document.getElementById('asistent-forma');
    const tekstEl = document.getElementById('asistent-tekst');
    const dugmePosalji = document.getElementById('asistent-posalji');
    const listaPriloga = document.getElementById('asistent-prilozi');
    const greskaEl = document.getElementById('asistent-greska');
    const predlozi = document.getElementById('asistent-predlozi');
    const sablon = document.getElementById('poruka-sablon');

    const MAX_PRILOGA = 5;
    const MAX_MB = 15;
    const KLJUC_ISTORIJE = 'asistent-istorija';

    let prilozi = [];          // [{ fajl, url (za pregled) }]
    let saljeSe = false;


    // ---------- Markdown -> DOM (bezbedno) ----------

    // **jako**, *kurziv* / _kurziv_, `kod`
    function dodajInline(roditelj, tekst) {
        const sablonInline = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
        let poslednji = 0;
        for (const m of tekst.matchAll(sablonInline)) {
            if (m.index > poslednji) roditelj.append(tekst.slice(poslednji, m.index));
            const deo = m[0];
            let el;
            if (deo.startsWith('**')) { el = document.createElement('strong'); el.textContent = deo.slice(2, -2); }
            else if (deo.startsWith('`')) { el = document.createElement('code'); el.textContent = deo.slice(1, -1); }
            else { el = document.createElement('em'); el.textContent = deo.slice(1, -1); }
            roditelj.append(el);
            poslednji = m.index + deo.length;
        }
        if (poslednji < tekst.length) roditelj.append(tekst.slice(poslednji));
    }

    const jeRedTabele = (red) => /^\s*\|.*\|\s*$/.test(red);
    const jeRazdvajac = (red) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(red);
    const celije = (red) => red.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const jeBroj = (t) => /^-?[\d.,\s]+(%|\s?RSD|\s?din\.?)?$/.test(t) && /\d/.test(t);

    function markdown(tekst) {
        const okvir = document.createDocumentFragment();
        const redovi = String(tekst).replace(/\r\n/g, '\n').split('\n');
        let i = 0;
        while (i < redovi.length) {
            const red = redovi[i];
            if (!red.trim()) { i++; continue; }

            if (red.trim().startsWith('```')) {
                const kod = [];
                i++;
                while (i < redovi.length && !redovi[i].trim().startsWith('```')) kod.push(redovi[i++]);
                i++;
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = kod.join('\n');
                pre.append(code);
                okvir.append(pre);
                continue;
            }

            const naslov = red.match(/^(#{1,6})\s+(.*)$/);
            if (naslov) {
                const h = document.createElement(naslov[1].length <= 2 ? 'h3' : 'h4');
                dodajInline(h, naslov[2]);
                okvir.append(h);
                i++;
                continue;
            }

            if (jeRedTabele(red) && i + 1 < redovi.length && jeRazdvajac(redovi[i + 1])) {
                const tabela = document.createElement('table');
                const thead = tabela.createTHead();
                const zaglavlje = celije(red);
                const trH = thead.insertRow();
                i += 2;
                const telo = tabela.createTBody();
                const podaci = [];
                while (i < redovi.length && jeRedTabele(redovi[i])) podaci.push(celije(redovi[i++]));
                const brojcane = zaglavlje.map((_, k) => podaci.length > 0 && podaci.every((r) => !r[k] || jeBroj(r[k])));
                zaglavlje.forEach((c, k) => {
                    const th = document.createElement('th');
                    th.scope = 'col';
                    if (brojcane[k]) th.className = 'broj';
                    dodajInline(th, c);
                    trH.append(th);
                });
                podaci.forEach((r) => {
                    const tr = telo.insertRow();
                    zaglavlje.forEach((_, k) => {
                        const td = tr.insertCell();
                        if (brojcane[k]) td.className = 'broj';
                        dodajInline(td, r[k] ?? '');
                    });
                });
                const omot = document.createElement('div');
                omot.className = 'tabela-okvir-chat';
                omot.append(tabela);
                okvir.append(omot);
                continue;
            }

            const lista = red.match(/^\s*([-*+]|\d+[.)])\s+/);
            if (lista) {
                const ul = document.createElement(/\d/.test(lista[1]) ? 'ol' : 'ul');
                while (i < redovi.length && /^\s*([-*+]|\d+[.)])\s+/.test(redovi[i])) {
                    const li = document.createElement('li');
                    dodajInline(li, redovi[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
                    ul.append(li);
                    i++;
                }
                okvir.append(ul);
                continue;
            }

            const pasus = [];
            while (i < redovi.length && redovi[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s)/.test(redovi[i])
                   && !(jeRedTabele(redovi[i]) && jeRazdvajac(redovi[i + 1] || ''))) {
                pasus.push(redovi[i++].trim());
            }
            const p = document.createElement('p');
            pasus.forEach((deo, k) => {
                if (k) p.append(document.createElement('br'));
                dodajInline(p, deo);
            });
            okvir.append(p);
        }
        return okvir;
    }


    // ---------- Prikaz poruka ----------

    function napraviPoruku(vrsta) {
        predlozi.hidden = true;
        const el = sablon.content.firstElementChild.cloneNode(true);
        el.classList.add(vrsta);
        porukeEl.append(el);
        return el;
    }

    function skrolujDole() {
        porukeEl.scrollTop = porukeEl.scrollHeight;
    }

    function prikaziKorisnika(tekst, opisPriloga, slike = []) {
        const el = napraviPoruku('korisnik');
        if (opisPriloga.length) {
            const red = document.createElement('div');
            red.className = 'poruka-slike';
            opisPriloga.forEach((p, k) => {
                if (slike[k]) {
                    const img = document.createElement('img');
                    img.src = slike[k];
                    img.alt = p;
                    red.append(img);
                } else {
                    const s = document.createElement('span');
                    s.className = 'pdf-oznaka';
                    s.textContent = p;
                    red.append(s);
                }
            });
            el.prepend(red);
        }
        el.querySelector('.poruka-telo').textContent = tekst || 'Pročitaj priloženi dokument i pripremi ulaz.';
        skrolujDole();
    }

    // Samo naše adrese (fajl izveštaja, nacrt ulaza); sve ostalo se ignoriše
    const DOZVOLJEN_FAJL = /^\/asistent\/fajl\/[a-z0-9_]+\.xlsx$/;
    const DOZVOLJEN_NACRT = /^\/vlasnik\/ulaz\.html\?nacrt=[A-Za-z0-9_-]+$/;

    // 1 stavka, 2-4 stavke, 5-20 stavki, 21 stavka, 22 stavke...
    function stavkiRec(n) {
        const d = n % 10, s = n % 100;
        if (d === 1 && s !== 11) return 'stavka';
        if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return 'stavke';
        return 'stavki';
    }

    function prikaziOdgovor({ odgovor, fajlovi = [], nacrti = [] }) {
        const el = napraviPoruku('asistent-odgovor');
        el.querySelector('.poruka-telo').append(markdown(odgovor));
        const akcije = document.createElement('div');
        akcije.className = 'poruka-akcije';
        fajlovi.filter((f) => DOZVOLJEN_FAJL.test(f.url)).forEach((f) => {
            const a = document.createElement('a');
            a.href = f.url;
            a.className = 'akcija-excel';
            a.download = f.naziv;
            a.textContent = `⬇ Preuzmi Excel (${f.naziv.replace(/_\d{8}_\d{6}_[a-f0-9]+\.xlsx$/, '').replaceAll('_', ' ')})`;
            akcije.append(a);
        });
        nacrti.filter((n) => DOZVOLJEN_NACRT.test(n.url)).forEach((n) => {
            const a = document.createElement('a');
            a.href = n.url;
            a.className = 'akcija-nacrt';
            a.textContent = `Otvori popunjen ulaz (${n.stavki} ${stavkiRec(n.stavki)}) →`;
            akcije.append(a);
        });
        if (akcije.children.length) el.append(akcije);
        skrolujDole();
    }

    function prikaziGresku(tekst) {
        const el = napraviPoruku('asistent-odgovor');
        el.classList.add('greska-poruka');
        el.querySelector('.poruka-telo').textContent = tekst;
        skrolujDole();
    }


    // ---------- Istorija prikaza (samo u ovoj kartici pregledača) ----------

    function ucitajIstoriju() {
        try { return JSON.parse(sessionStorage.getItem(KLJUC_ISTORIJE)) || []; } catch { return []; }
    }

    function zapamti(stavka) {
        try {
            const istorija = ucitajIstoriju();
            istorija.push(stavka);
            sessionStorage.setItem(KLJUC_ISTORIJE, JSON.stringify(istorija.slice(-80)));
        } catch { /* privatni režim / pun storage: istorija prikaza se ne pamti */ }
    }

    function obrisiIstoriju() {
        try { sessionStorage.removeItem(KLJUC_ISTORIJE); } catch { /* ništa */ }
    }

    ucitajIstoriju().forEach((s) => {
        if (s.vrsta === 'korisnik') prikaziKorisnika(s.tekst, s.prilozi || []);
        else if (s.vrsta === 'odgovor') prikaziOdgovor(s.podaci);
    });


    // ---------- Prilozi ----------

    function osveziPriloge() {
        listaPriloga.replaceChildren(...prilozi.map((p, k) => {
            const li = document.createElement('li');
            if (p.url) {
                const img = document.createElement('img');
                img.src = p.url;
                img.alt = '';
                li.append(img);
            }
            const ime = document.createElement('span');
            ime.className = 'ime';
            ime.textContent = p.fajl.name;
            const x = document.createElement('button');
            x.type = 'button';
            x.textContent = '×';
            x.setAttribute('aria-label', `Ukloni ${p.fajl.name}`);
            x.addEventListener('click', () => {
                if (p.url) URL.revokeObjectURL(p.url);
                prilozi.splice(k, 1);
                osveziPriloge();
            });
            li.append(ime, x);
            return li;
        }));
    }

    function dodajFajlove(lista) {
        greskaEl.textContent = '';
        for (const fajl of lista) {
            if (prilozi.length >= MAX_PRILOGA) { greskaEl.textContent = `Najviše ${MAX_PRILOGA} priloga.`; break; }
            const jePdf = fajl.type === 'application/pdf' || /\.pdf$/i.test(fajl.name);
            if (!fajl.type.startsWith('image/') && !jePdf) { greskaEl.textContent = `„${fajl.name}“ nije slika ni PDF.`; continue; }
            if (fajl.size > MAX_MB * 1024 * 1024) { greskaEl.textContent = `„${fajl.name}“ je veći od ${MAX_MB} MB.`; continue; }
            prilozi.push({ fajl, url: jePdf ? null : URL.createObjectURL(fajl) });
        }
        osveziPriloge();
        tekstEl.focus();
    }

    for (const id of ['asistent-kamera', 'asistent-fajl']) {
        document.getElementById(id).addEventListener('change', (event) => {
            dodajFajlove([...event.target.files]);
            event.target.value = '';
        });
    }

    // Prevlačenje fajla na razgovor
    porukeEl.addEventListener('dragover', (event) => event.preventDefault());
    porukeEl.addEventListener('drop', (event) => {
        event.preventDefault();
        dodajFajlove([...event.dataTransfer.files]);
    });
    // Lepljenje slike (Ctrl+V)
    tekstEl.addEventListener('paste', (event) => {
        const slike = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
        if (slike.length) { event.preventDefault(); dodajFajlove(slike); }
    });


    // ---------- Slanje ----------

    function prilagodiVisinu() {
        tekstEl.style.height = 'auto';
        tekstEl.style.height = `${Math.min(tekstEl.scrollHeight + 2, 180)}px`;
    }
    tekstEl.addEventListener('input', () => { prilagodiVisinu(); greskaEl.textContent = ''; });
    tekstEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            forma.requestSubmit();
        }
    });

    async function procitajGresku(odgovor) {
        if (odgovor.status === 401) { window.location.href = '/login.html?greska=korisnik'; return 'Nisi prijavljen.'; }
        if (odgovor.status === 403) return 'Asistent je dostupan samo vlasniku. Prijavi se ponovo.';
        const podaci = await odgovor.json().catch(() => null);
        if (typeof podaci === 'string') return podaci;
        if (odgovor.status === 413) return 'Prilozi su preveliki.';
        return 'Asistent nije odgovorio. Pokušaj ponovo.';
    }

    forma.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saljeSe) return;
        const tekst = tekstEl.value.trim();
        if (!tekst && prilozi.length === 0) { tekstEl.focus(); return; }
        greskaEl.textContent = '';

        const podaci = new FormData();
        podaci.append('tekst', tekst);
        prilozi.forEach((p) => podaci.append('fajlovi', p.fajl, p.fajl.name));
        const opis = prilozi.map((p) => p.fajl.name);
        const slike = prilozi.map((p) => p.url);

        prikaziKorisnika(tekst, opis, slike);
        zapamti({ vrsta: 'korisnik', tekst, prilozi: opis.map((o) => `📎 ${o}`) });
        tekstEl.value = '';
        prilagodiVisinu();
        prilozi = [];
        osveziPriloge();

        saljeSe = true;
        dugmePosalji.disabled = true;
        const razmislja = napraviPoruku('asistent-odgovor');
        razmislja.classList.add('razmislja');
        const telo = razmislja.querySelector('.poruka-telo');
        const pocetak = Date.now();
        const tajmer = setInterval(() => {
            const s = Math.round((Date.now() - pocetak) / 1000);
            telo.firstChild.textContent = opis.length ? `Čitam dokument i proveravam bazu (${s} s)` : `Proveravam podatke (${s} s)`;
        }, 1000);
        telo.append(opis.length ? 'Čitam dokument i proveravam bazu' : 'Proveravam podatke');
        const tacke = document.createElement('span');
        tacke.className = 'tacke';
        telo.append(tacke);
        skrolujDole();

        try {
            const odgovor = await fetch('/asistent/poruka', { method: 'POST', body: podaci });
            if (!odgovor.ok) throw new Error(await procitajGresku(odgovor));
            const rezultat = await odgovor.json();
            razmislja.remove();
            prikaziOdgovor(rezultat);
            zapamti({ vrsta: 'odgovor', podaci: rezultat });
        } catch (greska) {
            razmislja.remove();
            prikaziGresku(greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message);
        } finally {
            clearInterval(tajmer);
            slike.forEach((u) => u && URL.revokeObjectURL(u));
            saljeSe = false;
            dugmePosalji.disabled = false;
            tekstEl.focus();
        }
    });

    predlozi.addEventListener('click', (event) => {
        const dugme = event.target.closest('.predlog');
        if (!dugme) return;
        tekstEl.value = dugme.textContent;
        forma.requestSubmit();
    });

    document.getElementById('asistent-novi').addEventListener('click', async () => {
        if (saljeSe) return;
        try { await fetch('/asistent/novi', { method: 'POST' }); } catch { /* svakako čistimo prikaz */ }
        obrisiIstoriju();
        porukeEl.querySelectorAll('.poruka').forEach((p) => p.remove());
        predlozi.hidden = false;
        greskaEl.textContent = '';
        tekstEl.focus();
    });
})();
