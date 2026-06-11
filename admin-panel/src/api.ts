import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const login = (loginId: string, password: string) =>
  api.post('/auth/login', { loginId, password });

export const getProfile = () => api.get('/auth/me');

// Admin - Enumerators
export const getEnumerators = () => api.get('/admin/enumerators');
export const createEnumerator = (data: any) => api.post('/admin/enumerators', data);
export const updateEnumerator = (id: string, data: any) => api.patch(`/admin/enumerators/${id}`, data);
export const deleteEnumerator = (id: string) => api.delete(`/admin/enumerators/${id}`);
export const assignDistricts = (id: string, districtIds: string[]) =>
  api.put(`/admin/enumerators/${id}/districts`, { districtIds });

// Admin - Districts
export const getDistricts = () => api.get('/admin/districts');

// Admin - Analytics
export const getAnalytics = () => api.get('/admin/analytics');

// Admin - Audit Logs
export const getAuditLogs = (params?: any) => api.get('/admin/audit-logs', { params });

// Dashboard
export const getDashboardStats = () => api.get('/dashboard/stats');

// Stakeholders
export const searchStakeholders = (params: any) => api.get('/stakeholders/search', { params });
export const getStakeholderById = (id: string) => api.get(`/stakeholders/${id}`);

// Surveys
export const getSurveyByStakeholder = (stakeholderId: string) =>
  api.get(`/surveys/stakeholder/${stakeholderId}`);

// Media
export const getMediaBySurvey = (surveyId: string) => api.get(`/media/survey/${surveyId}`);

export default api;
