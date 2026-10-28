import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
});

// Separate browser credentials: a portal login must not replace an internal session.
export const portalApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('portal_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

portalApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && err.config?.url !== '/portal/login') {
      localStorage.removeItem('portal_token');
      localStorage.removeItem('portal_user');
      window.dispatchEvent(new Event('pms:portal-session-expired'));
    }
    return Promise.reject(err);
  },
);

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // There is no refresh-token API. Reject every failed request promptly;
      // queuing it would leave later login attempts pending forever.
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    if (err.response?.status === 422 && err.response?.data?.errors) {
      const msg = err.response.data.errors.map((e: any) => `${e.field}: ${e.message}`).join("; ");
      err.response.data.detail = msg || err.response.data.detail;
    }
    return Promise.reject(err);
  },
);

export default api;

// Auth helpers
export const login = async (username: string, password: string) => {
  const { data } = await api.post('/auth/login', { username, password });
  localStorage.setItem('token', data.access_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data;
};

export const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('sessionOnly');
  window.location.href = '/login';
};

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

// API functions
export const fetchDashboard = () => api.get('/dashboard').then(r => r.data);
export const updateMyProfile = (data: any) => api.put('/auth/me', data).then(r => r.data);
export const fetchWorkbench = () => api.get('/workbench').then(r => r.data);
export const fetchProjects = (params?: any) => api.get('/projects', { params }).then(r => r.data);
export const fetchProjectsSummary = () => api.get('/projects/summary').then(r => r.data);
export const archiveProject = (id: string) => api.put(`/projects/${id}`, { is_archived: true }).then(r => r.data);
export const createProject = (data: any) => api.post('/projects', data).then(r => r.data);
export const fetchTasks = (params?: any) => api.get('/tasks', { params }).then(r => r.data);
export const createTask = (data: any) => api.post('/tasks', data).then(r => r.data);
export const updateTask = (id: string, data: any) => api.put(`/tasks/${id}`, data).then(r => r.data);
export const deleteTask = (id: string) => api.delete(`/tasks/${id}`).then(r => r.data);
export const fetchContracts = (params?: any) => api.get('/contracts', { params }).then(r => r.data);
export const createContract = (data: any) => api.post('/contracts', data).then(r => r.data);
export const fetchReceipts = (params?: any) => api.get('/receipts', { params }).then(r => r.data);
export const createReceipt = (data: any) => api.post(data.idempotency_key ? '/finance/receipts' : '/receipts', data).then(r => r.data);
export const confirmReceipt = (id: string) => api.put(`/receipts/${id}/confirm`).then(r => r.data);
export const reverseReceipt = (id: string) => api.put(`/receipts/${id}/reverse`).then(r => r.data);
export const fetchReceiptStats = (projectId: string) => api.get(`/receipts/project/${projectId}/stats`).then(r => r.data);
export const fetchRisks = (params?: any) => api.get('/risks', { params }).then(r => r.data);
export const fetchIssues = (params?: any) => api.get('/issues', { params }).then(r => r.data);
export const fetchMilestones = (params?: any) => api.get('/milestones', { params }).then(r => r.data);
export const createRisk = (data: any) => api.post('/risks', data).then(r => r.data);
export const updateRisk = (id: string, data: any) => api.put(`/risks/${id}`, data).then(r => r.data);
export const deleteRisk = (id: string) => api.delete(`/risks/${id}`).then(r => r.data);
export const createMilestone = (data: any) => api.post('/milestones', data).then(r => r.data);
export const updateMilestone = (id: string, data: any) => api.put(`/milestones/${id}`, data).then(r => r.data);
export const deleteMilestone = (id: string) => api.delete(`/milestones/${id}`).then(r => r.data);
export const addRiskFollowUp = (riskId: string, data: any) => api.post(`/risks/${riskId}/follow-ups`, data).then(r => r.data);
export const fetchCustomers = (params?: any) => api.get('/customers', { params }).then(r => r.data);
export const createCustomer = (data: any) => api.post('/customers', data).then(r => r.data);
export const fetchInvoices = (params?: any) => api.get('/invoices', { params }).then(r => r.data);
export const createInvoice = (data: any) => api.post('/invoices', data).then(r => r.data);
export const fetchNotifications = (unreadOnly?: boolean) => api.get('/notifications', { params: { unread_only: unreadOnly } }).then(r => r.data);
export const deleteNotification = (id: string) => api.delete(`/notifications/${id}`).then(r => r.data);
export const markAllRead = () => api.put('/notifications/read-all').then(r => r.data);
export const fetchFiles = (params?: any) => api.get('/files/list', { params }).then(r => r.data);
export const fetchActivities = (params?: any) => api.get('/activities', { params }).then(r => r.data);
export const fetchProject = (id: string) => api.get(`/projects/${id}`).then(r => r.data);
export const updateProject = (id: string, data: any) => api.put(`/projects/${id}`, data).then(r => r.data);
export const fetchAuditLogs = () => api.get('/audit-logs').then(r => r.data);
export const importExcel = (formData: FormData) => api.post('/import/excel', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
export const fetchApprovalInstances = () => api.get('/approvals/instances').then(r => r.data);
export const fetchMyPendingApprovals = () => api.get('/approvals/my-pending').then(r => r.data);
export const decideApproval = (instanceId: string, stepId: string, decision: string, comment?: string) => api.put(`/approvals/instances/${instanceId}/step/${stepId}?decision=${decision}&comment=${comment || ''}`).then(r => r.data);
export const withdrawApproval = (instanceId: string) => api.put(`/approvals/instances/${instanceId}/withdraw`).then(r => r.data);
export const fetchUsers = () => api.get('/auth/users').then(r => r.data);
export const deleteUser = (id: string) => api.delete(`/auth/users/${id}`).then(r => r.data);
export const fetchBudgetVsActual = (projectId?: string) => api.get('/reports/budget-vs-actual', { params: { project_id: projectId } }).then(r => r.data);

// ============ P1: 甘特图 / 日历 ============
export const fetchGantt = (projectId: string) => api.get(`/gantt/${projectId}`).then(r => r.data);
export const fetchCalendarEvents = (params?: any) => api.get('/calendar', { params }).then(r => r.data);

// ============ P1: 工时填报与审批 ============
export const fetchTimesheets = (params?: any) => api.get('/timesheets', { params }).then(r => r.data);
export const createTimesheet = (data: any) => api.post('/timesheets', data).then(r => r.data);
export const deleteTimesheet = (id: string) => api.delete(`/timesheets/${id}`).then(r => r.data);
export const approveTimesheet = (id: string, comment?: string) => api.post(`/timesheets/${id}/approve`, { comment: comment || '' }).then(r => r.data);
export const rejectTimesheet = (id: string, comment?: string) => api.post(`/timesheets/${id}/reject`, { comment: comment || '' }).then(r => r.data);
export const fetchTimesheetSummary = (params?: any) => api.get('/timesheets/summary/hours', { params }).then(r => r.data);

// ============ P1: 资源负载 ============
export const fetchResourceLoad = (params?: any) => api.get('/resource-load', { params }).then(r => r.data);

// ============ P1: 成本归集与利润分析 ============
export const fetchExpenses = (params?: any) => api.get('/expenses', { params }).then(r => r.data);
export const createExpense = (data: any) => api.post('/expenses', data).then(r => r.data);
export const deleteExpense = (id: string) => api.delete(`/expenses/${id}`).then(r => r.data);
export const fetchCostProfit = () => api.get('/reports/cost-profit').then(r => r.data);

// ============ P1: 文档版本管理 ============
export const fetchDocuments = (params?: any) => api.get('/documents', { params }).then(r => r.data);
export const createDocument = (data: any) => api.post('/documents', data).then(r => r.data);
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`).then(r => r.data);
export const fetchDocumentVersions = (id: string) => api.get(`/documents/${id}/versions`).then(r => r.data);
export const uploadDocumentVersion = (id: string, file: File, notes?: string) => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('notes', notes || '');
  return api.post(`/documents/${id}/versions`, fd).then(r => r.data);
};
export const downloadDocumentVersion = async (docId: string, versionId: string, fileName: string) => {
  const { data } = await api.get(`/documents/${docId}/versions/${versionId}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

// ============ P1: 保存列表视图 ============
export const fetchSavedViews = (page?: string) => api.get('/saved-views', { params: { page } }).then(r => r.data);
export const createSavedView = (data: any) => api.post('/saved-views', data).then(r => r.data);
export const deleteSavedView = (id: string) => api.delete(`/saved-views/${id}`).then(r => r.data);

// ============ P1: 客户门户 ============
export const portalLogin = (username: string, password: string) => portalApi.post('/portal/login', { username, password }).then(r => r.data);
export const fetchPortalProjects = () => portalApi.get('/portal/projects').then(r => r.data);
export const fetchPortalProject = (id: string) => portalApi.get(`/portal/projects/${id}`).then(r => r.data);
export const grantPortalUser = (customerId: string, data: any) => api.post(`/customers/${customerId}/portal-users`, data).then(r => r.data);
export const fetchPortalUsers = (customerId: string) => api.get(`/customers/${customerId}/portal-users`).then(r => r.data);


// Export helpers (blob responses with auth)
export const exportProjects = async () => {
  const { data } = await api.get('/export/projects', { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = 'projects.xlsx'; a.click();
  URL.revokeObjectURL(url);
};
export const exportReceipts = async (projectId?: string) => {
  const { data } = await api.get('/export/receipts', { params: { project_id: projectId }, responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = 'receipts.xlsx'; a.click();
  URL.revokeObjectURL(url);
};
export const exportAging = async () => {
  const { data } = await api.get('/export/aging', { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = 'aging_report.xlsx'; a.click();
  URL.revokeObjectURL(url);
};
