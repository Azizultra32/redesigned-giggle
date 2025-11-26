/**
 * Autopilot Module (PATH J - Feed D)
 *
 * Tracks DOM mapping history and determines fill readiness.
 * Emits status updates to overlay autopilot pill.
 */

export type AutopilotStatus = 'OFFLINE' | 'LEARNING' | 'READY';

export interface DOMSurface {
  fieldId: string;
  label: string;
  fieldType: string;
  hasFillData: boolean;
  lastSeen: number;
}

export interface AutopilotState {
  status: AutopilotStatus;
  surfaces: DOMSurface[];
  readiness: number; // 0-1
  lastMapTime: number | null;
  mapCount: number;
}

export class Autopilot {
  private state: AutopilotState = {
    status: 'OFFLINE',
    surfaces: [],
    readiness: 0,
    lastMapTime: null,
    mapCount: 0
  };

  private onStatusChange: ((state: AutopilotState) => void) | null = null;

  constructor(onStatusChange?: (state: AutopilotState) => void) {
    this.onStatusChange = onStatusChange || null;
  }

  /**
   * Process DOM map result from extension
   */
  ingestDOMMap(fields: DOMSurface[]): void {
    this.state.surfaces = fields;
    this.state.lastMapTime = Date.now();
    this.state.mapCount++;

    this.calculateReadiness();
    this.emitStatus();
  }

  /**
   * Mark a field as having fill data available
   */
  markFieldReady(fieldId: string): void {
    const surface = this.state.surfaces.find(s => s.fieldId === fieldId);
    if (surface) {
      surface.hasFillData = true;
      this.calculateReadiness();
      this.emitStatus();
    }
  }

  /**
   * Calculate readiness score (0-1)
   * Based on: surfaces found, fill data available, map frequency
   */
  private calculateReadiness(): void {
    const { surfaces, mapCount } = this.state;

    if (surfaces.length === 0) {
      this.state.readiness = 0;
      this.state.status = 'OFFLINE';
      return;
    }

    const fieldsWithData = surfaces.filter(s => s.hasFillData).length;
    const dataRatio = fieldsWithData / surfaces.length;

    // Confidence increases with more maps
    const mapConfidence = Math.min(mapCount / 3, 1);

    this.state.readiness = dataRatio * 0.7 + mapConfidence * 0.3;

    // Determine status
    if (this.state.readiness >= 0.7) {
      this.state.status = 'READY';
    } else if (this.state.readiness > 0) {
      this.state.status = 'LEARNING';
    } else {
      this.state.status = 'OFFLINE';
    }
  }

  /**
   * Get current state
   */
  getState(): AutopilotState {
    return { ...this.state };
  }

  /**
   * Get status for UI pill
   */
  getStatusForUI(): { status: AutopilotStatus; color: 'red' | 'yellow' | 'green' } {
    const colorMap: Record<AutopilotStatus, 'red' | 'yellow' | 'green'> = {
      OFFLINE: 'red',
      LEARNING: 'yellow',
      READY: 'green'
    };

    return {
      status: this.state.status,
      color: colorMap[this.state.status]
    };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = {
      status: 'OFFLINE',
      surfaces: [],
      readiness: 0,
      lastMapTime: null,
      mapCount: 0
    };
    this.emitStatus();
  }

  private emitStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.state);
    }
  }
}

/**
 * Create autopilot broadcast message for Feed D
 */
export function createAutopilotBroadcast(state: AutopilotState): object {
  return {
    type: 'status',
    feed: 'D',
    autopilot: {
      status: state.status,
      readiness: state.readiness,
      surfaceCount: state.surfaces.length,
      readyFields: state.surfaces.filter(s => s.hasFillData).length
    }
  };
}
