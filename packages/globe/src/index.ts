/**
 * @wisdomworks/globe — 3D Intelligence Globe (Epic 4)
 *
 * R3F/Three.js globe visualization — conditionally deployed only when
 * AxisDeploymentSpec.surfaces.globe = true (large orgs only).
 *
 * Stories 4.1-4.5:
 * - GlobeCanvas: entity nodes in 3D space
 * - ConnectionLines: relationship visualization
 * - ConnectedFracturedToggle: explode/collapse animation
 * - QualityTierSystem: full/reduced/minimal based on GPU
 * - IntelligenceViews: tabular + card alternatives (primary for most customers)
 */

// Types
export interface GlobeEntity {
  id: string;
  name: string;
  type: string;
  position: [number, number, number];
  color: string;
  size: number;
  metadata?: Record<string, unknown>;
}

export interface GlobeConnection {
  sourceId: string;
  targetId: string;
  type: string;
  strength: number;
  color: string;
}

export type QualityTier = 'full' | 'reduced' | 'minimal';

export interface GlobeConfig {
  entities: GlobeEntity[];
  connections: GlobeConnection[];
  qualityTier: QualityTier;
  mode: 'connected' | 'fractured';
  selectedEntityId?: string;
  queryHighlights?: string[];
}

export interface GlobeQueryDirective {
  action: 'highlight' | 'focus' | 'filter' | 'reset';
  entityIds?: string[];
  connectionTypes?: string[];
  zoomLevel?: number;
}

/**
 * Detect GPU quality tier based on WebGL capabilities.
 * Story 4.4 — Quality Tier System.
 */
export function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined') return 'minimal'; // SSR
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'minimal';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
      if (renderer.includes('nvidia') || renderer.includes('radeon') || renderer.includes('apple')) {
        return 'full';
      }
      if (renderer.includes('intel')) {
        return 'reduced';
      }
    }
    return 'reduced';
  } catch {
    return 'minimal';
  }
}

// Story 4.5 — Tabular/Card intelligence view (primary for most customers)
export interface IntelligenceViewData {
  entities: { id: string; name: string; type: string; connections: number; metadata: Record<string, unknown> }[];
  relationships: { source: string; target: string; type: string; confidence: number }[];
  queryResults?: string[];
}
