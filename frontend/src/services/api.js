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

export default api;
