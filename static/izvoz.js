// ---------- Izvoz tabela: Excel (.xlsx), CSV i tekst (.txt) ----------
//
// Upotreba u HTML-u: <table data-izvoz="Artikli"> (vrednost = naziv fajla i naslov).
//   data-izvoz-opis-iz="#selektor"    tekst tog elementa ide kao opis (npr. izabrani period)
//   data-izvoz-naslov-iz="#selektor"  naslov iz tog elementa (npr. "Račun br. 5" u prozoru)
//   <th data-izvoz-preskoci>          kolona se ne izvozi (dugmad, izbor)
//   <td data-izvoz="...">             vrednost za izvoz umesto prikazanog teksta
// Iznad tabele se sama pojavi traka "Preuzmi tabelu: Excel  CSV  TXT".
// Izvozi se TAČNO ono što se vidi: posle filtera, pretrage i sortiranja (skriveni redovi ne).
// Excel pravi server (POST /izvoz/xlsx), CSV i TXT se prave ovde u pregledaču.

(() => {
    const NEVIDLJIVO = '.samo-citac, button, .strelica, [aria-hidden="true"], template';

    // ---- Čitanje tabele ----

    function tekstCelije(td) {
        if (td.dataset.izvoz !== undefined) return td.dataset.izvoz;
        const polje = td.querySelector('input:not([type="checkbox"]):not([type="radio"]), select, textarea');
        if (polje) return polje.tagName === 'SELECT' ? (polje.selectedOptions[0]?.textContent || '') : polje.value;
        const kopija = td.cloneNode(true);
        kopija.querySelectorAll(NEVIDLJIVO).forEach((e) => e.remove());
        // delovi u posebnim elementima (npr. naziv i ispod njega dugi naziv) se odvajaju crticom
        const delovi = [...kopija.childNodes]
            .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        const cek = td.querySelector('input[type="checkbox"]');
        if (cek && !delovi.length) return cek.checked ? 'Da' : 'Ne';
        return delovi.join(' – ');
    }

    // "1.234,56" -> broj; "46,20 %" -> broj sa oznakom; "27.11.2026. 14:05" -> datum
    function vrednost(tekst) {
        const t = tekst.replace(/−/g, '-').replace(/ /g, ' ').trim();
        if (t === '' || t === '—' || t === '–') return '';
        const datum = t.match(/^(\d{2})\.(\d{2})\.(\d{4})\.?(?:\s+(\d{2}):(\d{2}))?$/);
        if (datum) {
            return { t: 'd', v: `${datum[3]}-${datum[2]}-${datum[1]}`, h: datum[4] ? `${datum[4]}:${datum[5]}` : '' , tekst: t };
        }
        const broj = t.match(/^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(%|RSD)?$/);
        // Cele cifre bez tačke za hiljade, duže od 4 ili sa nulom napred (PIB, bar kod, telefon) ostaju tekst
        if (broj && !broj[3] && !broj[4] && !broj[2].includes('.') && (broj[2].length >= 5 || /^0\d/.test(broj[2]))) return t;
        if (broj) {
            const v = Number(`${broj[1]}${broj[2].replace(/\./g, '')}.${broj[3] || '0'}`);
            return { t: 'n', v, d: broj[3] ? broj[3].length : 0, s: broj[4] === '%' ? ' %' : '', tekst: t };
        }
        return t;
    }

    function redCelija(tr, ukupnoKolona) {
        const red = [];
        for (const celija of tr.cells) {
            red.push(tekstCelije(celija));
            for (let i = 1; i < (celija.colSpan || 1); i++) red.push('');
        }
        while (red.length < ukupnoKolona) red.push('');
        return red;
    }

    function procitajTabelu(tabela) {
        const redoviZaglavlja = [...(tabela.tHead?.rows || [])].filter((r) => !r.classList.contains('filteri'));
        const zaglavlje = redoviZaglavlja[redoviZaglavlja.length - 1];
        if (!zaglavlje) return null;
        const kolone = [];
        for (const th of zaglavlje.cells) {
            const kopija = th.cloneNode(true);
            kopija.querySelectorAll('.samo-citac').forEach((e) => e.remove());
            const naslov = kopija.textContent.replace(/\s+/g, ' ').trim();
            const preskoci = th.hasAttribute('data-izvoz-preskoci') || naslov === '';
            for (let i = 0; i < (th.colSpan || 1); i++) kolone.push({ naslov, preskoci });
        }
        const telo = [...tabela.tBodies].flatMap((tb) => [...tb.rows]).filter((tr) =>
            !tr.classList.contains('prosireno')
            && !(tr.cells.length === 1 && tr.cells[0].colSpan > 1)          // red "nema podataka"
            && !tr.hidden && getComputedStyle(tr).display !== 'none');
        const podnozje = tabela.tFoot ? [...tabela.tFoot.rows] : [];
        const zadrzi = (red) => red.filter((_, i) => kolone[i] && !kolone[i].preskoci);
        const redovi = telo.map((tr) => zadrzi(redCelija(tr, kolone.length)).map(vrednost));
        const zbir = podnozje.map((tr) => zadrzi(redCelija(tr, kolone.length)).map(vrednost));
        // Kolona sa mešavinom teksta i brojeva (npr. bar kod "123" i "21424fs") ostaje sva tekst
        const brojKolona = redovi[0]?.length || 0;
        for (let i = 0; i < brojKolona; i++) {
            if (redovi.some((r) => typeof r[i] === 'string' && r[i] !== '')) {
                for (const r of [...redovi, ...zbir]) if (r[i] && typeof r[i] === 'object') r[i] = r[i].tekst;
            }
        }
        return { kolone: kolone.filter((k) => !k.preskoci).map((k) => k.naslov), redovi, zbir };
    }

    function naslovIOpis(tabela) {
        const iz = (sel) => (sel ? document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() : '');
        const naslov = iz(tabela.dataset.izvozNaslovIz) || tabela.dataset.izvoz || document.title;
        return { naslov, opis: iz(tabela.dataset.izvozOpisIz) };
    }

    // ---- Zapisi ----

    const dv = (n) => String(n).padStart(2, '0');
    function danas() {
        const d = new Date();
        return { fajl: `${d.getFullYear()}-${dv(d.getMonth() + 1)}-${dv(d.getDate())}`,
                 tekst: `${dv(d.getDate())}.${dv(d.getMonth() + 1)}.${d.getFullYear()}. ${dv(d.getHours())}:${dv(d.getMinutes())}` };
    }
    const imeFajla = (naslov, ekst) =>
        `${naslov.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80)}_${danas().fajl}.${ekst}`;

    // CSV za Excel na srpskom: separator ";" i decimalni zarez, brojevi bez tačke za hiljade
    const csvVrednost = (c) => {
        if (c === '' || c == null) return '';
        if (typeof c === 'object' && c.t === 'n') return String(c.v).replace('.', ',') + (c.s ? '%' : '');
        const t = typeof c === 'object' ? c.tekst : String(c);
        return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    function napraviCsv(p) {
        const redovi = [p.kolone, ...p.redovi, ...p.zbir];
        return '﻿' + redovi.map((r) => r.map(csvVrednost).join(';')).join('\r\n') + '\r\n';
    }

    // TXT: poravnate kolone (brojevi desno), naslov i datum izvoza gore
    const tekst = (c) => (c === '' || c == null ? '' : typeof c === 'object' ? c.tekst : String(c));
    function napraviTxt(p) {
        const sve = [p.kolone, ...p.redovi, ...p.zbir];
        const sirine = p.kolone.map((_, i) => Math.min(60, Math.max(...sve.map((r) => tekst(r[i]).length))));
        const brojcana = p.kolone.map((_, i) => p.redovi.some((r) => typeof r[i] === 'object' && r[i].t === 'n'));
        const red = (r) => r.map((c, i) => {
            const t = tekst(c).slice(0, sirine[i]);
            return brojcana[i] ? t.padStart(sirine[i]) : t.padEnd(sirine[i]);
        }).join('  ').trimEnd();
        const linija = sirine.map((s) => '-'.repeat(s)).join('  ');
        const deo = [p.naslov.toUpperCase(), ...(p.opis ? [p.opis] : []), `Izvezeno: ${danas().tekst}`, '',
                     red(p.kolone), linija, ...p.redovi.map(red)];
        if (p.zbir.length) deo.push(linija, ...p.zbir.map(red));
        deo.push('', `Redova: ${p.redovi.length}`);
        return '﻿' + deo.join('\r\n') + '\r\n';
    }

    function preuzmi(sadrzaj, ime, tip) {
        const blob = sadrzaj instanceof Blob ? sadrzaj : new Blob([sadrzaj], { type: tip });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ime;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    async function izvezi(tabela, format, poruka) {
        const p = procitajTabelu(tabela);
        if (!p || !p.redovi.length) {
            poruka.textContent = 'Tabela je prazna: nema šta da se preuzme.';
            return;
        }
        Object.assign(p, naslovIOpis(tabela));
        poruka.textContent = '';
        if (format === 'csv') return preuzmi(napraviCsv(p), imeFajla(p.naslov, 'csv'), 'text/csv;charset=utf-8');
        if (format === 'txt') return preuzmi(napraviTxt(p), imeFajla(p.naslov, 'txt'), 'text/plain;charset=utf-8');
        poruka.textContent = 'Pravim Excel…';
        try {
            const odgovor = await fetch('/izvoz/xlsx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...p, izvezeno: danas().tekst }),
            });
            if (odgovor.status === 401) { window.location.href = '/login.html?greska=korisnik'; return; }
            if (!odgovor.ok) {
                const greska = await odgovor.json().catch(() => null);
                throw new Error(typeof greska === 'string' ? greska : 'Excel nije napravljen.');
            }
            preuzmi(await odgovor.blob(), imeFajla(p.naslov, 'xlsx'));
            poruka.textContent = '';
        } catch (g) {
            poruka.textContent = g.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : g.message;
        }
    }

    // ---- Traka iznad svake tabele ----

    function dodajTraku(tabela) {
        const okvir = tabela.closest('.tabela-okvir, .lista-okvir, .lista-okvir-ulaz, .storno-lista-okvir') || tabela;
        const traka = document.createElement('div');
        traka.className = 'izvoz-traka';
        traka.innerHTML = `
          <span class="izvoz-oznaka">Preuzmi tabelu:</span>
          <button type="button" class="izvoz-dugme" data-format="xlsx" title="Excel tabela sa formatiranim brojevima">Excel</button>
          <button type="button" class="izvoz-dugme" data-format="csv" title="Tekst odvojen tačka-zarezom (otvara se u Excel-u)">CSV</button>
          <button type="button" class="izvoz-dugme" data-format="txt" title="Običan tekst, poravnate kolone">TXT</button>
          <span class="izvoz-poruka" role="status"></span>`;
        const poruka = traka.querySelector('.izvoz-poruka');
        traka.addEventListener('click', (e) => {
            const dugme = e.target.closest('[data-format]');
            if (dugme) izvezi(tabela, dugme.dataset.format, poruka);
        });
        okvir.before(traka);
    }

    const pokreni = () => document.querySelectorAll('table[data-izvoz]').forEach(dodajTraku);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pokreni);
    else pokreni();

    window.Izvoz = { procitajTabelu, napraviCsv, napraviTxt };   // za proveru i testove
})();
