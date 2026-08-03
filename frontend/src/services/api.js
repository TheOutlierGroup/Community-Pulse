import axios from 'axios';

const api = axios.create({
  baseURL: '',
});

const TOKEN_KEY = 'pulse_token';

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    delete api.defaults.headers.common.Authorization;
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function loadStoredToken() {
  const t = sessionStorage.getItem(TOKEN_KEY);
  if (t) api.defaults.headers.common.Authorization = `Bearer ${t}`;
  return t;
}

// Step-up re-verification. Protected admin actions only accept a
// multi-factor verification made within the server's re-verify window; once
// it lapses they answer 403 with `mfaReverifyRequired`. The app registers a
// prompt here (see MfaReverifyProvider), and this interceptor collects a
// fresh code, exchanges it for a new token and replays the original request
// so the user does not lose the action they were part-way through.
let reverifyPrompt = null;
let inFlightReverify = null;

export function setMfaReverifyPrompt(prompt) {
  reverifyPrompt = prompt;
}

function needsReverify(error) {
  return (
    error?.response?.status === 403
    && error.response.data?.mfaReverifyRequired
    && !error.config?.__mfaReverifyRetry
  );
}

/** One dialog even when several requests lapse together. */
async function runReverify() {
  if (!inFlightReverify) {
    inFlightReverify = (async () => {
      let message = '';
      // A mistyped code re-prompts rather than dropping the action the
      // user was part-way through.
      for (;;) {
        const code = await reverifyPrompt({ error: message });
        if (!code) return false;
        try {
          const { data } = await api.post(
            '/api/auth/mfa/reverify',
            { code },
            { __mfaReverifyRetry: true }
          );
          if (!data?.token) return false;
          setAuthToken(data.token);
          return true;
        } catch (err) {
          if (err?.response?.status !== 401) return false;
          message = err.response.data?.error || 'Invalid code. Try again.';
        }
      }
    })().finally(() => { inFlightReverify = null; });
  }
  return inFlightReverify;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!reverifyPrompt || !needsReverify(error)) return Promise.reject(error);
    let verified = false;
    try {
      verified = await runReverify();
    } catch {
      verified = false;
    }
    if (!verified) return Promise.reject(error);
    // axios copied the now-stale Authorization into config at send time —
    // drop it so the replay picks up the token the re-verify just minted.
    const retryConfig = { ...error.config, __mfaReverifyRetry: true };
    if (retryConfig.headers) delete retryConfig.headers.Authorization;
    return api(retryConfig);
  }
);

export default api;
