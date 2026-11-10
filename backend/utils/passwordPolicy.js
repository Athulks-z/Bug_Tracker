function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

module.exports = { isStrongPassword };
