// In-memory state store — replaces Firestore for the POC.
// All state is lost on server restart, which is fine for a demo.

import { ConversationTurn } from "./llm";

export type TicketStatus =
  | "checking_claude_md"
  | "claude_md_missing"
  | "analysing"
  | "awaiting_answers"
  | "processing_answer"
  | "summarised";

export interface TicketState {
  ticketId: string;
  title: string;
  description: string;
  url: string;
  status: TicketStatus;
  claudeMdContent?: string;
  conversationLog: ConversationTurn[];
  createdAt: Date;
  updatedAt: Date;
}

const store = new Map<string, TicketState>();

export const State = {
  get(ticketId: string): TicketState | undefined {
    return store.get(ticketId);
  },

  set(ticketId: string, state: TicketState): void {
    state.updatedAt = new Date();
    store.set(ticketId, state);
    console.log(`[State] ${ticketId} → ${state.status}`);
  },

  has(ticketId: string): boolean {
    return store.has(ticketId);
  },

  transition(ticketId: string, status: TicketStatus, patch?: Partial<TicketState>): void {
    const existing = store.get(ticketId);
    if (!existing) throw new Error(`Unknown ticket: ${ticketId}`);
    State.set(ticketId, { ...existing, ...patch, status, updatedAt: new Date() });
  },
};
