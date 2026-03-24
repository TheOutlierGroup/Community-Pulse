/**
 * Maps axios / network errors from POST /api/auth/login to user-facing copy.
 */
export function getLoginErrorMessage(err) {
  const status = err.response?.status;
  const serverMsg =
    typeof err.response?.data?.error === 'string' ? err.response.data.error : null;

  if (!err.response) {
    if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
      return "We can't reach the server. Check your connection and try again.";
    }
    return 'Something went wrong. Please try again.';
  }

  if (status === 429) {
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }

  if (status === 401) {
    if (serverMsg === 'Invalid credentials') {
      return 'Invalid email or password.';
    }
    return serverMsg || 'Invalid email or password.';
  }

  if (status === 400) {
    return serverMsg || 'Please check your email and password.';
  }

  return serverMsg || 'Sign-in failed. Please try again.';
}
