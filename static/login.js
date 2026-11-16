const forma = document.getElementById('forma-login');

async function login() {

    const formData = new FormData(forma);
    const data = Object.fromEntries(formData.entries());

    try{

        const response = await fetch('/login', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        })

        const result = await response.json();
        if (response.status == 401) {
            forma.reset();
            throw new Error(result);
        }



    }catch (error) {
        if (error instanceof Error) {
            document.getElementById("poruka").textContent = error.message;
        }
    }

}

forma.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log("AAA")
    login();
})