import type { Project } from './project.ts';

/**
 * Command-based canvas history. This is a FlowForge design: the target never
 * confirmed a canvas command stack (its redo is unknown, FF-OBS-002 SC-06), so
 * nothing here may be described as aligned behaviour. Text fields keep their
 * native undo; only canvas commands are recorded here.
 */
export type CommandKind = 'create' | 'move' | 'edit' | 'edge' | 'copy' | 'delete' | 'snapshot';

export type Command = Readonly<{ kind: CommandKind; key?: string }>;

/** Designed lower bound: the brief asks for at least 50 steps; we keep 100. */
export const HISTORY_LIMIT = 100;
const MOVE_WINDOW_MS = 600;
const EDIT_WINDOW_MS = 900;

export type History = { past: Project[]; future: Project[]; last: (Command & { at: number }) | null };

export function createHistory(): History {
  return { past: [], future: [], last: null };
}

function coalesces(history: History, command: Command, now: number): boolean {
  const last = history.last;
  if (!last || last.kind !== command.kind) return false;
  if (command.kind === 'move') return now - last.at <= MOVE_WINDOW_MS;
  if (command.kind === 'edit') return !!command.key && last.key === command.key && now - last.at <= EDIT_WINDOW_MS;
  return false;
}

/** Records the project state that preceded a command. */
export function record(history: History, previous: Project, command: Command, now = Date.now()): History {
  if (!coalesces(history, command, now)) {
    history.past.push(previous);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
  }
  history.future = [];
  history.last = { ...command, at: now };
  return history;
}

/** A new drag starts a new history step even if the previous one just ended. */
export function breakRun(history: History): History {
  history.last = null;
  return history;
}

export function undo(history: History, current: Project): Project | null {
  const previous = history.past.pop();
  if (!previous) return null;
  history.future.push(current);
  history.last = null;
  return previous;
}

export function redo(history: History, current: Project): Project | null {
  const next = history.future.pop();
  if (!next) return null;
  history.past.push(current);
  history.last = null;
  return next;
}

export function depth(history: History): { back: number; forward: number } {
  return { back: history.past.length, forward: history.future.length };
}
