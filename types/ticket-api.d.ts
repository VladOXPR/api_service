/**
 * Contract for CUUB maintenance `/tickets` API (Postgres `ticket_task` enum[]).
 * For TypeScript clients; this repo’s server is JavaScript.
 */

export type TicketTask =
  | 'High Batteries'
  | 'Low Batteries'
  | 'No Batteries'
  | 'Add Stack'
  | 'Broken Battery'
  | 'High Failure Rates'
  | 'Hardware Malfunction'
  | 'Unusually Offline'
  | 'Urgent Other'
  | 'Other';

export interface Ticket {
  id: number;
  location_name: string;
  station_id: string;
  latitude: number;
  longitude: number;
  created_at: string;
  /** Postgres `ticket_task[]`; always treat as array in UI (multi-select, render all). */
  task: TicketTask[];
  description: string | null;
}

export interface TicketsListResponse {
  success: true;
  data: Ticket[];
  count: number;
}

export interface TicketOneResponse {
  success: true;
  data: Ticket;
}

export interface CreateTicketBody {
  location_name: string;
  station_id: string;
  latitude: number;
  longitude: number;
  /** Prefer a non-empty array; legacy APIs may send a single `TicketTask` string. */
  task: TicketTask[] | TicketTask;
  description?: string | null;
}

export interface PatchTicketBody {
  location_name?: string;
  station_id?: string;
  latitude?: number;
  longitude?: number;
  /** Replaces the entire task list; must be non-empty when present. */
  task?: TicketTask[] | TicketTask;
  description?: string | null;
}
