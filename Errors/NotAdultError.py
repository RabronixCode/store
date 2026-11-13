class NotAdultError(Exception):
    def __init__(self, message="Moras imati vise od 18 godina!"):
        self.message = message
        super().__init__(self.message)  