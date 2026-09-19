/**
 * Reusable domain state machine (spec section 6).
 *
 * Deliberately tiny and dependency-free so it can run in the API, the worker and
 * the browser. Transitions are data, not code, which makes them diffable and
 * testable, and lets the UI render the legal next moves without duplicating rules.
 */

export interface StateMachineDefinition<TState extends string> {
  name: string;
  initial: TState;
  terminal: readonly TState[];
  transitions: Readonly<Record<TState, readonly TState[]>>;
}

export class InvalidTransitionError extends Error {
  readonly code = 'TASK_INVALID_TRANSITION';

  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
    public readonly allowed: readonly string[],
  ) {
    super(
      `${machine} cannot move from ${from} to ${to}. Allowed: ${allowed.length > 0 ? allowed.join(', ') : '(none — terminal state)'}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

export class StateMachine<TState extends string> {
  constructor(readonly definition: StateMachineDefinition<TState>) {}

  get initial(): TState {
    return this.definition.initial;
  }

  states(): TState[] {
    return Object.keys(this.definition.transitions) as TState[];
  }

  isTerminal(state: TState): boolean {
    return this.definition.terminal.includes(state);
  }

  nextStates(from: TState): readonly TState[] {
    return this.definition.transitions[from] ?? [];
  }

  can(from: TState, to: TState): boolean {
    if (from === to) return false;
    return this.nextStates(from).includes(to);
  }

  assert(from: TState, to: TState): void {
    if (!this.can(from, to)) {
      throw new InvalidTransitionError(this.definition.name, from, to, this.nextStates(from));
    }
  }

  /** Shortest legal path between two states, or null when unreachable. */
  path(from: TState, to: TState): TState[] | null {
    if (from === to) return [from];
    const queue: TState[][] = [[from]];
    const seen = new Set<TState>([from]);

    while (queue.length > 0) {
      const trail = queue.shift();
      if (!trail) break;
      const tail = trail[trail.length - 1];
      if (tail === undefined) continue;
      for (const candidate of this.nextStates(tail)) {
        if (seen.has(candidate)) continue;
        const nextTrail = [...trail, candidate];
        if (candidate === to) return nextTrail;
        seen.add(candidate);
        queue.push(nextTrail);
      }
    }
    return null;
  }

  /** Detects states that can never be left — useful as a definition sanity test. */
  deadEnds(): TState[] {
    return this.states().filter(
      (state) => !this.isTerminal(state) && this.nextStates(state).length === 0,
    );
  }
}
