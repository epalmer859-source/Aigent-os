// ============================================================
// src/engine/analytics/contract.ts
//
// ANALYTICS tRPC QUERIES — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Read-only aggregation queries over existing tables.
// No new tables required.
//
// Blueprint source: Doc 12 Part 5 (Analytics)
// ============================================================

// ── Date range ────────────────────────────────────────────────

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface AnalyticsParams {
  businessId: string;
  dateRange: DateRange;
}

// ── Metric shapes ─────────────────────────────────────────────

export interface ConversationMetrics {
  totalConversations: number;
  newLeads: number;
  convertedToBooked: number;
  closedLost: number;
  closedCompleted: number;
  /** Average ms from new_lead state to booked state. Null if no data. */
  avgTimeToBookingMs: number | null;
  /** Conversations with the repeat_customer tag. */
  reopenedCount: number;
}

export interface MessageMetrics {
  totalInbound: number;
  totalOutbound: number;
  totalAIResponses: number;
  totalAdminMessages: number;
  /** Average ms between inbound message and next AI outbound. Null if no data. */
  avgAIResponseTimeMs: number | null;
}

export interface AppointmentMetrics {
  totalBooked: number;
  totalCompleted: number;
  totalCanceled: number;
  totalNoShows: number;
  /** completed / (completed + canceled + noShows). 0 if no resolved appointments. */
  completionRate: number;
}

export interface QuoteMetrics {
  totalSent: number;
  totalAccepted: number;
  totalDeclined: number;
  totalExpired: number;
  /** accepted / (accepted + declined + expired). 0 if no resolved quotes. */
  acceptanceRate: number;
}

export interface OverviewMetrics {
  conversations: ConversationMetrics;
  messages: MessageMetrics;
  appointments: AppointmentMetrics;
  quotes: QuoteMetrics;
}

// ── Seed record shapes (minimal fields needed for aggregation) ─

export interface AnalyticsConversationRecord {
  id: string;
  businessId: string;
  primaryState: string;
  tags: string[];
  createdAt: Date;
  /** Timestamp when the conversation first reached 'booked' state. */
  bookedAt: Date | null;
}

export interface AnalyticsMessageRecord {
  id: string;
  businessId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  /** 'ai' | 'admin_team' | 'owner' | 'customer' */
  senderType: string;
  createdAt: Date;
}

export interface AnalyticsAppointmentRecord {
  id: string;
  businessId: string;
  /** 'booked' | 'completed' | 'canceled' | 'no_show' */
  status: string;
  createdAt: Date;
}

export interface AnalyticsQuoteRecord {
  id: string;
  businessId: string;
  /** 'sent' | 'accepted' | 'declined' | 'expired' */
  status: string;
  createdAt: Date;
}

// ── Function signatures ───────────────────────────────────────

export type GetOverviewMetricsFn = (
  params: AnalyticsParams,
) => Promise<OverviewMetrics>;

export type GetConversationMetricsFn = (
  params: AnalyticsParams,
) => Promise<ConversationMetrics>;

export type GetMessageMetricsFn = (
  params: AnalyticsParams,
) => Promise<MessageMetrics>;

export type GetAppointmentMetricsFn = (
  params: AnalyticsParams,
) => Promise<AppointmentMetrics>;

export type GetQuoteMetricsFn = (
  params: AnalyticsParams,
) => Promise<QuoteMetrics>;

// ── Constants ─────────────────────────────────────────────────

export const REPEAT_CUSTOMER_TAG = "repeat_customer";

export const BOOKED_STATES = ["booked", "job_in_progress", "job_completed"] as const;

export const CLOSED_STATES_ANALYTICS = ["closed_lost", "closed_completed"] as const;

export const ADMIN_SENDER_TYPES = ["admin_team", "owner"] as const;
