/**
 * State Machine - Controls overlay workflow states
 *
 * States:
 * - idle: No recording, waiting for user action
 * - connecting: Establishing WebSocket connection
 * - recording: Actively capturing audio
 * - mapping: Scanning DOM for fields
 * - filling: Executing Smart Fill steps
 * - reviewing: User reviewing filled data
 * - done: Session complete
 * - error: Error state requiring user action
 */

export type OverlayState =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'mapping'
  | 'filling'
  | 'reviewing'
  | 'done'
  | 'error';

export type StateTransition =
  | 'CONNECT'
  | 'CONNECTED'
  | 'START_RECORD'
  | 'STOP_RECORD'
  | 'START_MAP'
  | 'MAP_COMPLETE'
  | 'START_FILL'
  | 'FILL_COMPLETE'
  | 'CONFIRM'
  | 'UNDO'
  | 'RESET'
  | 'ERROR'
  | 'DISMISS_ERROR';

export interface StateContext {
  state: OverlayState;
  previousState: OverlayState | null;
  error: string | null;
  transcriptId: number | null;
  patientCode: string | null;
  fieldsCount: number;
  filledCount: number;
  autopilotStatus: 'red' | 'yellow' | 'green';
  lastTransition: StateTransition | null;
  timestamp: number;
}

// Valid state transitions
const transitions: Record<OverlayState, Partial<Record<StateTransition, OverlayState>>> = {
  idle: {
    CONNECT: 'connecting',
    START_RECORD: 'connecting', // Auto-connect if not connected
    ERROR: 'error'
  },
  connecting: {
    CONNECTED: 'idle',
    START_RECORD: 'recording',
    ERROR: 'error'
  },
  recording: {
    STOP_RECORD: 'idle',
    START_MAP: 'mapping',
    ERROR: 'error'
  },
  mapping: {
    MAP_COMPLETE: 'recording',
    START_FILL: 'filling',
    STOP_RECORD: 'idle',
    ERROR: 'error'
  },
  filling: {
    FILL_COMPLETE: 'reviewing',
    UNDO: 'mapping',
    ERROR: 'error'
  },
  reviewing: {
    CONFIRM: 'done',
    UNDO: 'mapping',
    START_FILL: 'filling',
    ERROR: 'error'
  },
  done: {
    RESET: 'idle',
    START_RECORD: 'recording'
  },
  error: {
    DISMISS_ERROR: 'idle',
    RESET: 'idle'
  }
};

type StateListener = (context: StateContext) => void;

export class StateMachine {
  private context: StateContext;
  private listeners: Set<StateListener> = new Set();

  constructor() {
    this.context = this.getInitialContext();
  }

  private getInitialContext(): StateContext {
    return {
      state: 'idle',
      previousState: null,
      error: null,
      transcriptId: null,
      patientCode: null,
      fieldsCount: 0,
      filledCount: 0,
      autopilotStatus: 'red',
      lastTransition: null,
      timestamp: Date.now()
    };
  }

  /**
   * Attempt a state transition
   */
  transition(action: StateTransition, payload?: Partial<StateContext>): boolean {
    const currentState = this.context.state;
    const validTransitions = transitions[currentState];
    const nextState = validTransitions[action];

    if (!nextState) {
      console.warn(`[StateMachine] Invalid transition: ${currentState} -> ${action}`);
      return false;
    }

    // Update context
    this.context = {
      ...this.context,
      ...payload,
      previousState: currentState,
      state: nextState,
      lastTransition: action,
      timestamp: Date.now()
    };

    // Clear error if not error state
    if (nextState !== 'error') {
      this.context.error = null;
    }

    console.log(`[StateMachine] ${currentState} -> ${action} -> ${nextState}`);
    this.notify();

    return true;
  }

  /**
   * Set error and transition to error state
   */
  setError(error: string): void {
    this.transition('ERROR', { error });
  }

  /**
   * Update context without state change
   */
  updateContext(payload: Partial<StateContext>): void {
    this.context = {
      ...this.context,
      ...payload,
      timestamp: Date.now()
    };
    this.notify();
  }

  /**
   * Get current context
   */
  getContext(): StateContext {
    return { ...this.context };
  }

  /**
   * Get current state
   */
  getState(): OverlayState {
    return this.context.state;
  }

  /**
   * Check if action is valid from current state
   */
  canTransition(action: StateTransition): boolean {
    const validTransitions = transitions[this.context.state];
    return action in validTransitions;
  }

  /**
   * Get all valid actions from current state
   */
  getValidActions(): StateTransition[] {
    const validTransitions = transitions[this.context.state];
    return Object.keys(validTransitions) as StateTransition[];
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.context = this.getInitialContext();
    this.notify();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  private notify(): void {
    this.listeners.forEach(listener => listener(this.context));
  }

  /**
   * Check if in a specific state
   */
  isState(state: OverlayState): boolean {
    return this.context.state === state;
  }

  /**
   * Check if recording
   */
  isRecording(): boolean {
    return this.context.state === 'recording' || this.context.state === 'mapping';
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.context.state !== 'idle' && this.context.state !== 'error';
  }

  /**
   * Get state display info
   */
  getDisplayInfo(): { label: string; color: string; icon: string } {
    const stateInfo: Record<OverlayState, { label: string; color: string; icon: string }> = {
      idle: { label: 'Ready', color: '#6b7280', icon: '⏸' },
      connecting: { label: 'Connecting...', color: '#f59e0b', icon: '🔄' },
      recording: { label: 'Recording', color: '#ef4444', icon: '🔴' },
      mapping: { label: 'Mapping Fields', color: '#3b82f6', icon: '🔍' },
      filling: { label: 'Auto-Filling', color: '#8b5cf6', icon: '✍️' },
      reviewing: { label: 'Review', color: '#10b981', icon: '👁' },
      done: { label: 'Complete', color: '#22c55e', icon: '✅' },
      error: { label: 'Error', color: '#ef4444', icon: '⚠️' }
    };

    return stateInfo[this.context.state];
  }
}

// Singleton instance
export const stateMachine = new StateMachine();
