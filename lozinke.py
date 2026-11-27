from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# Initialize with secure defaults (Argon2id, 64 MiB memory, 3 iterations, 4 lanes)
ph = PasswordHasher()

# 1. Hash a password
hashed_password = ph.hash("correct horse battery staple")
# Output example: $argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ...

# 2. Verify a password
try:
    is_valid = ph.verify(hashed_password, "correct horse battery staple")
    print("Login successful:", is_valid)  # True
except VerifyMismatchError:
    print("Invalid password.")


def hash_password(password):
    return ph.hash(password)

def verifikuj(password, password_hash):
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False