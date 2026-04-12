"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import { CATEGORY_LABELS, HVAC_CATEGORIES } from "~/engine/scheduling/hvac-service-defaults";

// ── Types ──────────────────────────────────────────────────────────────────
type Tab =
  | "business"
  | "ai"
  | "services"
  | "service_estimates"
  | "hours"
  | "policies"
  | "quotes"
  | "technicians"
  | "team"
  | "danger";

const BASE_TABS: { value: Tab; label: string; hvacOnly?: boolean }[] = [
  { value: "business",           label: "Business Info" },
  { value: "ai",                 label: "AI Behavior"   },
  { value: "services",           label: "Services"       },
  { value: "service_estimates",  label: "Service Times", hvacOnly: true },
  { value: "hours",              label: "Hours"          },
  { value: "policies",           label: "Policies"       },
  { value: "quotes",             label: "Quotes"         },
  { value: "technicians",        label: "Technicians"    },
  { value: "team",               label: "Team"           },
  { value: "danger",             label: "Danger Zone"    },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const TIMER_OPTIONS = [
  { label: "1 hour",   seconds: 3600   },
  { label: "4 hours",  seconds: 14400  },
  { label: "1 day",    seconds: 86400  },
  { label: "3 days",   seconds: 259200 },
  { label: "7 days",   seconds: 604800 },
  { label: "Never (0)",seconds: 0      },
];

const US_TIMEZONES = [
  { value: "America/New_York",    label: "Eastern"  },
  { value: "America/Chicago",     label: "Central"  },
  { value: "America/Denver",      label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific"  },
  { value: "America/Anchorage",   label: "Alaska"   },
  { value: "Pacific/Honolulu",    label: "Hawaii"   },
];

const LANGUAGE_LIST = [
  { key: "english",    label: "English",    locked: true },
  { key: "spanish",    label: "Spanish"                  },
  { key: "italian",    label: "Italian"                  },
  { key: "french",     label: "French"                   },
  { key: "portuguese", label: "Portuguese"               },
];

interface LanguageEntry { enabled: boolean; speaker: string }

const DEFAULT_LANGUAGES: Record<string, LanguageEntry> = {
  english:    { enabled: true,  speaker: "" },
  spanish:    { enabled: false, speaker: "" },
  italian:    { enabled: false, speaker: "" },
  french:     { enabled: false, speaker: "" },
  portuguese: { enabled: false, speaker: "" },
};

function parseLanguages(raw: string | null | undefined): Record<string, LanguageEntry> {
  if (!raw) return { ...DEFAULT_LANGUAGES };
  try {
    const parsed = JSON.parse(raw) as Record<string, LanguageEntry>;
    return {
      ...DEFAULT_LANGUAGES,
      ...parsed,
      english: { ...DEFAULT_LANGUAGES.english, ...(parsed.english ?? { enabled: true, speaker: "" }), enabled: true },
    };
  } catch {
    return { ...DEFAULT_LANGUAGES };
  }
}

// ── UI helpers ─────────────────────────────────────────────────────────────

const INPUT_STYLE = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  color: "var(--t1)",
  outline: "none",
  borderRadius: "8px",
  width: "100%",
  padding: "8px 12px",
  fontSize: "13px",
  colorScheme: "inherit",
} as const;

const SELECT_STYLE = {
  ...INPUT_STYLE,
  cursor: "pointer",
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium" style={{ color: "var(--t2)" }}>{label}</label>
      {children}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = "text",
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={INPUT_STYLE}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

function Textarea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...INPUT_STYLE, resize: "none" }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

function Toggle({
  value, onChange, label,
}: {
  value: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200"
        style={{ background: value ? "var(--accent)" : "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full transition-transform duration-200"
          style={{
            background: value ? "#fff" : "var(--t3)",
            transform: value ? "translateX(18px)" : "translateX(2px)",
          }}
        />
      </button>
      <span className="text-sm" style={{ color: "var(--t2)" }}>{label}</span>
    </label>
  );
}

function SaveBtn({
  onClick, isPending, saved, disabled,
}: {
  onClick: () => void; isPending: boolean; saved: boolean; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isPending}
      className="rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 disabled:opacity-50"
      style={{ background: "var(--accent)", color: "#fff" }}
      onMouseEnter={(e) => { if (!disabled && !isPending) (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
    >
      {isPending ? "Saving…" : saved ? "Saved" : "Save Changes"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <h2 className="mb-4 text-sm font-semibold" style={{ color: "var(--t1)" }}>{title}</h2>
      {children}
    </div>
  );
}

// ── TimezoneSelect ─────────────────────────────────────────────────────────
function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [times, setTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    function update() {
      const now = new Date();
      const t: Record<string, string> = {};
      for (const tz of US_TIMEZONES) {
        t[tz.value] = now.toLocaleTimeString("en-US", {
          timeZone: tz.value, hour: "numeric", minute: "2-digit", hour12: true,
        });
      }
      setTimes(t);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const isKnown = US_TIMEZONES.some((tz) => tz.value === value);

  return (
    <select
      style={SELECT_STYLE}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {US_TIMEZONES.map((tz) => (
        <option key={tz.value} value={tz.value}>
          {tz.label} Time{times[tz.value] ? ` (currently ${times[tz.value]})` : ""}
        </option>
      ))}
      {!isKnown && value && <option value={value}>{value}</option>}
    </select>
  );
}

// ── LanguagePicker ─────────────────────────────────────────────────────────
function LanguagePicker({
  value, onChange,
}: {
  value: Record<string, LanguageEntry>; onChange: (v: Record<string, LanguageEntry>) => void;
}) {
  return (
    <div className="space-y-3">
      {LANGUAGE_LIST.map((lang) => {
        const entry: LanguageEntry = value[lang.key] ?? { enabled: lang.locked ?? false, speaker: "" };
        return (
          <div key={lang.key} className="space-y-1.5">
            <label className="flex items-center gap-2.5 text-sm" style={{ color: "var(--t2)" }}>
              <input
                type="checkbox"
                checked={entry.enabled}
                disabled={!!lang.locked}
                onChange={(e) => {
                  if (lang.locked) return;
                  onChange({ ...value, [lang.key]: { ...entry, enabled: e.target.checked } });
                }}
                className="h-4 w-4 rounded"
                style={{ accentColor: "var(--accent)" }}
              />
              <span className={lang.locked ? "font-medium" : ""}>{lang.label}</span>
              {lang.locked && <span className="text-xs" style={{ color: "var(--t3)" }}>(always enabled)</span>}
            </label>
            {entry.enabled && (
              <div className="ml-6">
                <input
                  style={{ ...INPUT_STYLE, width: "calc(100% - 1.5rem)" }}
                  value={entry.speaker}
                  onChange={(e) => onChange({ ...value, [lang.key]: { ...entry, speaker: e.target.value } })}
                  placeholder={`Team member who speaks ${lang.label} (e.g., Maria in the front office)`}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HoursEditor ────────────────────────────────────────────────────────────
interface DayHours { open: string; close: string; closed: boolean }

// Generate 30-min slot options: "00:00" → "23:30"
const TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const totalMin = i * 30;
  const h24 = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const value = `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const label = `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
  return { value, label };
});

const DAY_ABBR: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const timeSelectStyle: React.CSSProperties = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  color: "var(--t1)",
  outline: "none",
  borderRadius: "8px",
  padding: "6px 8px",
  fontSize: "13px",
  cursor: "pointer",
  colorScheme: "inherit",
};

function HoursEditor({ value, onChange }: { value: Record<string, DayHours>; onChange: (v: Record<string, DayHours>) => void }) {
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: "1px solid var(--border)" }}>
      {DAYS.map((day, i) => {
        const h: DayHours = value[day] ?? { open: "08:00", close: "17:00", closed: false };
        const isLast = i === DAYS.length - 1;
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
            style={{
              borderBottom: isLast ? "none" : "1px solid var(--border)",
              background: h.closed ? "transparent" : "var(--bg-hover)",
            }}
          >
            {/* Day label */}
            <span className="w-8 shrink-0 text-sm font-semibold" style={{ color: "var(--t1)" }}>
              {DAY_ABBR[day]}
            </span>

            {/* Open / Closed toggle */}
            <button
              type="button"
              onClick={() => onChange({ ...value, [day]: { ...h, closed: !h.closed } })}
              className="w-16 rounded-lg py-1.5 text-xs font-semibold transition-all duration-150"
              style={h.closed
                ? { background: "var(--bg-elevated)", color: "var(--t3)", border: "1px solid var(--border)" }
                : { background: "rgba(34,197,94,0.12)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.25)" }
              }
            >
              {h.closed ? "Closed" : "Open"}
            </button>

            {/* Time selects — only when open */}
            {!h.closed && (
              <div className="flex items-center gap-2">
                <select
                  value={h.open}
                  onChange={(e) => onChange({ ...value, [day]: { ...h, open: e.target.value } })}
                  style={timeSelectStyle}
                >
                  {TIME_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <span className="text-xs font-medium" style={{ color: "var(--t3)" }}>to</span>
                <select
                  value={h.close}
                  onChange={(e) => onChange({ ...value, [day]: { ...h, close: e.target.value } })}
                  style={timeSelectStyle}
                >
                  {TIME_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ServicesEditor ─────────────────────────────────────────────────────────
interface Service { name: string; description?: string }

function ServicesEditor({ value, onChange }: { value: Service[]; onChange: (v: Service[]) => void }) {
  const [newName, setNewName] = useState("");

  function add() {
    if (!newName.trim()) return;
    onChange([...value, { name: newName.trim() }]);
    setNewName("");
  }

  return (
    <div className="space-y-2">
      {value.map((svc, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="flex-1 rounded-lg px-3 py-2 text-sm"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--t1)" }}
          >
            {svc.name}
          </span>
          <button
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150"
            style={{ color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.15)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add service…"
          style={{ ...INPUT_STYLE, flex: 1 }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }}
        />
        <button
          onClick={add}
          className="rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--t2)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--t1)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-8 flex-1 rounded-lg" style={{ background: "var(--skeleton)" }} />
        ))}
      </div>
      <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="h-4 w-1/4 rounded-lg" style={{ background: "var(--skeleton)" }} />
        <div className="h-9 w-full rounded-lg" style={{ background: "var(--skeleton)" }} />
        <div className="h-9 w-full rounded-lg" style={{ background: "var(--skeleton)" }} />
        <div className="h-9 w-2/3 rounded-lg" style={{ background: "var(--skeleton)" }} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "owner";
  const [tab, setTab] = useState<Tab>("business");

  const { data, isLoading, refetch } = api.settings.getBusiness.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const { data: team, refetch: refetchTeam } = api.settings.getTeam.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // ── Business Info state
  const [bizName, setBizName] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [joinCode, setJoinCode] = useState("");
  const [reviewLink, setReviewLink] = useState("");
  const [preferredPhone, setPreferredPhone] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [alertEmail, setAlertEmail] = useState("");
  const [alertEmailEnabled, setAlertEmailEnabled] = useState(false);
  const [bizSaved, setBizSaved] = useState(false);

  // ── AI Behavior state
  const [signoffName, setSignoffName] = useState("");
  const [toneDesc, setToneDesc] = useState("");
  const [alwaysSay, setAlwaysSay] = useState("");
  const [neverSay, setNeverSay] = useState("");
  const [languagesData, setLanguagesData] = useState<Record<string, LanguageEntry>>({ ...DEFAULT_LANGUAGES });
  const [multilingualEnabled, setMultilingualEnabled] = useState(false);
  const [aiCallEnabled, setAiCallEnabled] = useState(true);
  const [takeoverMsg, setTakeoverMsg] = useState("");
  const [timerSec, setTimerSec] = useState(604800);
  const [aiSaved, setAiSaved] = useState(false);

  // ── Services state
  const [services, setServices] = useState<Service[]>([]);
  const [sameDayBooking, setSameDayBooking] = useState(false);
  const [roughEstimate, setRoughEstimate] = useState(false);
  const [laborPricing, setLaborPricing] = useState("");
  const [svcSaved, setSvcSaved] = useState(false);

  // ── Hours state
  const [hours, setHours] = useState<Record<string, DayHours>>({});
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [hoursSaved, setHoursSaved] = useState(false);

  // ── Policies state
  const [cancelPolicy, setCancelPolicy] = useState("");
  const [warranty, setWarranty] = useState("");
  const [paymentMethods, setPaymentMethods] = useState("");
  const [customerPrep, setCustomerPrep] = useState("");
  const [emergencyRules, setEmergencyRules] = useState("");
  const [commonQs, setCommonQs] = useState("");
  const [typicalProcess, setTypicalProcess] = useState("");
  const [importantDetails, setImportantDetails] = useState("");
  const [philosophy, setPhilosophy] = useState("");
  const [paymentMgmt, setPaymentMgmt] = useState(true);
  const [polSaved, setPolSaved] = useState(false);

  // ── Quotes state
  const [quoteExpiry, setQuoteExpiry] = useState(30);
  const [autoClose, setAutoClose] = useState(30);
  const [quoteSaved, setQuoteSaved] = useState(false);

  // ── Danger state
  const [isPaused, setIsPaused] = useState(false);
  const [pauseMsg, setPauseMsg] = useState("");
  const [dangerSaved, setDangerSaved] = useState(false);

  // ── Service area state
  const [serviceAreaRaw, setServiceAreaRaw] = useState("[]");

  useEffect(() => {
    if (!data) return;
    const b = data;
    setBizName(b.business_name ?? "");
    setTimezone(b.timezone ?? "America/New_York");
    setJoinCode(b.join_code ?? "");
    setReviewLink(b.google_review_link ?? "");
    setPreferredPhone(b.preferred_phone_number ?? "");
    setAlertPhone(b.urgent_alert_phone ?? "");
    const existingEmail = b.urgent_alert_email ?? "";
    setAlertEmail(existingEmail);
    setAlertEmailEnabled(!!existingEmail);
    setSignoffName(b.ai_signoff_name ?? "");
    setToneDesc(b.ai_tone_description ?? "");
    setAlwaysSay(b.always_say ?? "");
    setNeverSay(b.never_say ?? "");
    setLanguagesData(parseLanguages(b.supported_languages));
    setMultilingualEnabled(b.multilingual_enabled);
    setAiCallEnabled(b.ai_call_answering_enabled);
    setTakeoverMsg(b.takeover_notification_message ?? "");
    setTimerSec(b.default_takeover_timer_seconds);
    setRoughEstimate(b.rough_estimate_mode_enabled);
    setLaborPricing(b.labor_pricing_method ?? "");
    setCancelPolicy(b.cancellation_policy ?? "");
    setWarranty(b.warranty_policy ?? "");
    setPaymentMethods(b.payment_methods ?? "");
    setCustomerPrep(b.customer_prep ?? "");
    setEmergencyRules(b.emergency_rules ?? "");
    setCommonQs(b.common_questions ?? "");
    setTypicalProcess(b.typical_process ?? "");
    setImportantDetails(b.important_details ?? "");
    setPhilosophy(b.customer_philosophy ?? "");
    setPaymentMgmt(b.payment_management_enabled);
    setQuoteExpiry(b.quote_expiry_days);
    setAutoClose(b.auto_close_days);
    setIsPaused(b.is_paused);
    setPauseMsg(b.pause_message ?? "");

    const cfg = b.business_config;
    if (cfg) {
      const rawHours = cfg.business_hours as unknown as Record<string, DayHours> | undefined;
      if (rawHours) setHours(rawHours);
      try { setServiceAreaRaw(JSON.stringify(cfg.service_area_list ?? [], null, 2)); } catch { /* empty */ }
      const rawServices = cfg.services_offered as unknown as Service[] | undefined;
      if (Array.isArray(rawServices)) setServices(rawServices);
      setSameDayBooking(cfg.same_day_booking_allowed);
      const qs = b.quiet_hours_start;
      const qe = b.quiet_hours_end;
      if (qs) setQuietStart(new Date(qs).toISOString().substring(11, 16));
      if (qe) setQuietEnd(new Date(qe).toISOString().substring(11, 16));
    }
  }, [data]);

  // ── Mutations
  const updateBiz = api.settings.updateBusiness.useMutation({
    onSuccess: () => { setBizSaved(true); setTimeout(() => setBizSaved(false), 2000); void refetch(); },
  });
  const updateAi = api.settings.updateBusiness.useMutation({
    onSuccess: () => { setAiSaved(true); setTimeout(() => setAiSaved(false), 2000); void refetch(); },
  });
  const updateCfgSvc = api.settings.updateBusinessConfig.useMutation({
    onSuccess: () => { setSvcSaved(true); setTimeout(() => setSvcSaved(false), 2000); void refetch(); },
  });
  const updateCfgHours = api.settings.updateBusinessConfig.useMutation({
    onSuccess: () => { setHoursSaved(true); setTimeout(() => setHoursSaved(false), 2000); void refetch(); },
  });
  const updateBizHours = api.settings.updateBusiness.useMutation({
    onSuccess: () => { setHoursSaved(true); setTimeout(() => setHoursSaved(false), 2000); void refetch(); },
  });
  const updatePol = api.settings.updateBusiness.useMutation({
    onSuccess: () => { setPolSaved(true); setTimeout(() => setPolSaved(false), 2000); void refetch(); },
  });
  const updateQuotes = api.settings.updateBusiness.useMutation({
    onSuccess: () => { setQuoteSaved(true); setTimeout(() => setQuoteSaved(false), 2000); void refetch(); },
  });
  const pauseMutation = api.settings.pauseBusiness.useMutation({
    onSuccess: () => { setDangerSaved(true); setTimeout(() => setDangerSaved(false), 2000); void refetch(); },
  });
  const changeRole = api.settings.changeUserRole.useMutation({
    onSuccess: () => void refetchTeam(),
  });
  const removeUser = api.settings.removeUser.useMutation({
    onSuccess: () => void refetchTeam(),
  });

  // ── Technicians
  const { data: techList, refetch: refetchTechs } = api.settings.getTechnicians.useQuery(undefined, { refetchOnWindowFocus: false });
  const [newTechName, setNewTechName] = useState("");
  const addTech = api.settings.addTechnician.useMutation({ onSuccess: () => { setNewTechName(""); void refetchTechs(); } });
  const removeTech = api.settings.removeTechnician.useMutation({ onSuccess: () => void refetchTechs() });

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Settings</h1>
        <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>Manage your business configuration</p>
      </div>

      {/* Tab bar — scrollable for 8 tabs */}
      <div
        className="flex gap-1 overflow-x-auto rounded-xl p-1"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", scrollbarWidth: "none" }}
      >
        {BASE_TABS.filter((t) => !t.hvacOnly || data?.industry === "hvac").map((t) => {
          const active = tab === t.value;
          const isDanger = t.value === "danger";
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150"
              style={{
                background: active
                  ? isDanger ? "rgba(239,68,68,0.15)" : "var(--bg-surface)"
                  : "transparent",
                color: active
                  ? isDanger ? "#f87171" : "var(--t1)"
                  : isDanger ? "rgba(248,113,113,0.6)" : "var(--t3)",
                border: active
                  ? isDanger ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border)"
                  : "1px solid transparent",
                boxShadow: active && !isDanger ? "0 1px 4px rgba(0,0,0,0.25)" : "none",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Read-only banner for admins */}
      {!isOwner && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "rgba(234,179,8,0.08)",
            border: "1px solid rgba(234,179,8,0.2)",
            color: "#fbbf24",
          }}
        >
          View only — contact your business owner to make changes.
        </div>
      )}

      {/* ── Business Info ──────────────────────────────────────────────────── */}
      {tab === "business" && (
        <Section title="Business Info">
          <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Name">
                <Input value={bizName} onChange={setBizName} />
              </Field>
              <Field label="Timezone">
                <TimezoneSelect value={timezone} onChange={setTimezone} />
              </Field>
              <Field label="Join Code">
                <div className="flex gap-2">
                  <Input value={joinCode} onChange={setJoinCode} />
                  <button
                    onClick={() => void navigator.clipboard.writeText(joinCode)}
                    className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--t2)" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--t1)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
                  >
                    Copy
                  </button>
                </div>
              </Field>
              <Field label="Google Review Link">
                <Input value={reviewLink} onChange={setReviewLink} />
              </Field>
              <Field label="Preferred Phone">
                <Input value={preferredPhone} onChange={setPreferredPhone} />
              </Field>
              <Field label="Urgent Alert Phone">
                <Input value={alertPhone} onChange={setAlertPhone} />
              </Field>
              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-2.5 text-xs font-medium" style={{ color: "var(--t2)" }}>
                  <input
                    type="checkbox"
                    checked={alertEmailEnabled}
                    onChange={(e) => setAlertEmailEnabled(e.target.checked)}
                    className="h-4 w-4 rounded"
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Enable urgent email alerts
                </label>
                {alertEmailEnabled && (
                  <Input
                    value={alertEmail}
                    onChange={setAlertEmail}
                    placeholder="owner@yourbusiness.com"
                    type="email"
                  />
                )}
              </div>
            </div>
          </fieldset>
          {isOwner && (
            <div className="mt-5 flex items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <SaveBtn
                onClick={() =>
                  updateBiz.mutate({
                    business_name: bizName,
                    timezone,
                    join_code: joinCode,
                    google_review_link: reviewLink || undefined,
                    preferred_phone_number: preferredPhone || undefined,
                    urgent_alert_phone: alertPhone || undefined,
                    urgent_alert_email: alertEmailEnabled ? alertEmail : "",
                  })
                }
                isPending={updateBiz.isPending}
                saved={bizSaved}
                disabled={false}
              />
              {updateBiz.isError && (
                <p className="text-xs" style={{ color: "#f87171" }}>{updateBiz.error.message}</p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── AI Behavior ────────────────────────────────────────────────────── */}
      {tab === "ai" && (
        <Section title="AI Behavior">
          <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="AI Name (first message only)">
                <Input value={signoffName} onChange={setSignoffName} placeholder="e.g. Alex from Acme" />
              </Field>
              <Field label="Default Takeover Timer">
                <select
                  value={timerSec}
                  onChange={(e) => setTimerSec(parseInt(e.target.value))}
                  style={SELECT_STYLE}
                >
                  {TIMER_OPTIONS.map((o) => (
                    <option key={o.seconds} value={o.seconds}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="AI Tone Description">
                  <Textarea value={toneDesc} onChange={setToneDesc} placeholder="Friendly, professional, concise…" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Always Say">
                  <Textarea value={alwaysSay} onChange={setAlwaysSay} placeholder="Things AI should always say or include…" rows={2} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Never Say">
                  <Textarea value={neverSay} onChange={setNeverSay} placeholder="Things AI should never say…" rows={2} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Takeover Notification Message">
                  <Textarea value={takeoverMsg} onChange={setTakeoverMsg} placeholder="Message sent when AI hands off to human…" rows={2} />
                </Field>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Toggle value={multilingualEnabled} onChange={setMultilingualEnabled} label="Enable multilingual AI" />
              <Toggle value={aiCallEnabled} onChange={setAiCallEnabled} label="AI call answering enabled" />
            </div>
            <div className="mt-5">
              <p className="mb-3 text-xs font-medium" style={{ color: "var(--t2)" }}>Supported Languages</p>
              <LanguagePicker value={languagesData} onChange={setLanguagesData} />
            </div>
          </fieldset>
          {isOwner && (
            <div className="mt-5 flex items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <SaveBtn
                onClick={() =>
                  updateAi.mutate({
                    ai_signoff_name: signoffName || undefined,
                    ai_tone_description: toneDesc || undefined,
                    always_say: alwaysSay || undefined,
                    never_say: neverSay || undefined,
                    supported_languages: JSON.stringify(languagesData),
                    multilingual_enabled: multilingualEnabled,
                    ai_call_answering_enabled: aiCallEnabled,
                    takeover_notification_message: takeoverMsg || undefined,
                    default_takeover_timer_seconds: timerSec,
                  })
                }
                isPending={updateAi.isPending}
                saved={aiSaved}
                disabled={false}
              />
              {updateAi.isError && (
                <p className="text-xs" style={{ color: "#f87171" }}>{updateAi.error.message}</p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Services & Scheduling ──────────────────────────────────────────── */}
      {tab === "services" && (
        <div className="space-y-4">
          <Section title="Services Offered">
            <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
              <ServicesEditor value={services} onChange={setServices} />
            </fieldset>
          </Section>
          <Section title="Scheduling">
            <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
              <div className="space-y-3">
                <Toggle value={sameDayBooking} onChange={setSameDayBooking} label="Same-day booking allowed" />
                <Toggle value={roughEstimate} onChange={setRoughEstimate} label="Rough estimate mode" />
                <Field label="Labor Pricing Method">
                  <Input value={laborPricing} onChange={setLaborPricing} placeholder="e.g. hourly, flat rate…" />
                </Field>
              </div>
            </fieldset>
          </Section>
          <Section title="Service Area">
            <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
              <Field label="Service Area List (JSON array)">
                <Textarea
                  value={serviceAreaRaw}
                  onChange={setServiceAreaRaw}
                  rows={5}
                  placeholder='["New York, NY", "10001", "Brooklyn, NY"]'
                />
              </Field>
            </fieldset>
          </Section>
          {isOwner && (
            <div className="flex items-center gap-3">
              <SaveBtn
                onClick={() => {
                  let areaList: unknown;
                  try { areaList = JSON.parse(serviceAreaRaw); } catch { areaList = []; }
                  updateCfgSvc.mutate({
                    services_offered: services,
                    same_day_booking_allowed: sameDayBooking,
                    service_area_list: areaList,
                  });
                  updateBiz.mutate({
                    rough_estimate_mode_enabled: roughEstimate,
                    labor_pricing_method: laborPricing || undefined,
                  });
                }}
                isPending={updateCfgSvc.isPending || updateBiz.isPending}
                saved={svcSaved}
                disabled={false}
              />
              {(updateCfgSvc.isError || updateBiz.isError) && (
                <p className="text-xs" style={{ color: "#f87171" }}>
                  {updateCfgSvc.error?.message ?? updateBiz.error?.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Service Time Estimates (HVAC only) ──────────────────────────── */}
      {tab === "service_estimates" && <ServiceEstimatesTab isOwner={isOwner} />}

      {/* ── Business Hours ─────────────────────────────────────────────────── */}
      {tab === "hours" && (
        <div className="space-y-4">
          <Section title="Weekly Hours">
            <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
              <HoursEditor value={hours} onChange={setHours} />
            </fieldset>
          </Section>
          <Section title="Quiet Hours">
            <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
              <div className="flex items-end gap-3">
                <Field label="Start">
                  <select value={quietStart} onChange={(e) => setQuietStart(e.target.value)} style={timeSelectStyle}>
                    {TIME_SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <span className="mb-2 text-sm" style={{ color: "var(--t3)" }}>to</span>
                <Field label="End">
                  <select value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} style={timeSelectStyle}>
                    {TIME_SLOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
            </fieldset>
          </Section>
          {isOwner && (
            <div className="flex items-center gap-3">
              <SaveBtn
                onClick={() => {
                  updateCfgHours.mutate({ business_hours: hours });
                  updateBizHours.mutate({ quiet_hours_start: quietStart, quiet_hours_end: quietEnd });
                }}
                isPending={updateCfgHours.isPending || updateBizHours.isPending}
                saved={hoursSaved}
                disabled={false}
              />
              {(updateCfgHours.isError || updateBizHours.isError) && (
                <p className="text-xs" style={{ color: "#f87171" }}>
                  {updateCfgHours.error?.message ?? updateBizHours.error?.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Policies ───────────────────────────────────────────────────────── */}
      {tab === "policies" && (
        <Section title="Policies & Instructions">
          <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
            <div className="grid gap-4">
              <Field label="Cancellation Policy">
                <Textarea value={cancelPolicy} onChange={setCancelPolicy} />
              </Field>
              <Field label="Warranty Policy">
                <Textarea value={warranty} onChange={setWarranty} />
              </Field>
              <Field label="Payment Methods">
                <Input value={paymentMethods} onChange={setPaymentMethods} placeholder="e.g. Cash, Card, Venmo" />
              </Field>
              <Field label="Customer Prep">
                <Textarea value={customerPrep} onChange={setCustomerPrep} placeholder="What customers should do before service…" />
              </Field>
              <Field label="Emergency Rules">
                <Textarea value={emergencyRules} onChange={setEmergencyRules} />
              </Field>
              <Field label="Common Questions">
                <Textarea value={commonQs} onChange={setCommonQs} rows={4} />
              </Field>
              <Field label="Typical Process">
                <Textarea value={typicalProcess} onChange={setTypicalProcess} />
              </Field>
              <Field label="Important Details">
                <Textarea value={importantDetails} onChange={setImportantDetails} />
              </Field>
              <Field label="Customer Philosophy">
                <Textarea value={philosophy} onChange={setPhilosophy} />
              </Field>
              <Toggle value={paymentMgmt} onChange={setPaymentMgmt} label="Payment management enabled" />
            </div>
          </fieldset>
          {isOwner && (
            <div className="mt-5 flex items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <SaveBtn
                onClick={() =>
                  updatePol.mutate({
                    cancellation_policy: cancelPolicy || undefined,
                    warranty_policy: warranty || undefined,
                    payment_methods: paymentMethods || undefined,
                    customer_prep: customerPrep || undefined,
                    emergency_rules: emergencyRules || undefined,
                    common_questions: commonQs || undefined,
                    typical_process: typicalProcess || undefined,
                    important_details: importantDetails || undefined,
                    customer_philosophy: philosophy || undefined,
                    payment_management_enabled: paymentMgmt,
                  })
                }
                isPending={updatePol.isPending}
                saved={polSaved}
                disabled={false}
              />
              {updatePol.isError && (
                <p className="text-xs" style={{ color: "#f87171" }}>{updatePol.error.message}</p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Quotes & Auto-Close ────────────────────────────────────────────── */}
      {tab === "quotes" && (
        <Section title="Quotes & Auto-Close">
          <fieldset disabled={!isOwner} className="m-0 min-w-0 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quote Expiry (days)">
                <input
                  type="number"
                  min={1}
                  value={quoteExpiry}
                  onChange={(e) => setQuoteExpiry(parseInt(e.target.value) || 30)}
                  style={INPUT_STYLE}
                />
              </Field>
              <Field label="Auto-Close Conversations (days)">
                <input
                  type="number"
                  min={1}
                  value={autoClose}
                  onChange={(e) => setAutoClose(parseInt(e.target.value) || 30)}
                  style={INPUT_STYLE}
                />
              </Field>
            </div>
          </fieldset>
          {isOwner && (
            <div className="mt-5 flex items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <SaveBtn
                onClick={() =>
                  updateQuotes.mutate({ quote_expiry_days: quoteExpiry, auto_close_days: autoClose })
                }
                isPending={updateQuotes.isPending}
                saved={quoteSaved}
                disabled={false}
              />
              {updateQuotes.isError && (
                <p className="text-xs" style={{ color: "#f87171" }}>{updateQuotes.error.message}</p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Technicians ──────────────────────────────────────────────────── */}
      {tab === "technicians" && (
        <div className="space-y-4">
          <Section title="Technicians">
            <p className="text-xs mb-3" style={{ color: "var(--t3)" }}>
              Add technicians here. They appear in technician dropdowns when creating or managing appointments.
            </p>
            {!techList || techList.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--t3)" }}>No technicians added yet</p>
            ) : (
              <div className="space-y-2">
                {techList.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                  >
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    {isOwner && (
                      <button
                        onClick={() => removeTech.mutate({ name })}
                        disabled={removeTech.isPending}
                        className="rounded-lg px-2 py-1 text-xs font-medium transition-all duration-150 disabled:opacity-40"
                        style={{ color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.15)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isOwner && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={newTechName}
                  onChange={(e) => setNewTechName(e.target.value)}
                  placeholder="Technician name"
                  className="flex-1 rounded-lg px-3 py-2 text-xs"
                  style={SELECT_STYLE}
                  onKeyDown={(e) => { if (e.key === "Enter" && newTechName.trim()) addTech.mutate({ name: newTechName.trim() }); }}
                />
                <button
                  onClick={() => { if (newTechName.trim()) addTech.mutate({ name: newTechName.trim() }); }}
                  disabled={!newTechName.trim() || addTech.isPending}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
                >
                  {addTech.isPending ? "Adding..." : "Add Technician"}
                </button>
              </div>
            )}
            {addTech.isError && <p className="mt-2 text-xs" style={{ color: "#f87171" }}>{addTech.error.message}</p>}
            {removeTech.isError && <p className="mt-2 text-xs" style={{ color: "#f87171" }}>{removeTech.error.message}</p>}
          </Section>
        </div>
      )}

      {/* ── Team Management ────────────────────────────────────────────────── */}
      {tab === "team" && (
        <div className="space-y-4">
          <Section title="Team Members">
            {!team || team.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--t3)" }}>No team members yet</p>
            ) : (
              <div className="space-y-2">
                {team.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--t1)" }}>
                        {user.display_name ?? user.email}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--t3)" }}>{user.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                        style={
                          user.role === "owner"
                            ? { background: "var(--accent-dim)", color: "var(--accent-text)" }
                            : { background: "var(--bg-surface)", color: "var(--t2)", border: "1px solid var(--border)" }
                        }
                      >
                        {user.role}
                      </span>
                      {isOwner && (
                        <>
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const v = e.target.value as "owner" | "admin";
                              if (v) changeRole.mutate({ userId: user.id, newRole: v });
                              e.target.value = "";
                            }}
                            style={{ ...SELECT_STYLE, width: "auto", fontSize: "11px", padding: "4px 8px" }}
                          >
                            <option value="" disabled>Role…</option>
                            <option value="owner">Make Owner</option>
                            <option value="admin">Make Admin</option>
                          </select>
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${user.email} from your business?`)) {
                                removeUser.mutate({ userId: user.id });
                              }
                            }}
                            className="rounded-lg px-2 py-1 text-xs font-medium transition-all duration-150"
                            style={{ color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.15)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {changeRole.isError && (
              <p className="mt-2 text-xs" style={{ color: "#f87171" }}>{changeRole.error.message}</p>
            )}
            {removeUser.isError && (
              <p className="mt-2 text-xs" style={{ color: "#f87171" }}>{removeUser.error.message}</p>
            )}
          </Section>

          <Section title="Invite Admins">
            <p className="text-sm" style={{ color: "var(--t2)" }}>
              Share your join code:{" "}
              <span className="font-mono font-bold" style={{ color: "var(--t1)" }}>{data?.join_code}</span>
            </p>
            <button
              onClick={() => void navigator.clipboard.writeText(data?.join_code ?? "")}
              className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--t2)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--t1)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
            >
              Copy Join Code
            </button>
          </Section>
        </div>
      )}

      {/* ── Danger Zone ────────────────────────────────────────────────────── */}
      {tab === "danger" && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <h2 className="mb-4 text-sm font-semibold" style={{ color: "#f87171" }}>Danger Zone</h2>
          {isOwner ? (
            <div className="space-y-4">
              <Toggle
                value={isPaused}
                onChange={setIsPaused}
                label={isPaused ? "Business is PAUSED — AI won't respond" : "Business is active"}
              />
              {isPaused && (
                <Field label="Pause Message (shown to customers)">
                  <Textarea
                    value={pauseMsg}
                    onChange={setPauseMsg}
                    placeholder="We are temporarily unavailable…"
                    rows={2}
                  />
                </Field>
              )}
              <div className="flex items-center gap-3 pt-1">
                <SaveBtn
                  onClick={() => pauseMutation.mutate({ isPaused, pauseMessage: pauseMsg || undefined })}
                  isPending={pauseMutation.isPending}
                  saved={dangerSaved}
                  disabled={false}
                />
                {pauseMutation.isError && (
                  <p className="text-xs" style={{ color: "#f87171" }}>{pauseMutation.error.message}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--t2)" }}>
              Business status:{" "}
              <span
                className="font-medium"
                style={{ color: isPaused ? "#f87171" : "#4ade80" }}
              >
                {isPaused ? "Paused" : "Active"}
              </span>
              {isPaused && pauseMsg && (
                <span className="ml-1" style={{ color: "var(--t3)" }}>— {pauseMsg}</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Service Estimates Tab (HVAC) ──────────────────────────────────────────

function ServiceEstimatesTab({ isOwner }: { isOwner: boolean }) {
  const { data: estimates, isLoading, refetch } = api.serviceEstimates.list.useQuery();
  const { data: capData } = api.serviceEstimates.getOnsiteCap.useQuery();
  const updateMut = api.serviceEstimates.update.useMutation({ onSuccess: () => void refetch() });
  const addMut = api.serviceEstimates.addCustom.useMutation({ onSuccess: () => void refetch() });
  const deleteMut = api.serviceEstimates.deleteCustom.useMutation({ onSuccess: () => void refetch() });
  const seedMut = api.serviceEstimates.seedDefaults.useMutation({ onSuccess: () => void refetch() });
  const updateCap = api.serviceEstimates.updateOnsiteCap.useMutation();

  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<string>(HVAC_CATEGORIES[0]!);
  const [customMinutes, setCustomMinutes] = useState(30);
  const [onsiteCap, setOnsiteCap] = useState(150);
  const [capSaved, setCapSaved] = useState(false);

  useEffect(() => {
    if (capData) setOnsiteCap(capData.onsiteCapMinutes);
  }, [capData]);

  // Auto-seed if no estimates exist yet
  useEffect(() => {
    if (estimates && estimates.length === 0 && !seedMut.isPending) {
      seedMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimates]);

  if (isLoading) {
    return <p className="py-6 text-center text-sm" style={{ color: "var(--t3)" }}>Loading service estimates...</p>;
  }

  const required = (estimates ?? []).filter((e) => e.tier === "required");
  const optional = (estimates ?? []).filter((e) => e.tier === "optional");
  const custom = (estimates ?? []).filter((e) => e.tier === "custom");

  function groupByCategory<T extends { category: string }>(items: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return map;
  }

  const enabledOptional = optional.filter((o) => o.is_active).length;

  return (
    <div className="space-y-6">
      {/* On-Site Cap */}
      <Section title="On-Site Time Cap">
        <p className="mb-2 text-xs" style={{ color: "var(--t3)" }}>
          Maximum minutes a tech should spend on a single visit before scheduling a return.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={30}
            max={480}
            value={onsiteCap}
            onChange={(e) => { setOnsiteCap(parseInt(e.target.value) || 150); setCapSaved(false); }}
            disabled={!isOwner}
            className="w-24 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--t1)" }}
          />
          <span className="text-sm" style={{ color: "var(--t3)" }}>minutes</span>
          {isOwner && (
            <SaveBtn
              onClick={() => {
                updateCap.mutate({ onsiteCapMinutes: onsiteCap }, {
                  onSuccess: () => { setCapSaved(true); setTimeout(() => setCapSaved(false), 2000); },
                });
              }}
              isPending={updateCap.isPending}
              saved={capSaved}
              disabled={false}
            />
          )}
        </div>
      </Section>

      {/* Required Services */}
      <Section title="Required Services (30)">
        <p className="mb-3 text-xs" style={{ color: "var(--t3)" }}>
          Core services — adjust time estimates but cannot be deactivated.
        </p>
        {Array.from(groupByCategory(required).entries()).map(([cat, items]) => (
          <EstimateCategoryGroup
            key={cat}
            category={cat}
            items={items}
            showToggle={false}
            isOwner={isOwner}
            onUpdate={(id, mins) => updateMut.mutate({ id, estimatedMinutes: mins })}
          />
        ))}
      </Section>

      {/* Optional Services */}
      <Section title={`Additional Services (${enabledOptional} of ${optional.length} enabled)`}>
        <p className="mb-3 text-xs" style={{ color: "var(--t3)" }}>
          Enabling additional services drastically improves the AI&apos;s scheduling accuracy before inspection.
        </p>
        {Array.from(groupByCategory(optional).entries()).map(([cat, items]) => (
          <EstimateCategoryGroup
            key={cat}
            category={cat}
            items={items}
            showToggle={true}
            isOwner={isOwner}
            onUpdate={(id, mins) => updateMut.mutate({ id, estimatedMinutes: mins })}
            onToggle={(id, active) => updateMut.mutate({ id, isActive: active })}
          />
        ))}
      </Section>

      {/* Custom Services */}
      <Section title={`Custom Services (${custom.length})`}>
        {custom.length > 0 && (
          <div className="mb-4 space-y-1.5">
            {custom.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
              >
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--t1)" }}>
                  {item.name}
                </span>
                <span className="text-xs" style={{ color: "var(--t3)" }}>
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={item.estimated_minutes}
                  onChange={(e) =>
                    updateMut.mutate({ id: item.id, estimatedMinutes: parseInt(e.target.value) || 5 })
                  }
                  disabled={!isOwner}
                  className="w-16 rounded border px-2 py-1 text-right text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }}
                />
                <span className="text-xs" style={{ color: "var(--t3)" }}>min</span>
                {isOwner && (
                  <button
                    onClick={() => deleteMut.mutate({ id: item.id })}
                    className="text-xs font-medium"
                    style={{ color: "#ef4444" }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isOwner && (
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--t2)" }}>Add Custom Service</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Service name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="min-w-[140px] flex-1 rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--t1)" }}
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--t1)" }}
              >
                {HVAC_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
              <input
                type="number"
                min={5}
                max={600}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(parseInt(e.target.value) || 30)}
                className="w-20 rounded border px-2 py-1.5 text-right text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--t1)" }}
              />
              <span className="self-center text-xs" style={{ color: "var(--t3)" }}>min</span>
              <button
                onClick={() => {
                  if (!customName.trim()) return;
                  addMut.mutate(
                    { name: customName.trim(), category: customCategory, estimatedMinutes: customMinutes },
                    { onSuccess: () => { setCustomName(""); setCustomMinutes(30); } },
                  );
                }}
                disabled={!customName.trim() || addMut.isPending}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "#3b82f6" }}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function EstimateCategoryGroup({
  category,
  items,
  showToggle,
  isOwner,
  onUpdate,
  onToggle,
}: {
  category: string;
  items: { id: string; name: string; estimated_minutes: number; is_active: boolean }[];
  showToggle: boolean;
  isOwner: boolean;
  onUpdate: (id: string, minutes: number) => void;
  onToggle?: (id: string, active: boolean) => void;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t3)" }}>
        {CATEGORY_LABELS[category] ?? category}
      </p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2"
            style={{
              borderColor: item.is_active ? "var(--border)" : "var(--bg-hover)",
              background: item.is_active ? "var(--bg-surface)" : "var(--bg)",
              opacity: item.is_active ? 1 : 0.5,
            }}
          >
            {showToggle && onToggle && (
              <button
                type="button"
                onClick={() => isOwner && onToggle(item.id, !item.is_active)}
                disabled={!isOwner}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs"
                style={{
                  borderColor: item.is_active ? "#3b82f6" : "var(--border)",
                  background: item.is_active ? "#3b82f6" : "var(--bg-surface)",
                  color: item.is_active ? "#fff" : "transparent",
                }}
              >
                {item.is_active ? "\u2713" : ""}
              </button>
            )}
            <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--t1)" }}>
              {item.name}
            </span>
            <input
              type="number"
              min={5}
              max={600}
              value={item.estimated_minutes}
              onChange={(e) => onUpdate(item.id, parseInt(e.target.value) || 5)}
              disabled={!isOwner || (showToggle && !item.is_active)}
              className="w-16 rounded border px-2 py-1 text-right text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }}
            />
            <span className="text-xs" style={{ color: "var(--t3)" }}>min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
