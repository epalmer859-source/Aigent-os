import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}
function todayAt(hhmm: string): Date {
  const d = new Date();
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h!, m!, 0, 0);
  return d;
}
function dateOnly(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function timeOnly(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

async function main() {
  console.log("🌱 Seeding database…\n");

  // ── Find first business ────────────────────────────────────────────────────
  const business = await prisma.businesses.findFirst({
    orderBy: { created_at: "asc" },
    select: { id: true, business_name: true },
  });

  if (!business) {
    console.error("❌ No business found. Run onboarding first.");
    process.exit(1);
  }
  console.log(`✅ Using business: "${business.business_name}" (${business.id})`);

  // ── Idempotency check ──────────────────────────────────────────────────────
  const existing = await prisma.customers.findFirst({
    where: { business_id: business.id, display_name: "Seed: Maria Garcia" },
  });
  if (existing) {
    console.log("ℹ️  Seed data already exists — skipping.");
    return;
  }

  // ── 1. Customers ──────────────────────────────────────────────────────────
  const customerData = [
    { name: "Seed: Maria Garcia", phone: "+15550001001" },
    { name: "Seed: James Thompson", phone: "+15550001002" },
    { name: "Seed: Priya Patel", phone: "+15550001003" },
    { name: "Seed: David Kim", phone: "+15550001004" },
    { name: "Seed: Sarah Mitchell", phone: "+15550001005" },
  ];

  const customers = await Promise.all(
    customerData.map(async (c) => {
      const customer = await prisma.customers.create({
        data: {
          business_id: business.id,
          display_name: c.name,
          consent_status: "implied_inbound",
        },
      });
      await prisma.customer_contacts.create({
        data: {
          business_id: business.id,
          customer_id: customer.id,
          contact_type: "phone",
          contact_value: c.phone,
          is_primary: true,
        },
      });
      return { ...customer, phone: c.phone };
    }),
  );
  console.log(`✅ Created ${customers.length} customers`);

  // ── 2. Conversations ──────────────────────────────────────────────────────
  const convDefs = [
    {
      customer: customers[0]!,
      state: "new_lead" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[1]!,
      state: "booking_in_progress" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[2]!,
      state: "quote_sent" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[3]!,
      state: "human_takeover_active" as const,
      owner: "human_takeover",
      prior: "booking_in_progress",
      takeover_at: daysAgo(1),
      takeover_exp: daysFromNow(7),
    },
    {
      customer: customers[4]!,
      state: "complaint_open" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[0]!,
      state: "job_in_progress" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[1]!,
      state: "resolved" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
    {
      customer: customers[2]!,
      state: "closed_completed" as const,
      owner: "ai",
      prior: null,
      takeover_at: null,
      takeover_exp: null,
    },
  ];

  const convs = await Promise.all(
    convDefs.map((def, i) =>
      prisma.conversations.create({
        data: {
          business_id: business.id,
          customer_id: def.customer.id,
          matter_key: `SEED-${i + 1}-${Date.now()}`,
          primary_state: def.state,
          prior_state: def.prior,
          current_owner: def.owner,
          contact_display_name: def.customer.display_name,
          contact_handle: def.customer.phone,
          channel: "sms",
          human_takeover_enabled_at: def.takeover_at,
          human_takeover_expires_at: def.takeover_exp,
          last_customer_message_at: daysAgo(i % 3 === 0 ? 1 : 0),
          updated_at: daysAgo(i * 0.1),
        },
      }),
    ),
  );
  console.log(`✅ Created ${convs.length} conversations`);

  // ── 3. Messages ───────────────────────────────────────────────────────────
  const messageSets: { direction: string; sender_type: string; content: string; offset: number }[][] = [
    // conv[0] new_lead
    [
      { direction: "inbound", sender_type: "customer", content: "Hi, I need my gutters cleaned asap", offset: 120 },
      { direction: "outbound", sender_type: "ai", content: "Hi! I'd be happy to help schedule a gutter cleaning. What's your address?", offset: 100 },
      { direction: "inbound", sender_type: "customer", content: "123 Oak Street, Springfield", offset: 80 },
      { direction: "outbound", sender_type: "ai", content: "Great! We have availability this week. Would Thursday or Friday work for you?", offset: 60 },
    ],
    // conv[1] booking_in_progress
    [
      { direction: "inbound", sender_type: "customer", content: "I'd like to schedule a lawn mowing", offset: 200 },
      { direction: "outbound", sender_type: "ai", content: "Sure! We can get that booked. How large is your lawn approximately?", offset: 180 },
      { direction: "inbound", sender_type: "customer", content: "About 1/4 acre, front and back", offset: 160 },
      { direction: "outbound", sender_type: "ai", content: "Perfect. We charge $85 for that size. Does tomorrow at 2pm work?", offset: 140 },
      { direction: "inbound", sender_type: "customer", content: "Yes that works great!", offset: 30 },
    ],
    // conv[2] quote_sent
    [
      { direction: "inbound", sender_type: "customer", content: "Can I get a quote for pressure washing my driveway?", offset: 300 },
      { direction: "outbound", sender_type: "ai", content: "Absolutely! For a standard driveway, our price is typically $150-200. I'll have someone review and send a formal quote.", offset: 280 },
      { direction: "inbound", sender_type: "customer", content: "Sounds good, what's included?", offset: 260 },
      { direction: "outbound", sender_type: "ai", content: "The quote includes full driveway, walkways, and front steps. Quote has been sent to your phone.", offset: 48 },
    ],
    // conv[3] human_takeover
    [
      { direction: "inbound", sender_type: "customer", content: "I need to reschedule my appointment urgently", offset: 250 },
      { direction: "outbound", sender_type: "ai", content: "I understand. Let me look up your booking. Can you confirm your address?", offset: 240 },
      { direction: "inbound", sender_type: "customer", content: "456 Elm Ave. I need to talk to a real person", offset: 230 },
      { direction: "outbound", sender_type: "system", content: "Human takeover enabled", offset: 28 },
      { direction: "outbound", sender_type: "owner", content: "Hi, this is the owner. How can I help you reschedule?", offset: 26 },
    ],
    // conv[4] complaint_open
    [
      { direction: "inbound", sender_type: "customer", content: "Your tech left a mess in my backyard. This is unacceptable!", offset: 400 },
      { direction: "outbound", sender_type: "ai", content: "I sincerely apologize for this. This is not our standard. I'm escalating this immediately.", offset: 380 },
      { direction: "inbound", sender_type: "customer", content: "I want a full refund", offset: 360 },
      { direction: "outbound", sender_type: "ai", content: "I completely understand. I've flagged this for our owner to review. You'll hear back within the hour.", offset: 12 },
    ],
    // conv[5] job_in_progress
    [
      { direction: "inbound", sender_type: "customer", content: "Is the tech on the way?", offset: 50 },
      { direction: "outbound", sender_type: "ai", content: "Yes! Mike is en route and should arrive in about 20 minutes.", offset: 45 },
      { direction: "inbound", sender_type: "customer", content: "Great, I'll leave the side gate open", offset: 40 },
    ],
    // conv[6] resolved
    [
      { direction: "inbound", sender_type: "customer", content: "Just wanted to say the service was excellent!", offset: 1440 },
      { direction: "outbound", sender_type: "ai", content: "Thank you so much! We're glad to hear it. Would you mind leaving us a review?", offset: 1420 },
      { direction: "inbound", sender_type: "customer", content: "Already did! 5 stars", offset: 1400 },
    ],
    // conv[7] closed_completed
    [
      { direction: "inbound", sender_type: "customer", content: "All paid up, thanks for the quick work", offset: 2880 },
      { direction: "outbound", sender_type: "ai", content: "Thank you for choosing us! We hope to see you again. Have a great day!", offset: 2860 },
    ],
  ];

  let msgCount = 0;
  for (let i = 0; i < convs.length; i++) {
    const conv = convs[i]!;
    const msgs = messageSets[i] ?? [];
    for (const msg of msgs) {
      await prisma.message_log.create({
        data: {
          business_id: business.id,
          conversation_id: conv.id,
          direction: msg.direction,
          channel: "sms",
          sender_type: msg.sender_type,
          content: msg.content,
          created_at: new Date(Date.now() - msg.offset * 60_000),
        },
      });
      msgCount++;
    }
    // Update last_customer_message_at to most recent inbound
    const lastInbound = msgs.filter((m) => m.direction === "inbound").sort((a, b) => a.offset - b.offset)[0];
    if (lastInbound) {
      await prisma.conversations.update({
        where: { id: conv.id },
        data: { last_customer_message_at: new Date(Date.now() - lastInbound.offset * 60_000) },
      });
    }
  }
  console.log(`✅ Created ${msgCount} messages`);

  // ── 4. Escalations ────────────────────────────────────────────────────────
  await prisma.escalations.create({
    data: {
      business_id: business.id,
      conversation_id: convs[4]!.id, // complaint_open
      customer_id: convs[4]!.customer_id,
      category: "complaint",
      status: "open",
      urgency: "high",
      ai_summary: "Customer is upset about technician leaving a mess. Requesting full refund.",
      created_at: daysAgo(0.3),
    },
  });
  await prisma.escalations.create({
    data: {
      business_id: business.id,
      conversation_id: convs[2]!.id, // quote_sent
      customer_id: convs[2]!.customer_id,
      category: "billing_dispute",
      status: "in_progress",
      urgency: "standard",
      ai_summary: "Customer questioning pricing on pressure washing quote.",
      created_at: daysAgo(2),
    },
  });
  console.log("✅ Created 2 escalations");

  // ── 5. Quotes ─────────────────────────────────────────────────────────────
  await prisma.quotes.create({
    data: {
      business_id: business.id,
      conversation_id: convs[1]!.id,
      customer_id: convs[1]!.customer_id,
      status: "under_review",
      requested_service: "Gutter cleaning - full house",
      quote_details: "Two-story home, approx 180 linear feet of gutters. Includes downspout flush.",
      created_at: daysAgo(1),
    },
  });
  await prisma.quotes.create({
    data: {
      business_id: business.id,
      conversation_id: convs[2]!.id,
      customer_id: convs[2]!.customer_id,
      status: "sent",
      requested_service: "Pressure washing - driveway and walkways",
      approved_amount: 350.0,
      sent_at: daysAgo(2),
      expires_at: daysFromNow(12),
      created_at: daysAgo(3),
    },
  });
  console.log("✅ Created 2 quotes");

  // ── 6. Appointments ───────────────────────────────────────────────────────
  await prisma.appointments.create({
    data: {
      business_id: business.id,
      conversation_id: convs[1]!.id,
      customer_id: convs[1]!.customer_id,
      service_type: "Lawn Mowing",
      appointment_date: dateOnly(new Date()),
      appointment_time: timeOnly("10:00"),
      duration_minutes: 60,
      status: "booked",
      technician_name: "Mike Torres",
      address: "456 Elm Ave, Springfield",
    },
  });
  await prisma.appointments.create({
    data: {
      business_id: business.id,
      conversation_id: convs[0]!.id,
      customer_id: convs[0]!.customer_id,
      service_type: "Gutter Cleaning",
      appointment_date: dateOnly(daysFromNow(1)),
      appointment_time: timeOnly("14:00"),
      duration_minutes: 90,
      status: "booked",
      technician_name: "Sarah Lee",
      address: "123 Oak Street, Springfield",
    },
  });
  await prisma.appointments.create({
    data: {
      business_id: business.id,
      conversation_id: convs[6]!.id,
      customer_id: convs[6]!.customer_id,
      service_type: "Window Cleaning",
      appointment_date: dateOnly(daysAgo(1)),
      appointment_time: timeOnly("09:00"),
      duration_minutes: 120,
      status: "completed",
      completed_at: daysAgo(0.5),
      address: "789 Maple Dr, Springfield",
    },
  });
  console.log("✅ Created 3 appointments");

  // ── 7. Approval requests ──────────────────────────────────────────────────
  await prisma.approval_requests.create({
    data: {
      business_id: business.id,
      conversation_id: convs[3]!.id,
      customer_id: convs[3]!.customer_id,
      request_type: "large_job_approval",
      status: "pending",
      ai_summary: "Customer wants full exterior cleaning package: gutters, pressure wash, windows. Total estimated $850.",
      created_at: daysAgo(0.5),
    },
  });
  await prisma.approval_requests.create({
    data: {
      business_id: business.id,
      conversation_id: convs[0]!.id,
      customer_id: convs[0]!.customer_id,
      request_type: "custom_pricing",
      status: "approved",
      ai_summary: "Senior discount applied — 15% off standard rate for customer over 65.",
      admin_notes: "Approved by owner. Valid for this job only.",
      decided_at: daysAgo(1),
      created_at: daysAgo(2),
    },
  });
  console.log("✅ Created 2 approval requests");

  // ── Service Estimates (HVAC 60 defaults) ──────────────────────────────────
  const existingEstimates = await prisma.service_estimates.findFirst({
    where: { business_id: business.id },
  });
  if (!existingEstimates) {
    const { ALL_DEFAULT_SERVICES } = await import("../src/engine/scheduling/hvac-service-defaults.js");
    await prisma.service_estimates.createMany({
      data: ALL_DEFAULT_SERVICES.map((s: { name: string; category: string; estimatedMinutes: number; tier: string }) => ({
        business_id: business.id,
        name: s.name,
        category: s.category,
        estimated_minutes: s.estimatedMinutes,
        is_active: true, // All 60 active for testing
        is_default: true,
        tier: s.tier,
      })),
    });
    console.log("✅ Created 60 HVAC service estimates");
  } else {
    console.log("ℹ️  Service estimates already exist — skipping.");
  }

  console.log("\n🎉 Seed complete! All test data created.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
