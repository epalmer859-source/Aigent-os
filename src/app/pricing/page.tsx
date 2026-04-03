import Link from "next/link";
import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";
import { AnimateSection } from "../_components/animate-section";
import { FaqAccordion } from "./_components/faq-accordion";

const PRICING_ITEMS = [
  "Dedicated business phone number",
  "Unlimited AI conversations",
  "Appointment scheduling + reminders",
  "Quote management + approval flow + follow-up",
  "Urgent routing + escalation handling",
  "Complaint detection and structured handling",
  "Full admin dashboard — all 8 departments",
  "Complete documentation of every workflow event",
  "24/7 coverage — nights, weekends, holidays",
  "All 21 service industries supported",
];

const FAQ_ITEMS = [
  {
    question: "Is this just a chatbot?",
    answer:
      "No. A chatbot guesses. AIgent OS operates within a defined rulebook — your services, your hours, your policies, your tone — and follows structured logic for every scenario. It schedules appointments, manages quotes through an approval flow, handles follow-up at defined intervals, detects complaints and urgent situations, and escalates with full context when needed. Every action is logged. Every workflow stays visible. That is not a chatbot.",
  },
  {
    question: "Do I lose control of my customer communication?",
    answer:
      "You are not giving up control. You are gaining a system that makes control possible at scale. You define every rule the system follows. Quotes require your approval before they reach any customer. You can take over any conversation instantly. You see every message, every status change, and every action the system has taken — in real time, in full.",
  },
  {
    question: "What if I want to step in myself?",
    answer:
      "One action. You open the conversation, step in, and the system recognizes the takeover and hands it off cleanly. The full thread history is in front of you so you are not starting blind. The takeover event is logged — who stepped in, when, and what followed.",
  },
  {
    question: "Can this work for my type of business?",
    answer:
      "Built for 21 service industries — plumbing, HVAC, electrical, cleaning, landscaping, pest control, roofing, painting, appliance repair, and more. If your business runs on service calls, appointments, and customer communication, the system was built around how your operations actually work.",
  },
  {
    question: "How customized is it to my business?",
    answer:
      "23 onboarding questions configure the system to your exact business — your services, your pricing structure, your service area, your hours, how you want urgent situations handled, what the AI can and cannot commit to, and more. The system operates from your rulebook, not a generic template. Every setting is visible and adjustable at any time.",
  },
  {
    question: "What happens with complaints or urgent situations?",
    answer:
      "Complaints, legal language, safety concerns, and escalation triggers are detected automatically and surfaced in the Urgent section immediately — with the full conversation attached. The system does not attempt to resolve these autonomously. It identifies them, isolates them, and routes them to your team with full context so a human makes the call.",
  },
  {
    question: "What if my business already has office staff?",
    answer:
      "The system supports them, not replaces them. Staff can focus on complex situations, customer relationships, and high-judgment calls while the system handles routine scheduling, quote follow-up, reminders, after-hours coverage, and documentation. Every thread your team steps into has a complete history already built.",
  },
  {
    question: "How hard is setup?",
    answer:
      "Ten minutes. Answer the 23 onboarding questions, get your dedicated business number, and the system is live. No developers. No integrations to build. No training beyond knowing how your own business works. The initial configuration populates from your answers and takes effect immediately.",
  },
  {
    question: "What if I am not tech-savvy?",
    answer:
      "If you can read a text message, you can use this. The dashboard is a conversation view organized into departments. The settings are a list of your business rules. There is nothing to configure beyond what you already know about your own operation. The system runs itself — you just stay visible to it.",
  },
  {
    question: "What gets documented and tracked?",
    answer:
      "Every major conversation, status change, approval, escalation, and workflow movement remains visible inside the system. Complete thread logs with timestamps. Quote stage history. Approval and denial records. Escalation triggers and resolution paths. Booking history. Follow-up logs. Every action the system takes on your behalf is traceable — not summarized, not archived away, accessible in full.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-50">
      <MarketingNav />

      {/* ── HERO ────────────────────────────────────────────── */}
      <section className="relative pt-40 pb-24 px-6 text-center overflow-hidden">
        <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[400px] rounded-full bg-blue-500/8 blur-[100px]" />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto">
          <AnimateSection>
            <p className="text-sm uppercase tracking-widest text-zinc-500 mb-6">Pricing</p>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Simple pricing for serious businesses.
            </h1>
            <p className="text-xl text-zinc-400 leading-relaxed mb-4">
              One plan. Every department. Full documentation. Full control.
            </p>
            <p className="text-base text-zinc-500">
              Every major workflow stays visible, reviewable, and documented.
            </p>
          </AnimateSection>
        </div>
      </section>

      {/* ── PRICING CARD ────────────────────────────────────── */}
      <section className="pb-24 px-6">
        <div className="max-w-xl mx-auto">
          <AnimateSection>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10">
              <p className="text-6xl font-bold text-zinc-50 mb-1">
                $XXX
                <span className="text-3xl text-zinc-400 font-normal">/mo</span>
              </p>
              <p className="text-zinc-500 mb-10 text-sm">Pricing set by owner</p>

              <p className="text-sm uppercase tracking-widest text-zinc-500 mb-5">
                Everything included:
              </p>
              <ul className="space-y-4 mb-10">
                {PRICING_ITEMS.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-zinc-300">
                    <span className="text-blue-500 text-xl leading-none mt-0.5 shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/"
                className="block w-full text-center rounded-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 transition-colors text-lg"
              >
                Start Free Trial
              </Link>
              <p className="text-xs text-zinc-600 text-center mt-4">
                No credit card required to start.
              </p>
            </div>
          </AnimateSection>
        </div>
      </section>

      {/* ── SPINE CALLOUT ───────────────────────────────────── */}
      <section className="py-16 px-6 border-t border-zinc-800/50">
        <div className="max-w-3xl mx-auto">
          <AnimateSection>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              {[
                {
                  headline: "Visible",
                  body: "Every workflow, every conversation, every approval — in a structured dashboard your whole team can access.",
                },
                {
                  headline: "Reviewable",
                  body: "Every action the system takes is open to review. No black box. No outputs you cannot trace back.",
                },
                {
                  headline: "Documented",
                  body: "Complete logs, timestamps, status histories, and escalation records — built automatically as events occur.",
                },
              ].map((item, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <p className="text-lg font-bold text-zinc-50 mb-3">{item.headline}</p>
                  <p className="text-sm text-zinc-400 leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </AnimateSection>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────── */}
      <section className="py-24 md:py-32 px-6 border-t border-zinc-800/50">
        <div className="max-w-3xl mx-auto">
          <AnimateSection>
            <p className="text-sm uppercase tracking-widest text-zinc-500 mb-6 text-center">FAQ</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-center">
              Questions, answered directly.
            </h2>
            <p className="text-zinc-400 text-center mb-16">
              No vague marketing answers. Exactly how this works.
            </p>
          </AnimateSection>

          <AnimateSection delay={100}>
            <FaqAccordion items={FAQ_ITEMS} />
          </AnimateSection>
        </div>
      </section>

      {/* ── BOTTOM CTA ──────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-zinc-800/50 text-center">
        <AnimateSection>
          <p className="text-sm uppercase tracking-widest text-zinc-500 mb-6">The Bottom Line</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Your office runs. You stay in control.
          </h2>
          <p className="text-zinc-400 mb-4 text-lg max-w-xl mx-auto leading-relaxed">
            AIgent OS handles customer communication from the ground up —
            so you never have to worry about the office again.
          </p>
          <p className="text-zinc-600 text-sm mb-10">
            Every major workflow stays visible, reviewable, and documented.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-block rounded-full bg-blue-500 hover:bg-blue-600 text-white font-medium px-8 py-4 transition-colors"
            >
              Start Free Trial
            </Link>
            <Link
              href="/"
              className="inline-block rounded-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-50 font-medium px-8 py-4 transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </AnimateSection>
      </section>

      <MarketingFooter />
    </div>
  );
}
