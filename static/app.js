const form = document.getElementById("forma");

async function dodaj_korisnika() {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/korisnici", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    if (response.status == 500) throw new Error("Sistem ili network error!");
    else if (response.status == 422) throw new Error("Morate uneti bar jedno slovo za ime!");

    const result = await response.json();
    document.getElementById("poruka").textContent = result;
  } catch (error) {
      if (error instanceof Error) {
        document.getElementById("poruka").textContent = error.message;
      }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  dodaj_korisnika();
});