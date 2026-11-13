document.addEventListener("DOMContentLoaded", () => {
    const dropdown = document.getElementById("dobavljac");
    
    fetch('/dobavljaci')
        .then(response => {
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            return response.json();
        })
        .then(data => {
            dropdown.innerHTML = '<option value="" disabled selected>Choose one...</option>';

            
            data.forEach(item => {
                const option = document.createElement("option");
                
                option.value = item.dobavljac_id;
                option.textContent = item.naziv;
                
                dropdown.appendChild(option);
            });
        })
        .catch(error => {
            console.error("Error loading dropdown options:", error);
            dropdown.innerHTML = '<option value="" disabled>Error loading options</option>';
        });
});

document.getElementById("dodaj-stavku").addEventListener("click", (event) => {
    event.preventDefault();
    const sablon = document.getElementById("stavka-sablon");
    const klon = sablon.content.cloneNode(true);

    document.getElementById("stavke").appendChild(klon);
});

document.querySelector("#stavke").addEventListener("click", (event) => {
    event.preventDefault();
    const ukloni = event.target.closest(".ukloni-stavku");

    if (ukloni) {
        // Find the parent .stavka div for this specific button and delete it
        const red = ukloni.closest(".stavka");
        if (red) {  
            red.remove();
        }
    }
    
});

const form = document.getElementById("forma-ulaz");
const novi_artikal_lista = document.getElementById("novi-artikli-lista");
const novi_artikal_form = document.querySelectorAll("#novi-artikal");

async function dodaj_ulaz() {

  listaStavki = document.querySelectorAll('.stavka');

  const stavke = [];
  listaStavki.forEach((red) => {
    const stavka = {
        sifra: Number(red.querySelector('[name="sifra"]').value),
        kolicina: Number(red.querySelector('[name="kolicina"]').value),
        nabavna_cena: Number(red.querySelector('[name="nabavna_cena"]').value),
        pdv: Number(red.querySelector('[name="pdv"]').value)
    };
    stavke.push(stavka);
  });

  dobavljac_id = document.getElementById('dobavljac').value;
  racun_broj = document.getElementById('racun_broj').value;
  racun_poziv_na_broj = document.getElementById('racun_poziv_na_broj').value;
  datum_vreme = document.getElementById('datum_vreme').value;
  
  data = { dobavljac_id, racun_broj, racun_poziv_na_broj, datum_vreme, stavke };

  try {

    const missing = await fetch("/provera", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ stavke })
    });
    const missingData = await missing.json();

    if (missingData.length > 0) {
        cnt = missingData.length;
        await napraviListuArtikala(missingData, cnt);
    }
    document.getElementById("poruka").textContent = "Uspesno uneto ranije!";
    const response = await fetch("/ulazi", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    document.getElementById("poruka").textContent = "Uspesno uneto!";
    const result = await response.json();
    if (response.status == 409) throw new Error("Racun/otpremnica sa tim brojem i dobavljacem vec postoji!");

    document.getElementById("poruka").textContent = "Uspesno uneto!";
    form.reset();

  } catch (error) {
      if (error instanceof Error) {
        document.getElementById("poruka").textContent = error.message;
      }
  }
}

async function napraviListuArtikala(missingData, cnt) {
    return new Promise((resolve) => {

        for (let i = 0; i < missingData.length; i++) {
            sablon = document.getElementById("novi-artikal-sablon");
            klon = sablon.content.cloneNode(true);
            klon.querySelector('[data-polje="sifra_dobavljac"]').textContent = missingData[i].sifra;
            klon.querySelector('[data-polje="kolicina"]').textContent = missingData[i].kolicina;
            klon.querySelector('[data-polje="nabavna_cena"]').textContent = missingData[i].nabavna_cena;
            klon.querySelector('[data-polje="pdv"]').textContent = missingData[i].pdv;

            klon.querySelector('[data-polje="sifra_dobavljac"]').value = missingData[i].sifra;
            klon.querySelector('[data-polje="kolicina"]').value = missingData[i].kolicina;
            klon.querySelector('[data-polje="nabavna_cena"]').value = missingData[i].nabavna_cena;
            klon.querySelector('[data-polje="pdv"]').value = missingData[i].pdv;

            document.getElementById("novi-artikli-lista").appendChild(klon);
        }

        dijalog = document.getElementById('novi-artikli-dijalog');
        dijalog.showModal()

        sviArtikli = [];

        novi_artikal_lista.addEventListener("click", async (event) => {
            
            event.preventDefault();
            const dodaj = event.target.closest(".dodaj");

            if (dodaj) {
                sviArtikli.push(dodaj_artikal());
                console.log(sviArtikli);
                const red = dodaj.closest(".novi-artikal");
                if (red) {  
                    red.remove();
                    cnt -= 1;
                }
                if (cnt == 0) {
                    try {
                        const response = await fetch('/artikal', {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(sviArtikli)
                        });

                        const result = await response.json();

                    } catch (error) {
                        if (error instanceof Error) {
                            document.getElementById("poruka").textContent = error.message;
                        }
                    dijalog.close();
                    }
                }
                
            }

        });

        document.getElementById('novi-artikli-odustani').addEventListener("click", (event) => {
            event.preventDefault();
            dijalog.close();
        });
        
        document.getElementById('novi-artikli-odustani').addEventListener("click", () => {
            dijalog.close();
        }, { once: true });
    });
    
}




function dodaj_artikal() {

    naziv = document.querySelector('[name="naziv"]').value;
    jedinica_mere = document.querySelector('[name="jedinica_mere"]').value;
    bar_kod = document.querySelector('[name="bar_kod"]').value;
    kategorija = document.querySelector('[name="kategorija"]').value;
    prodajna_cena = document.querySelector('[name="prodajna_cena"]').value;
    nabavna_cena_ponderisana = document.querySelector('[data-polje="nabavna_cena"]').value;
    dobavljac_id = document.getElementById('dobavljac').value;
    pdv = document.querySelector('[name="pdv"]').value;
    sifra_dobavljac = document.querySelector('[data-polje="sifra_dobavljac"]').value;

    const sviPodaci = {
        naziv,
        kategorija,
        bar_kod,
        stanje: 0,
        prodajna_cena,
        nabavna_cena_ponderisana,
        jedinica_mere,
        aktivan: 1,
        dobavljac_id,
        pdv,
        sifra_dobavljac
    };

    return sviPodaci;   
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  dodaj_ulaz();
});