/**
 * State Machine - Workflow State Management
 *
 * Manages the overlay's workflow states:
 * idle → connecting → recording → mapping → filling → reviewing → done
 *
 * Each state transition is validated and triggers appropriate UI updates.
 */

export type OverlayStateType =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'mapping'
  | 'filling'
  | 'reviewing'
  | 'done'
  | 'error';

export type StateEvent =
  | 'CONNECT'
  | 'CONNECTED'
  | 'CONNECTION_FAILED'
  | 'START_RECORD'
  | 'STOP_RECORD'
  | 'START_MAP'
  | 'MAP_COMPLETE'
  | 'START_FILL'
  | 'FILL_COMPLETE'
  | 'CONFIRM'
  | 'UNDO'
  | 'RESET'
  | 'DISMISS_ERROR';

export interface StateContext {
  transcriptId: number | null;
  tabId: string | null;
  patientCode: string | null;
  error: string | null;
  lastEvent: StateEvent | null;
  timestamp: number;
}

export interface StateTransition {
  from: OverlayStateType;
  event: StateEvent;
  to: OverlayStateType;
  guard?: (context: StateContext) => boolean;
}

type StateChangeCallback = (
  prevState: OverlayStateType,
  newState: OverlayStateType,
  event: StateEvent,
  context: StateContext
) => void;

export class StateMachine {
  private currentState: OverlayStateType = 'idle';
  private context: StateContext;
  private transitions: StateTransition[];
  private listeners: StateChangeCallback[] = [];

  constructor() {
    this.context = this.getInitialContext();
    this.transitions = this.defineTransitions();
  }

  private getInitialContext(): StateContext {
    return {
      transcriptId: null,
      tabId: null,
      patientCode: null,
      error: null,
      lastEvent: null,
      timestamp: Date.now()
    };
  }

  private defineTransitions(): StateTransition[] {
    return [
      // Connection
      { from: 'idle', event: 'CONNECT', to: 'connecting' },
      { from: 'connecting', event: 'CONNECTED', to: 'idle' },
      { from: 'connecting', event: 'CONNECTION_FAILED', to: 'error' },

      // Recording
      { from: 'idle', event: 'START_RECORD', to: 'recording' },
      { from: 'recording', event: 'STOP_RECORD', to: 'idle' },

      // Mapping (from recording)
      { from: 'recording', event: 'START_MAP', to: 'mapping' },
      { from: 'mapping', event: 'MAP_COMPLETE', to: 'recording' },

      // Filling (from recording)
      { from: 'recording', event: 'START_FILL', to: 'filling' },
      { from: 'filling', event: 'FILL_COMPLETE', to: 'reviewing' },
      { from: 'filling', event: 'UNDO', to: 'mapping' },

      // Reviewing
      { from: 'reviewing', event: 'CONFIRM', to: 'done' },
      { from: 'reviewing', event: 'UNDO', to: 'mapping' },

      // Done
      { from: 'done', event: 'RESET', to: 'idle' },

      // Error handling
      { from: 'error', event: 'DISMISS_ERROR', to: 'idle' },
      { from: 'error', event: 'RESET', to: 'idle' },

      // Reset from any state
      { from: 'recording', event: 'RESET', to: 'idle' },
      { from: 'mapping', event: 'RESET', to: 'idle' },
      { from: 'filling', event: 'RESET', to: 'idle' },
      { from: 'reviewing', event: 'RESET', to: 'idle' }
    ];
  }

  /**
   * Send an event to transition the state machine
   */
  send(event: StateEvent, payload?: Partial<StateContext>): boolean {
    const transition = this.findTransition(event);

    if (!transition) {
      console.warn(`[StateMachine] No transition from '${this.currentState}' on event '${event}'`);
      return false;
    }

    // Check guard condition if present
    if (transition.guard && !transition.guard(this.context)) {
      console.warn(`[StateMachine] Guard condition failed for '${event}'`);
      return false;
    }

    const prevState = this.currentState;
    this.currentState = transition.to;

    // Update context
    this.context = {
      ...this.context,
      ...payload,
      lastEvent: event,
      timestamp: Date.now()
    };

    console.log(`[StateMachine] ${prevState} -> ${this.currentState} (${event})`);

    // Notify listeners
    this.notifyListeners(prevState, this.currentState, event);

    return true;
  }

  /**
   * Find a valid transition for the current state and event
   */
  private findTransition(event: StateEvent): StateTransition | undefined {
    return this.transitions.find(
      t => t.from === this.currentState && t.event === event
    );
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(
    prevState: OverlayStateType,
    newState: OverlayStateType,
    event: StateEvent
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(prevState, newState, event, this.context);
      } catch (error) {
        console.error('[StateMachine] Listener error:', error);
      }
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get current state
   */
  getState(): OverlayStateType {
    return this.currentState;
  }

  /**
   * Get current context
   */
  getContext(): StateContext {
    return { ...this.context };
  }

  /**
   * Check if a specific event can be sent from current state
   */
  canSend(event: StateEvent): boolean {
    const transition = this.findTransition(event);
    if (!transition) return false;
    if (transition.guard && !transition.guard(this.context)) return false;
    return true;
  }

  /**
   * Get available events from current state
   */
  getAvailableEvents(): StateEvent[] {
    return this.transitions
      .filter(t => t.from === this.currentState)
      .filter(t => !t.guard || t.guard(this.context))
      .map(t => t.event);
  }

  /**
   * Set error state with message
   */
  setError(error: string): void {
    const prevState = this.currentState;
    this.currentState = 'error';
    this.context = {
      ...this.context,
      error,
      timestamp: Date.now()
    };
    this.notifyListeners(prevState, 'error', 'CONNECTION_FAILED');
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    const prevState = this.currentState;
    this.currentState = 'idle';
    this.context = this.getInitialContext();
    this.notifyListeners(prevState, 'idle', 'RESET');
  }

  /**
   * Check if in recording state
   */
  isRecording(): boolean {
    return ['recording', 'mapping', 'filling'].includes(this.currentState);
  }

  /**
   * Check if in a state where commands can be issued
   */
  canIssueCommands(): boolean {
    return ['recording', 'mapping', 'reviewing'].includes(this.currentState);
  }
}

// Export singleton instance
export const stateMachine = new StateMachine();
