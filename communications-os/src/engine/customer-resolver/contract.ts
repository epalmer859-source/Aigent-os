// ============================================================
// src/engine/customer-resolver/contract.ts
//
// CUSTOMER IDENTITY RESOLVER — CONTRACT
//
// Exports ONLY types and function signatures. Zero implementation.
//
// Rules:
//   - contact_type values: "phone" | "email" (extensible)
//   - Phone normalization target: E.164 (+1XXXXXXXXXX for US)
//   - Email normalization: lowercase trim
//   - Lookup key: (business_id, contact_type, contact_value) — unique
//   - New customer: consent_status = "implied_inbound", doNotContact = false
//   - do_not_contact = true → resolve customer, return null conversation
//   - Closed conversation + same contact → NEW conversation, isReopened = true
//   - New conversation after prior closed → add repeat_customer tag (source = "system")
//   - New conversation primary_state is always "new_lead"
// ============================================================

// ── Scalar types ─────────────────────────────────────────────

export type ConsentStatus = "implied_inbound" | "opted_out" | "resubscribed";

export type TagSource = "detector" | "ai" | "admin_team" | "owner" | "system";

// ── Result sub-types ─────────────────────────────────────────

/**
 * Resolved customer record. `isNew` is true when the customer was
 * created during this resolve call (first ever contact for this
 * business_id + contact combination).
 */
export interface CustomerResolved {
  id: string;
  businessId: string;
  displayName: string | null;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  aiDisclosureSentAt: Date | null;
  isNew: boolean;
  createdAt: Date;
}

/**
 * Resolved (or newly created) conversation. `isReopened` is true when
 * this conversation was created for a customer who had at least one
 * prior closed conversation — i.e., a returning customer.
 *
 * Null when the customer has do_not_contact = true.
 */
export interface ConversationResolved {
  id: string;
  businessId: string;
  customerId: string;
  matterKey: string;
  primaryState: string;
  currentOwner: string;
  channel: string;
  contactHandle: string;
  contactDisplayName: string | null;
  isReopened: boolean;
  createdAt: Date;
}

// ── Top-level result ─────────────────────────────────────────

export interface ResolveResult {
  customer: CustomerResolved;
  /** Null only when customer.doNotContact = true. */
  conversation: ConversationResolved | null;
}

// ── Normalization result ─────────────────────────────────────

/**
 * Result of normalizing a raw contact value.
 *
 * - `contactValue`: the normalized form stored in customer_contacts.
 * - `original`: the raw string passed in, unchanged.
 * - `isValid`: false if the value cannot be normalized to a usable form.
 */
export interface NormalizeContactResult {
  contactType: string;
  contactValue: string;
  isValid: boolean;
  original: string;
}

// ── Input type ───────────────────────────────────────────────

export interface ResolveCustomerInput {
  businessId: string;
  /** "phone" | "email" */
  contactType: string;
  /** Raw value — will be normalized internally before lookup/store. */
  contactValue: string;
  /** "sms" | "voice" | "email" | "web_chat" */
  channel: string;
  contactDisplayName?: string;
}

// ── Function signatures ──────────────────────────────────────

/**
 * Resolve or create a customer record and conversation from a raw
 * inbound contact.
 *
 * Lookup path:
 *   1. Normalize contactValue.
 *   2. Look up customer_contacts by (businessId, contactType, normalizedValue).
 *   3a. Not found → create customer + contact + conversation → isNew = true.
 *   3b. Found + doNotContact = true → return customer, conversation = null.
 *   3c. Found + active conversation exists → return existing conversation.
 *   3d. Found + no active conversation → create new conversation.
 *       If prior closed conversation exists → isReopened = true + repeat_customer tag.
 */
export type ResolveCustomerFn = (input: ResolveCustomerInput) => Promise<ResolveResult>;

/**
 * Normalize a raw contact value to its canonical stored form.
 *
 * Phone: strips formatting, prepends country code, returns E.164.
 * Email: trims and lowercases.
 *
 * Returns isValid = false if the value cannot be made canonical.
 */
export type NormalizeContactFn = (
  contactType: string,
  contactValue: string,
) => NormalizeContactResult;
