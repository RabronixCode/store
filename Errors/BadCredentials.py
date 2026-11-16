class BadCredentials(Exception):
    def __init__(self, message="Pogresan username ili sifra!"):
        self.message = message
        super().__init__(self.message)  