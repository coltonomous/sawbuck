// Shared interfaces used by both server/ and client/.
// Keep these minimal — only what crosses the API boundary.

import type { Platform, ListingStatus, ProjectStatus, PhotoType, FlipRecommendation, RagChunkType, UserRole, ConceptDifficulty } from './constants.js';

export interface Region {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  clSubdomain: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface PlatformSetting {
  platform: Platform;
  enabled: boolean;
}

export interface RagSource {
  title: string;
  source: string;
  type: RagChunkType;
}

/** Pipeline node status for the agent run visualization. */
export interface PipelineNodeStatus {
  node: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'error';
  count?: number;
  durationMs?: number;
}

export interface AgentRunSummary {
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
