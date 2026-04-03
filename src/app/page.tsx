import Link from "next/link";
import {
  MessageSquare,
  Calendar,
  FileText,
  Phone,
  AlertTriangle,
  Clock,
  Users,
  Bell,
  CheckSquare,
  Settings,
  LayoutDashboard,
  ShieldAlert,
  ChevronDown,
} from "lucide-react";
import { MarketingNav } from "./_components/marketing-nav";
import { MarketingFooter } from "./_components/marketing-footer";
import { AnimateSection } from "./_components/animate-section";
import { CountingNumber } from "./_components/counting-number";
import { LiveEventLog } from "./_components/live-event-log";
import { SectionTabs } from "./_components/section-tabs";

// ── Page ──────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-50">
      <MarketingNav />
      <SectionTabs />

      {/* ══════════════════════════════════════════════════════
          HERO — Full viewport, centered
      ══════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 overflow-hidden pt-16">
        <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[900px] h-[900px] rounded-full bg-blue-600/8 blur-[160px] animate-glow-breathe" />
        </div>
        <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[400px] h-[400px] rounded-full bg-blue-500/12 blur-[60px] animate-glow-breathe-slow" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto space-y-6">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600">AIgent OS</p>
          </AnimateSection>

          <AnimateSection delay={120}>
            <h1 className="text-5xl md:text-[5.5rem] font-bold tracking-tight leading-[1.02] bg-gradient-to-b from-zinc-50 via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
              Your business never misses another customer.
            </h1>
          </AnimateSection>

          <AnimateSection delay={260}>
            <p className="text-xl md:text-2xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              AI that handles calls, texts, scheduling, quotes, and follow-ups —
              while you do the work.
            </p>
          </AnimateSection>

          <AnimateSection delay={380}>
            <p className="text-sm animate-shimmer inline-block">
              Every major workflow stays visible, reviewable, and documented.
            </p>
          </AnimateSection>

          <AnimateSection delay={480}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
              <Link
                href="/pricing"
                className="rounded-full bg-blue-500 hover:bg-blue-600 text-white font-semibold px-8 py-4 transition-all duration-200 text-base hover:scale-[1.02] active:scale-[0.98]"
              >
                Get Started
              </Link>
              <a
                href="#the-problem"
                className="rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-50 hover:border-zinc-600 font-medium px-8 py-4 transition-all duration-200 text-base"
              >
                See How It Works
              </a>
            </div>
          </AnimateSection>
        </div>

        <AnimateSection delay={700} className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[10px] text-zinc-700 uppercase tracking-[0.2em]">Scroll</p>
            <ChevronDown size={14} className="text-zinc-700 animate-bounce-soft" />
          </div>
        </AnimateSection>
      </section>

      {/* ══════════════════════════════════════════════════════
          STATEMENT — One line. Full weight.
      ══════════════════════════════════════════════════════ */}
      <section className="border-t border-zinc-800/50 py-28 md:py-40 px-6">
        <div className="max-w-5xl mx-auto">
          <AnimateSection direction="scale">
            <p className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-zinc-50 leading-[1.05]">
              Every major workflow stays visible, reviewable, and documented.
            </p>
          </AnimateSection>
          <AnimateSection delay={200}>
            <p className="text-xl text-zinc-500 mt-8 max-w-xl">
              Not automation running in a black box. A structured operating
              layer your whole team can see and act on.
            </p>
          </AnimateSection>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          THE PROBLEM — Big text, no cards, just hits
      ══════════════════════════════════════════════════════ */}
      <section id="the-problem" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-16">
              Sound familiar
            </p>
          </AnimateSection>

          <div className="space-y-0 divide-y divide-zinc-800/60">
            {[
              "A lead texts at 9 PM. Nobody replies until morning. They already booked someone else.",
              "A quote goes out Monday. Nobody follows up. The customer forgets.",
              "Your tech is en route. The customer doesn't know. They leave.",
              "You're on a job. Three texts come in. None of them get answered.",
              "Your staff handles it differently every time. Customers notice.",
            ].map((line, i) => (
              <AnimateSection key={i} delay={i * 80} direction="left">
                <div className="flex items-baseline gap-6 py-7 group">
                  <span className="text-xs text-zinc-700 tabular-nums shrink-0 w-5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-xl md:text-2xl text-zinc-400 leading-snug group-hover:text-zinc-300 transition-colors duration-300">
                    {line}
                  </p>
                </div>
              </AnimateSection>
            ))}
          </div>

          <AnimateSection delay={500}>
            <p className="text-2xl md:text-3xl font-semibold text-zinc-50 mt-16 leading-snug">
              Every one of these is a documented failure.
              <span className="text-zinc-500"> None of them have to happen.</span>
            </p>
          </AnimateSection>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          THE ANSWER — Asymmetric, no label, just conviction
      ══════════════════════════════════════════════════════ */}
      <section className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <AnimateSection>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-6">
              Not a chatbot.
              <br />
              <span className="text-zinc-400">An operating system.</span>
            </h2>
            <p className="text-zinc-400 text-lg leading-relaxed">
              AIgent OS is a structured, rules-based layer that handles
              your customer communication from the ground up — leads, scheduling,
              quoting, follow-up, escalations, complaints — with the consistency
              your business needs but cannot hire its way to.
            </p>
          </AnimateSection>

          <AnimateSection delay={150} direction="scale">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10">
              <p className="text-2xl md:text-3xl font-semibold text-zinc-50 leading-snug mb-6">
                You are not giving up control.
              </p>
              <p className="text-2xl md:text-3xl font-semibold text-blue-400 leading-snug">
                You are gaining a system that makes control possible at scale.
              </p>
            </div>
          </AnimateSection>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          HOW IT WORKS — Compact timeline
      ══════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-3xl mx-auto">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-4">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-16">
              Set up in 10 minutes. Runs from there.
            </h2>
          </AnimateSection>

          <div className="space-y-10">
            {[
              {
                n: "01",
                title: "Answer 23 questions",
                desc: "Services, hours, service area, escalation rules, quote handling. That becomes the rulebook the system operates from — not generic defaults.",
              },
              {
                n: "02",
                title: "Get your dedicated number",
                desc: "Customers text this number. Every conversation is logged automatically and visible to your whole team from day one.",
              },
              {
                n: "03",
                title: "The system handles communication",
                desc: "Scheduling, quoting, follow-ups, reminders, urgent routing — structured, documented, and operating inside your rules.",
              },
              {
                n: "04",
                title: "You keep full oversight",
                desc: "Every conversation visible. Every approval yours. Take over any thread instantly. Adjust any rule at any time.",
              },
            ].map((item, i) => (
              <AnimateSection key={i} delay={i * 90}>
                <div className="flex gap-8 items-start">
                  <span className="text-sm font-bold text-zinc-700 tabular-nums shrink-0 pt-1 w-8">
                    {item.n}
                  </span>
                  <div className="border-t border-zinc-800 pt-6 flex-1">
                    <h3 className="text-lg font-semibold text-zinc-50 mb-2">{item.title}</h3>
                    <p className="text-zinc-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </AnimateSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          AI FRONT DESK — Full channel coverage
      ══════════════════════════════════════════════════════ */}
      <section id="ai-front-desk" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-4">AI Front Desk</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Every channel. Every situation.
              <br />
              <span className="text-zinc-400">One AI that never clocks out.</span>
            </h2>
            <p className="text-zinc-500 text-lg leading-relaxed max-w-2xl mb-20">
              The AI handles every point of customer contact — and knows exactly
              when to step aside and hand it to you.
            </p>
          </AnimateSection>

          {/* Scenario rows */}
          <div className="space-y-3 mb-16">
            {[
              {
                trigger: "Customer calls. You're on a job.",
                response: "The AI answers. If you can't pick up, it picks up for you. Missed calls get an immediate text back — within seconds — so the customer knows someone is there.",
                tag: "Phone",
              },
              {
                trigger: "Customer texts at 11 PM.",
                response: "Response in seconds. Intelligent, on-brand, operating within your rules. Not a generic auto-reply — a real answer based on what your business does and how you want it handled.",
                tag: "Text",
              },
              {
                trigger: "Customer emails about a quote.",
                response: "Handled. Details collected, appointment offered, quote process started. The customer gets a response. You get the lead in your dashboard — organized, not buried.",
                tag: "Email",
              },
              {
                trigger: "Job just got booked.",
                response: "The AI confirms the appointment with the customer, syncs it to your calendar, and notifies your team automatically. Everyone knows what is happening and when.",
                tag: "Scheduling",
              },
              {
                trigger: "Appointment is tomorrow.",
                response: "Reminder goes out automatically — timing and frequency set by you. Customer gets a heads-up. No-shows drop. You do nothing.",
                tag: "Reminders",
              },
              {
                trigger: "Job is finished.",
                response: "Post-appointment confirmation sent automatically. Includes a review request. Your online reputation builds without you having to ask anyone for anything.",
                tag: "Follow-Up",
              },
            ].map((item, i) => (
              <AnimateSection key={i} delay={(i % 3) * 60} direction="left">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl px-7 py-6 card-hover group items-start">
                  <div className="md:col-span-2 flex items-start gap-3">
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-zinc-600 bg-zinc-800 rounded-md px-2 py-1 mt-0.5">
                      {item.tag}
                    </span>
                    <p className="text-zinc-300 font-medium leading-snug">{item.trigger}</p>
                  </div>
                  <div className="md:col-span-3">
                    <p className="text-zinc-500 leading-relaxed text-sm group-hover:text-zinc-400 transition-colors duration-200">
                      {item.response}
                    </p>
                  </div>
                </div>
              </AnimateSection>
            ))}
          </div>

          {/* Calendar sync callout */}
          <AnimateSection direction="scale">
            <div className="bg-blue-500/8 border border-blue-500/20 rounded-2xl px-8 py-7 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-blue-400/70 mb-3">Calendar Integration</p>
                  <p className="text-zinc-100 font-semibold text-lg leading-snug mb-2">
                    Syncs directly with your calendar.
                  </p>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Every appointment the AI books lands on your calendar automatically.
                    Your team sees it. The customer is confirmed. Nothing needs to be
                    entered manually — it is already there.
                  </p>
                </div>
                <div className="space-y-2.5">
                  {[
                    "Bookings sync to your calendar in real time",
                    "Team sees new appointments the moment they are confirmed",
                    "Reschedules and cancellations update automatically",
                    "No double-entry, no manual coordination",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="text-blue-500 shrink-0 mt-0.5 text-sm font-bold">—</span>
                      <p className="text-zinc-400 text-sm leading-relaxed">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AnimateSection>

          {/* Guardrails */}
          <AnimateSection delay={100}>
            <div className="border border-zinc-800 rounded-2xl px-8 py-7">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-600 mb-6">
                What the AI never does
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                {[
                  {
                    point: "Never admits fault or liability",
                    detail: "Complaints and legal language are detected immediately and transferred to you — the AI does not engage.",
                  },
                  {
                    point: "Never makes unauthorized commitments",
                    detail: "It only commits to what you have authorized. Anything outside your rules gets escalated, not improvised.",
                  },
                  {
                    point: "Never ignores an escalation signal",
                    detail: "Anything that could go badly — complaints, threats, disputes — is flagged and handed to a human immediately.",
                  },
                  {
                    point: "Never goes off-script",
                    detail: "The AI operates within your rulebook. It does not freelance, speculate, or answer questions it was not set up to handle.",
                  },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 py-2">
                    <span className="text-zinc-700 shrink-0 mt-1 font-bold text-sm">—</span>
                    <div>
                      <p className="text-zinc-200 font-medium text-sm mb-1">{item.point}</p>
                      <p className="text-zinc-600 text-sm leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AnimateSection>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          LIVE SYSTEM — Split: copy left, live log right
      ══════════════════════════════════════════════════════ */}
      <section id="control" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-20 items-start">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-6">Control</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-8">
              The system asks before it acts.
              <br />
              <span className="text-zinc-400">You decide. It executes.</span>
            </h2>
            <ul className="space-y-4">
              {[
                "You define what the AI can and cannot commit to",
                "Quotes require approval before any customer sees them",
                "Take over any conversation with one tap",
                "Set quiet hours, service area limits, escalation triggers",
                "Every rule is visible — adjust any of them at any time",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-zinc-400">
                  <span className="text-blue-500 shrink-0 mt-1 font-bold text-sm">—</span>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10 pt-10 border-t border-zinc-800">
              <p className="text-zinc-500 text-sm leading-relaxed">
                Every major conversation, status change, approval, escalation,
                and workflow movement remains visible inside the system — from
                the moment it happens to the moment it resolves.
              </p>
            </div>
          </AnimateSection>

          <AnimateSection delay={150} direction="scale">
            <LiveEventLog />
          </AnimateSection>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          WHAT'S INSIDE — Compact department list
      ══════════════════════════════════════════════════════ */}
      <section id="whats-inside" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-4">Inside the dashboard</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Eight departments. Every part of your operation.
            </h2>
            <p className="text-zinc-500 text-lg mb-16 max-w-xl">
              Each section handles a specific function. Nothing is lumped
              together. Nothing disappears.
            </p>
          </AnimateSection>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-800/50 rounded-2xl overflow-hidden border border-zinc-800">
            {[
              {
                icon: <LayoutDashboard size={16} strokeWidth={1.5} />,
                name: "Dashboard",
                line: "Live view of every active workflow. One screen.",
              },
              {
                icon: <MessageSquare size={16} strokeWidth={1.5} />,
                name: "Conversations",
                line: "Every customer thread, logged in full, visible to your team.",
              },
              {
                icon: <Calendar size={16} strokeWidth={1.5} />,
                name: "Appointments",
                line: "Today, upcoming, past. Full booking history.",
              },
              {
                icon: <FileText size={16} strokeWidth={1.5} />,
                name: "Quotes",
                line: "Needs action, sent, closed. Nothing sits unnoticed.",
              },
              {
                icon: <CheckSquare size={16} strokeWidth={1.5} />,
                name: "Approvals",
                line: "Nothing requiring sign-off moves without it.",
              },
              {
                icon: <AlertTriangle size={16} strokeWidth={1.5} />,
                name: "Escalations",
                line: "Flagged situations routed with full context attached.",
              },
              {
                icon: <ShieldAlert size={16} strokeWidth={1.5} />,
                name: "Urgent",
                line: "Complaints, legal flags, safety issues — isolated immediately.",
              },
              {
                icon: <Settings size={16} strokeWidth={1.5} />,
                name: "Settings",
                line: "Your rules. Your boundaries. Applied system-wide.",
              },
            ].map((dept, i) => (
              <AnimateSection key={i} delay={Math.floor(i / 2) * 60} direction="scale">
                <div className="bg-zinc-900/80 p-6 flex items-start gap-4 card-hover group h-full">
                  <span className="text-zinc-600 group-hover:text-blue-500 transition-colors duration-200 mt-0.5 shrink-0">
                    {dept.icon}
                  </span>
                  <div>
                    <p className="font-semibold text-zinc-200 mb-1 text-sm">{dept.name}</p>
                    <p className="text-zinc-500 text-sm leading-relaxed">{dept.line}</p>
                  </div>
                </div>
              </AnimateSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          CAPABILITIES — Clean 2-col, no header copy
      ══════════════════════════════════════════════════════ */}
      <section id="capabilities" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-4">What it handles</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-16">
              Everything between the first text
              <br className="hidden md:block" />
              <span className="text-zinc-400"> and the finished job.</span>
            </h2>
          </AnimateSection>

          <div className="space-y-0 divide-y divide-zinc-800/60">
            {[
              {
                icon: <MessageSquare size={16} strokeWidth={1.5} />,
                title: "Lead Response",
                desc: "Inbound message answered in seconds — 24/7, rules-based, on-brand.",
              },
              {
                icon: <Calendar size={16} strokeWidth={1.5} />,
                title: "Appointment Scheduling",
                desc: "Books the job, sends confirmation and reminders. Logged automatically.",
              },
              {
                icon: <FileText size={16} strokeWidth={1.5} />,
                title: "Quote Management",
                desc: "Owner approves first. Then it goes out. Followed up at 24h and 3 days.",
              },
              {
                icon: <Phone size={16} strokeWidth={1.5} />,
                title: "Missed Call Recovery",
                desc: "Missed call triggers an outbound text in seconds. Opportunity preserved.",
              },
              {
                icon: <AlertTriangle size={16} strokeWidth={1.5} />,
                title: "Urgent Routing",
                desc: "Legal language, complaints, safety flags escalated to your team with full context.",
              },
              {
                icon: <Clock size={16} strokeWidth={1.5} />,
                title: "24/7 Coverage",
                desc: "Nights, weekends, holidays. Every after-hours exchange documented.",
              },
              {
                icon: <Users size={16} strokeWidth={1.5} />,
                title: "Customer History",
                desc: "Every message, appointment, quote per customer — accessible to your whole team.",
              },
              {
                icon: <Bell size={16} strokeWidth={1.5} />,
                title: "Structured Follow-Up",
                desc: "Silence timers, stale flags, auto-close. Nothing left waiting without reason.",
              },
            ].map((item, i) => (
              <AnimateSection key={i} delay={(i % 3) * 60} direction="left">
                <div className="flex items-center gap-6 py-5 group">
                  <span className="text-zinc-700 group-hover:text-blue-500 transition-colors duration-200 shrink-0">
                    {item.icon}
                  </span>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-8 items-baseline">
                    <p className="font-semibold text-zinc-200 text-sm">{item.title}</p>
                    <p className="text-zinc-500 text-sm leading-relaxed md:col-span-2">{item.desc}</p>
                  </div>
                </div>
              </AnimateSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          NUMBERS — Just the stats, let them breathe
      ══════════════════════════════════════════════════════ */}
      <section className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-16">Built to be trusted</p>
          </AnimateSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
            {[
              { target: 474, label: "Automated tests passing", context: "Every rule verified. Every edge case covered." },
              { target: 33,  label: "Conversation states managed", context: "Not just replies — a full operational state machine." },
              { target: 21,  label: "Industries supported", context: "Built around how service businesses actually work." },
            ].map((item, i) => (
              <AnimateSection key={i} delay={i * 120} direction="scale">
                <div className="py-10 md:px-12 first:pl-0 last:pr-0">
                  <p className="text-6xl md:text-7xl font-bold text-zinc-50 mb-3 leading-none">
                    <CountingNumber target={item.target} duration={2000} />
                  </p>
                  <p className="text-zinc-400 font-medium mb-2">{item.label}</p>
                  <p className="text-zinc-600 text-sm leading-relaxed">{item.context}</p>
                </div>
              </AnimateSection>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          PRICING — Card only, tight
      ══════════════════════════════════════════════════════ */}
      <section id="pricing-section" className="border-t border-zinc-800/50 py-24 md:py-32 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <AnimateSection>
            <p className="text-xs uppercase tracking-[0.3em] text-zinc-600 mb-6">Pricing</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
              One plan.
              <br />
              <span className="text-zinc-400">Everything included.</span>
            </h2>
            <p className="text-zinc-500 leading-relaxed mb-8">
              All eight departments. Full documentation layer. Full control.
              24/7 coverage. No add-ons, no tiers, no surprises.
            </p>
            <Link
              href="/pricing"
              className="inline-block text-sm text-zinc-400 hover:text-zinc-50 border-b border-zinc-700 hover:border-zinc-400 pb-0.5 transition-all duration-200"
            >
              See full pricing details →
            </Link>
          </AnimateSection>

          <AnimateSection delay={120} direction="scale">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 card-hover">
              <p className="text-5xl font-bold text-zinc-50 mb-1">
                $XXX
                <span className="text-xl text-zinc-500 font-normal">/mo</span>
              </p>
              <p className="text-zinc-600 text-xs mb-8">Pricing set by owner</p>

              <ul className="space-y-2.5 mb-8">
                {[
                  "Dedicated business phone number",
                  "Unlimited AI conversations",
                  "Appointment scheduling + reminders",
                  "Quote management + follow-up",
                  "Urgent routing + escalation",
                  "Full admin dashboard — all 8 departments",
                  "24/7 coverage",
                  "All 21 industries supported",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-zinc-400 text-sm">
                    <span className="text-blue-500 shrink-0">·</span>
                    {item}
                  </li>
                ))}
              </ul>

              <Link
                href="/pricing"
                className="block w-full text-center rounded-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3.5 transition-all duration-200 hover:scale-[1.01] text-sm"
              >
                See Pricing Details
              </Link>
            </div>
          </AnimateSection>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FINAL CTA — Full weight, breathing glow, clean
      ══════════════════════════════════════════════════════ */}
      <section className="relative border-t border-zinc-800/50 min-h-[70vh] flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[700px] h-[700px] rounded-full bg-blue-500/8 blur-[140px] animate-glow-breathe" />
        </div>

        <AnimateSection className="relative z-10 max-w-3xl mx-auto" direction="scale">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Every hour without a system is another lost customer.
          </h2>
          <p className="text-xl text-zinc-400 leading-relaxed mb-4">
            AIgent OS handles your customer communication from the
            ground up — so you never have to worry about the office again.
          </p>
          <p className="text-sm mb-12 animate-shimmer inline-block">
            Every major workflow stays visible, reviewable, and documented.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/pricing"
              className="rounded-full bg-blue-500 hover:bg-blue-600 text-white font-semibold px-10 py-4 text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Get Started Now
            </Link>
            <Link
              href="/pricing"
              className="rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-50 hover:border-zinc-600 font-medium px-10 py-4 text-base transition-all duration-200"
            >
              View Pricing
            </Link>
          </div>
        </AnimateSection>
      </section>

      <MarketingFooter />
    </div>
  );
}
