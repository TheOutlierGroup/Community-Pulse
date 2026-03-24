import axios from 'axios';

const api = axios.create({
  baseURL: '',
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    localStorage.setItem('pulse_token', token);
  } else {
    delete api.defaults.headers.common.Authorization;
    localStorage.removeItem('pulse_token');
  }
}

export function loadStoredToken() {
  const t = localStorage.getItem('pulse_token');
  if (t) api.defaults.headers.common.Authorization = `Bearer ${t}`;
  return t;
}

export default api;
