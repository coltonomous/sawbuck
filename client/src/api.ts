const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || error.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Listings
  getListings: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/listings${qs}`);
  },
  getListing: (id: number) => request<any>(`/listings/${id}`),
  updateListing: (id: number, data: any) =>
    request<any>(`/listings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkUpdateListings: (ids: number[], updates: Record<string, any>) =>
    request<{ updated: number }>('/listings/bulk', { method: 'PATCH', body: JSON.stringify({ ids, updates }) }),
  analyzeListing: (id: number) =>
    request<any>(`/listings/${id}/analyze`, { method: 'POST' }),

  // Projects
  getProjects: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/projects${qs}`);
  },
  getProject: (id: number) => request<any>(`/projects/${id}`),
  createProject: (data: any) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: number, data: any) =>
    request<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Scrapers
  runScraper: () => request<any>('/scrapers/run', { method: 'POST' }),
  getScraperStatus: () => request<any>('/scrapers/status'),
  addSearchConfig: (data: any) =>
    request<any>('/scrapers/configs', { method: 'POST', body: JSON.stringify(data) }),
  deleteSearchConfig: (id: number) =>
    request<any>(`/scrapers/configs/${id}`, { method: 'DELETE' }),
  clearAllSearchConfigs: () =>
    request<any>('/scrapers/configs/all', { method: 'DELETE' }),
  getPlatformSettings: () =>
    request<{ platform: string; enabled: boolean }[]>('/scrapers/platforms'),
  togglePlatform: (platform: string, enabled: boolean) =>
    request<any>(`/scrapers/platforms/${platform}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

  // Refinishing
  generateRefinishingPlan: (projectId: number) =>
    request<any>(`/projects/${projectId}/refinish`, { method: 'POST' }),
  getRefinishingPlan: (projectId: number) =>
    request<any>(`/projects/${projectId}/refinish`),

  // Materials
  getProjectMaterials: (projectId: number) =>
    request<any[]>(`/projects/${projectId}/materials`),
  updateMaterial: (projectId: number, materialId: number, data: any) =>
    request<any>(`/projects/${projectId}/materials/${materialId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Project costs
  updateProjectCosts: (projectId: number, data: any) =>
    request<any>(`/projects/${projectId}/costs`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Photos
  getProjectPhotos: (projectId: number) =>
    request<any[]>(`/projects/${projectId}/photos`),
  uploadProjectPhoto: async (projectId: number, file: File, type: string, caption?: string) => {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('type', type);
    if (caption) formData.append('caption', caption);
    const res = await fetch(`${BASE}/projects/${projectId}/photos`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  deleteProjectPhoto: (projectId: number, photoId: number) =>
    request<any>(`/projects/${projectId}/photos/${photoId}`, { method: 'DELETE' }),

  // Pipeline
  getProjectsPipeline: () => request<any[]>('/projects/pipeline/all'),

  // Stats
  getStats: () => request<any>('/stats'),

  // Comparables
  searchComparables: (listingId: number) =>
    request<any>(`/comparables/search`, { method: 'POST', body: JSON.stringify({ listingId }) }),
  getComparables: (listingId: number) => request<any[]>(`/comparables/${listingId}`),
};
