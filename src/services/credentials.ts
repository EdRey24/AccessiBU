const BU_EMAIL = /^[^@\s]+@bu\.edu$/;

/** Lowercases and trims an address before the domain check. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Returns an error when the address is not a @bu.edu address. */
export function emailError(email: string): string | null {
  if (!BU_EMAIL.test(email)) return 'Use a @bu.edu address.';
  return null;
}

/** Returns an error when the password is outside 8 to 128 characters. */
export function passwordError(password: string): string | null {
  if (password.length < 8 || password.length > 128) {
    return 'Use a password of 8 to 128 characters.';
  }
  return null;
}
