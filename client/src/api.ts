const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || error.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Shared types

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'user' | 'admin';
  listingCount: number;
  createdAt: string;
}


export interface ListingImage {
  id: number;
  listingId: number;
  sourceUrl: string;
  localPathOriginal: string | null;
  localPathResized: string | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number | null;
  downloadStatus: 'pending' | 'downloaded' | 'failed';
  analysisStatus: 'pending' | 'analyzed' | 'skipped' | 'failed';
  analysisResult: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface Listing {
  id: number;
  externalId: string;
  platform: 'craigslist' | 'offerup' | 'ebay' | 'sawbuck';
  url: string;
  title: string;
  description: string | null;
  askingPrice: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  sellerName: string | null;
  postedAt: string | null;
  scrapedAt: string;
  status: 'new' | 'analyzed' | 'watching' | 'acquired' | 'dismissed';
  furnitureType: string | null;
  furnitureStyle: string | null;
  conditionScore: number | null;
  conditionNotes: string | null;
  woodSpecies: string | null;
  woodConfidence: number | null;
  analysisRaw: string | null;
  analyzedAt: string | null;
  estimatedValue: number | null;
  estimatedRefinishedValue: number | null;
  dealScore: number | null;
  matchedSearchTerms: string | null;
  fingerprint: string | null;
  analysisError: string | null;
  userId: string | null;
  primaryImage?: string | null;
  conceptImages?: Array<{ localPath: string; prompt: string }> | null;
}

export interface ListingDetail extends Listing {
  images: ListingImage[];
}

export interface Comparable {
  id: number;
  listingId: number | null;
  source: string;
  sourceUrl: string | null;
  title: string;
  soldPrice: number;
  soldDate: string | null;
  condition: string | null;
  furnitureType: string | null;
  furnitureStyle: string | null;
  searchQuery: string | null;
  createdAt: string;
}

export interface RefinishingStep {
  order: number;
  title: string;
  description: string;
  duration_minutes: number;
  products: { name: string; brand: string; quantity: number; unit: string; estimated_price: number }[];
  tips: string[];
}

export interface RagSource {
  title: string;
  source: string;
  type: 'project' | 'product' | 'guide';
}

export interface RefinishingPlan {
  id: number;
  listingId: number;
  projectId: number | null;
  styleRecommendation: string | null;
  description: string | null;
  steps: RefinishingStep[];
  estimatedHours: number | null;
  estimatedMaterialCost: number | null;
  estimatedResalePrice: number | null;
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | null;
  beforeDescription: string | null;
  afterDescription: string | null;
  rawResponse: string | null;
  ragSourcesUsed: number | null;
  ragSourceTitles: string | null;
  ragSources: string | null;
  createdAt: string;
}

export interface Material {
  id: number;
  refinishingPlanId: number;
  projectId: number | null;
  category: string;
  productName: string;
  brand: string | null;
  quantity: number;
  unit: string | null;
  estimatedPrice: number | null;
  actualPrice: number | null;
  purchased: boolean;
  amazonSearchUrl: string | null;
  homeDepotSearchUrl: string | null;
  lowesSearchUrl: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ProjectPhoto {
  id: number;
  projectId: number;
  photoType: 'before' | 'during' | 'after';
  localPath: string;
  caption: string | null;
  takenAt: string;
}

export interface Project {
  id: number;
  listingId: number;
  name: string;
  status: 'acquired' | 'refinishing' | 'listed' | 'sold' | 'abandoned';
  purchasePrice: number;
  purchaseDate: string | null;
  purchaseNotes: string | null;
  totalMaterialCost: number | null;
  hoursInvested: number | null;
  hourlyRate: number | null;
  listedPrice: number | null;
  listedDate: string | null;
  listedPlatform: string | null;
  soldPrice: number | null;
  soldDate: string | null;
  sellingFees: number | null;
  shippingCost: number | null;
  totalCost: number | null;
  profit: number | null;
  roiPercentage: number | null;
  notes: string | null;
  listingText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends Project {
  listing: ListingDetail | null;
  plan: RefinishingPlan | null;
  materials: Material[];
  photos: ProjectPhoto[];
}

export interface PipelineProject extends Project {
  primaryImagePath: string | null;
  furnitureType: string | null;
  furnitureStyle: string | null;
}

export interface Preferences {
  preferredLatitude: number | null;
  preferredLongitude: number | null;
  preferredRadiusMiles: number | null;
  maxBudget: number | null;
  shopSpace: string | null;
  experienceLevel: string | null;
  stylePreferences: string[] | null;
}

export interface StatsResponse {
  summary: {
    total_listings: number;
    dismissed_count: number;
    analyzed_count: number;
    avg_asking_price: number | null;
    first_scraped: string | null;
    last_scraped: string | null;
  };
  projectSummary: {
    total_projects: number;
    total_profit: number | null;
    avg_roi: number | null;
    avg_flip_days: number | null;
  };
  profitOverTime: { month: string; total_profit: number; count: number }[];
  dealsByPlatform: { platform: string; count: number }[];
  flipTimes: { name: string; days: number }[];
  scrapedOverTime: { week: string; count: number }[];
  priceDistribution: { bucket: string; count: number }[];
  dealScoreDistribution: { bucket: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
  topFurnitureTypes: { type: string; count: number }[];
}

export interface AnalysisResult extends ListingDetail {
  analysis: Record<string, unknown>;
  pricing: {
    estimatedValue: number;
    estimatedRefinishedValue: number;
    dealScore: number;
    comparableCount: number;
    medianCompPrice: number;
    conditionMultiplier: number;
    soldCount: number;
    activeCount: number;
  } | null;
}

export interface CreateProjectInput {
  listingId: number;
  name: string;
  purchasePrice: number;
  purchaseDate?: string;
  purchaseNotes?: string;
}

export interface CostUpdates {
  hoursInvested?: number;
  hourlyRate?: number;
  soldPrice?: number;
  soldDate?: string;
  listedPrice?: number;
  listedDate?: string;
  listedPlatform?: string;
  sellingFees?: number;
  shippingCost?: number;
}

export interface MaterialUpdate {
  purchased?: boolean;
  actualPrice?: number;
}

export interface AgentRun {
  id: number;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  scraped: number | null;
  triaged: number | null;
  passedTriage: number | null;
  evaluated: number | null;
  qualified: number | null;
  rendered: number | null;
  errorsCount: number | null;
  errorDetails: Array<{ node: string; message: string; timestamp: string }> | null;
}

// API client


export const api = {
  // Listings
  getListings: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ listings: Listing[]; total: number }>(`/listings${qs}`);
  },
  getListing: (id: number) => request<ListingDetail>(`/listings/${id}`),
  updateListing: (id: number, data: Partial<Listing>) =>
    request<Listing>(`/listings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkUpdateListings: (ids: number[], updates: Partial<Listing>) =>
    request<{ updated: number }>('/listings/bulk', { method: 'PATCH', body: JSON.stringify({ ids, updates }) }),
  analyzeListing: (id: number) =>
    request<AnalysisResult>(`/listings/${id}/analyze`, { method: 'POST' }),
  importListing: (url: string) =>
    request<{ listing: ListingDetail; alreadyExists: boolean }>('/listings/import', { method: 'POST', body: JSON.stringify({ url }) }),

  // Projects
  getProjects: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Project[]>(`/projects${qs}`);
  },
  getProject: (id: number) => request<ProjectDetail>(`/projects/${id}`),
  createProject: (data: CreateProjectInput) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: number, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id: number) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  // Agent runs (admin)
  getAgentRuns: () => request<{ recentRuns: AgentRun[] }>('/scrapers/status'),

  // Preferences
  getPreferences: () => request<Preferences>('/user/preferences'),
  updatePreferences: (data: Partial<Preferences>) =>
    request<{ success: boolean }>('/user/preferences', { method: 'PATCH', body: JSON.stringify(data) }),

  // Refinishing
  generateRefinishingPlan: (projectId: number) =>
    request<{ plan: RefinishingPlan; materials: Material[] }>(`/projects/${projectId}/refinish`, { method: 'POST' }),
  getRefinishingPlan: (projectId: number) =>
    request<RefinishingPlan>(`/projects/${projectId}/refinish`),

  // Materials
  getProjectMaterials: (projectId: number) =>
    request<Material[]>(`/projects/${projectId}/materials`),
  updateMaterial: (projectId: number, materialId: number, data: MaterialUpdate) =>
    request<Material>(`/projects/${projectId}/materials/${materialId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Project costs
  updateProjectCosts: (projectId: number, data: CostUpdates) =>
    request<Project>(`/projects/${projectId}/costs`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Photos
  getProjectPhotos: (projectId: number) =>
    request<ProjectPhoto[]>(`/projects/${projectId}/photos`),
  uploadProjectPhoto: async (projectId: number, file: File, type: string, caption?: string): Promise<ProjectPhoto> => {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('type', type);
    if (caption) formData.append('caption', caption);

    const res = await fetch(`${BASE}/projects/${projectId}/photos`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  deleteProjectPhoto: (projectId: number, photoId: number) =>
    request<{ ok: boolean }>(`/projects/${projectId}/photos/${photoId}`, { method: 'DELETE' }),

  // Listing text
  generateListingText: (projectId: number, regenerate = false) =>
    request<{ text: string }>(`/projects/${projectId}/listing-text`, { method: 'POST', body: JSON.stringify({ regenerate }) }),

  // Pipeline
  getProjectsPipeline: () => request<PipelineProject[]>('/projects/pipeline/all'),

  // Stats
  getStats: () => request<StatsResponse>('/stats'),

  // Comparables
  searchComparables: (listingId: number) =>
    request<{ comps: Comparable[] }>(`/comparables/search`, { method: 'POST', body: JSON.stringify({ listingId }) }),
  getComparables: (listingId: number) => request<Comparable[]>(`/comparables/${listingId}`),

  deleteListing: (id: number) =>
    request<{ ok: boolean }>(`/listings/${id}`, { method: 'DELETE' }),

  // Sawbuck listings
  editSawbuckListing: (id: number, data: { title?: string; description?: string | null; askingPrice?: number; location?: string | null }) =>
    request<Listing>(`/listings/create/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  createSawbuckListing: async (data: FormData) => {
    const res = await fetch(`${BASE}/listings/create`, {
      method: 'POST',
      credentials: 'include',
      body: data,
    });
    if (res.status === 401) { window.location.href = '/login'; throw new Error('Unauthorized'); }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ listing: Listing }>;
  },

  // Admin
  getUsers: () => request<AdminUser[]>('/admin/users'),
  updateUserRole: (userId: string, role: 'user' | 'admin') =>
    request<{ ok: boolean }>(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteUser: (userId: string) =>
    request<{ ok: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' }),
};
