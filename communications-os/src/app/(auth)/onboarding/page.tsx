"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  INDUSTRY_QUESTIONS,
} from "./_data/industryQuestions";
import ServiceEstimatesStep, {
  buildInitialEstimates,
  type ServiceEstimateEntry,
} from "./_components/ServiceEstimatesStep";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

interface ServiceItem {
  name: string;
  description: string;
}

interface LanguageEntry {
  enabled: boolean;
  speaker: string;
}

interface FormData {
  // Step 1
  businessName: string;
  industry: string;
  timezone: string;
  joinCode: string;
  // Step 2
  urgentAlertPhone: string;
  urgentAlertEmail: string;
  urgentEmailEnabled: boolean;
  preferredPhoneNumber: string;
  // Step 3
  servicesOffered: ServiceItem[];
  servicesNotOffered: string;
  laborPricingMethod: string;
  laborCustomText: string;
  // Step 4
  businessHours: Record<string, DayHours>;
  appointmentTypes: string;
  sameDayBookingAllowed: boolean;
  holidaysClosures: string;
  // Step 5
  serviceAreaList: string;
  serviceAreaExclusions: string;
  // Step 6
  cancellationPolicy: string;
  warrantyPolicy: string;
  paymentMethods: string;
  customerPrep: string;
  // Step 7
  aiSignoffName: string;
  aiToneDescription: string;
  alwaysSay: string;
  neverSay: string;
  languagesData: Record<string, LanguageEntry>;
  // Step 8
  emergencyRules: string;
  commonQuestions: string;
  typicalProcess: string;
  importantDetails: string;
  googleReviewLink: string;
  customerPhilosophy: string;
  // Step 9
  industryAnswers: Record<string, string>;
  // HVAC service estimates (only used when industry === "hvac")
  serviceEstimates: ServiceEstimateEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];

const LANGUAGE_LIST = [
  { key: "english", label: "English", locked: true },
  { key: "spanish", label: "Spanish" },
  { key: "italian", label: "Italian" },
  { key: "french", label: "French" },
  { key: "portuguese", label: "Portuguese" },
];

const DEFAULT_LANGUAGES: Record<string, LanguageEntry> = {
  english: { enabled: true, speaker: "" },
  spanish: { enabled: false, speaker: "" },
  italian: { enabled: false, speaker: "" },
  french: { enabled: false, speaker: "" },
  portuguese: { enabled: false, speaker: "" },
};

function defaultHours(): Record<string, DayHours> {
  const hours: Record<string, DayHours> = {};
  DAYS.forEach((d) => {
    hours[d] = { open: "08:00", close: "17:00", closed: d === "sunday" };
  });
  return hours;
}

const INITIAL: FormData = {
  businessName: "",
  industry: "",
  timezone: "America/New_York",
  joinCode: "",
  urgentAlertPhone: "",
  urgentAlertEmail: "",
  urgentEmailEnabled: false,
  preferredPhoneNumber: "",
  servicesOffered: [{ name: "", description: "" }],
  servicesNotOffered: "",
  laborPricingMethod: "",
  laborCustomText: "",
  businessHours: defaultHours(),
  appointmentTypes: "",
  sameDayBookingAllowed: false,
  holidaysClosures: "",
  serviceAreaList: "",
  serviceAreaExclusions: "",
  cancellationPolicy: "",
  warrantyPolicy: "",
  paymentMethods: "",
  customerPrep: "",
  aiSignoffName: "",
  aiToneDescription: "",
  alwaysSay: "",
  neverSay: "",
  languagesData: { ...DEFAULT_LANGUAGES },
  emergencyRules: "",
  commonQuestions: "",
  typicalProcess: "",
  importantDetails: "",
  googleReviewLink: "",
  customerPhilosophy: "",
  industryAnswers: {},
  serviceEstimates: buildInitialEstimates(),
};

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaCls = inputCls + " min-h-[80px] resize-y";

// ─── TimezoneSelect ───────────────────────────────────────────────────────────

function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [times, setTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    function update() {
      const now = new Date();
      const t: Record<string, string> = {};
      for (const tz of US_TIMEZONES) {
        t[tz.value] = now.toLocaleTimeString("en-US", {
          timeZone: tz.value,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
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
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {US_TIMEZONES.map((tz) => (
        <option key={tz.value} value={tz.value}>
          {tz.label} Time{times[tz.value] ? ` (currently ${times[tz.value]})` : ""}
        </option>
      ))}
      {!isKnown && value && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}

// ─── LanguagePicker ───────────────────────────────────────────────────────────

function LanguagePicker({
  value,
  onChange,
}: {
  value: Record<string, LanguageEntry>;
  onChange: (v: Record<string, LanguageEntry>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {LANGUAGE_LIST.map((lang) => {
        const entry: LanguageEntry = value[lang.key] ?? {
          enabled: lang.locked ?? false,
          speaker: "",
        };
        return (
          <div key={lang.key} className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={entry.enabled}
                disabled={!!lang.locked}
                onChange={(e) => {
                  if (lang.locked) return;
                  onChange({
                    ...value,
                    [lang.key]: { ...entry, enabled: e.target.checked },
                  });
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className={lang.locked ? "font-medium" : ""}>{lang.label}</span>
              {lang.locked && (
                <span className="text-xs text-gray-400">(always enabled)</span>
              )}
            </label>
            {entry.enabled && (
              <input
                className={inputCls + " ml-6"}
                value={entry.speaker}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [lang.key]: { ...entry, speaker: e.target.value },
                  })
                }
                placeholder={`Team member who speaks ${lang.label} (e.g., Maria in the front office)`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function Step1({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Business Name *">
        <input
          className={inputCls}
          value={data.businessName}
          onChange={(e) => set("businessName", e.target.value)}
          placeholder="Smith's Plumbing LLC"
          required
        />
      </Field>
      <Field label="Industry *">
        <select
          className={inputCls}
          value={data.industry}
          onChange={(e) => set("industry", e.target.value)}
          required
        >
          <option value="">Select your industry…</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind} value={ind}>
              {INDUSTRY_LABELS[ind]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Timezone *" hint="Select the timezone your business operates in">
        <TimezoneSelect
          value={data.timezone}
          onChange={(v) => set("timezone", v)}
        />
      </Field>
      <Field
        label="Team Join Code *"
        hint="Your team members will use this code to join. Min 4 characters."
      >
        <input
          className={inputCls + " uppercase tracking-widest font-mono"}
          value={data.joinCode}
          onChange={(e) => set("joinCode", e.target.value.toUpperCase())}
          placeholder="SMITH42"
          minLength={4}
          required
        />
      </Field>
    </div>
  );
}

function Step2({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="Urgent Alert Phone"
        hint="Get a call/text when there's a safety issue or urgent escalation"
      >
        <input
          className={inputCls}
          value={data.urgentAlertPhone}
          onChange={(e) => set("urgentAlertPhone", e.target.value)}
          placeholder="+1 (555) 000-0000"
          type="tel"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2.5 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={data.urgentEmailEnabled}
            onChange={(e) => set("urgentEmailEnabled", e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Enable urgent email alerts
        </label>
        {data.urgentEmailEnabled && (
          <input
            className={inputCls}
            value={data.urgentAlertEmail}
            onChange={(e) => set("urgentAlertEmail", e.target.value)}
            placeholder="owner@yourbusiness.com"
            type="email"
          />
        )}
      </div>

      <Field
        label="Business Phone Number"
        hint="The number customers call — used by AI when giving contact info"
      >
        <input
          className={inputCls}
          value={data.preferredPhoneNumber}
          onChange={(e) => set("preferredPhoneNumber", e.target.value)}
          placeholder="+1 (555) 000-0000"
          type="tel"
        />
      </Field>
    </div>
  );
}

function Step3({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  const services = data.servicesOffered;

  function updateService(i: number, field: keyof ServiceItem, val: string) {
    const updated = services.map((s, idx) =>
      idx === i ? { ...s, [field]: val } : s,
    );
    set("servicesOffered", updated);
  }

  function addService() {
    set("servicesOffered", [...services, { name: "", description: "" }]);
  }

  function removeService(i: number) {
    if (services.length === 1) return;
    set("servicesOffered", services.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">
          Services You Offer *
        </p>
        <div className="flex flex-col gap-3">
          {services.map((svc, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 p-3 flex flex-col gap-2"
            >
              <input
                className={inputCls}
                value={svc.name}
                onChange={(e) => updateService(i, "name", e.target.value)}
                placeholder="Service name (e.g. Water Heater Installation)"
                required
              />
              <input
                className={inputCls}
                value={svc.description}
                onChange={(e) => updateService(i, "description", e.target.value)}
                placeholder="Short description (optional)"
              />
              {services.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeService(i)}
                  className="self-end text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addService}
            className="self-start rounded-lg border border-blue-200 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
          >
            + Add service
          </button>
        </div>
      </div>

      <Field
        label="Services You DON'T Offer"
        hint="Helps the AI deflect calls for work you don't do"
      >
        <textarea
          className={textareaCls}
          value={data.servicesNotOffered}
          onChange={(e) => set("servicesNotOffered", e.target.value)}
          placeholder="e.g. Commercial work, septic systems, gas lines..."
        />
      </Field>

      <Field label="How Do You Price Labor?">
        <select
          className={inputCls}
          value={data.laborPricingMethod}
          onChange={(e) => set("laborPricingMethod", e.target.value)}
        >
          <option value="">Select…</option>
          <option value="flat_rate">Flat rate per job</option>
          <option value="hourly">Hourly rate</option>
          <option value="estimate">Custom estimate per job</option>
          <option value="tiered">Tiered pricing</option>
          <option value="custom">Custom (describe below)</option>
        </select>
      </Field>

      {data.laborPricingMethod === "custom" && (
        <Field
          label="Describe Your Pricing Model"
          hint="Explain how you price your work so the AI can answer customer questions accurately"
        >
          <textarea
            className={textareaCls}
            value={data.laborCustomText}
            onChange={(e) => set("laborCustomText", e.target.value)}
            placeholder="e.g. We charge a $75 diagnostic fee, then quote parts + labor separately. Labor is $95/hr for standard work, $140/hr for emergency calls..."
          />
        </Field>
      )}
    </div>
  );
}

function Step4({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  function updateHours(day: string, field: keyof DayHours, val: string | boolean) {
    set("businessHours", {
      ...data.businessHours,
      [day]: { ...data.businessHours[day], [field]: val },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">Business Hours</p>
        <div className="flex flex-col gap-2">
          {DAYS.map((day) => {
            const h = data.businessHours[day]!;
            return (
              <div key={day} className="flex items-center gap-3">
                <span className="w-24 text-sm capitalize text-gray-600">{day}</span>
                {h.closed ? (
                  <span className="text-sm text-gray-400">Closed</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={h.open}
                      onChange={(e) => updateHours(day, "open", e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="time"
                      value={h.close}
                      onChange={(e) => updateHours(day, "close", e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </div>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-500">
                  <input
                    type="checkbox"
                    checked={h.closed}
                    onChange={(e) => updateHours(day, "closed", e.target.checked)}
                  />
                  Closed
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <Field label="Appointment Types" hint="What types of visits do you schedule?">
        <textarea
          className={textareaCls}
          value={data.appointmentTypes}
          onChange={(e) => set("appointmentTypes", e.target.value)}
          placeholder="e.g. Estimate, Installation, Repair, Maintenance..."
        />
      </Field>

      <Field label="Holidays / Closures" hint="When are you typically closed?">
        <textarea
          className={textareaCls}
          value={data.holidaysClosures}
          onChange={(e) => set("holidaysClosures", e.target.value)}
          placeholder="e.g. All major US holidays, last 2 weeks of December..."
        />
      </Field>

      <label className="flex items-center gap-3 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={data.sameDayBookingAllowed}
          onChange={(e) => set("sameDayBookingAllowed", e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        Allow same-day booking requests
      </label>
    </div>
  );
}

function Step5({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="Service Area"
        hint="List the cities, zip codes, or neighborhoods you serve"
      >
        <textarea
          className={textareaCls}
          value={data.serviceAreaList}
          onChange={(e) => set("serviceAreaList", e.target.value)}
          placeholder="e.g. Atlanta, GA; Decatur, GA; Zip codes 30301-30350..."
        />
      </Field>
      <Field
        label="Areas You Don't Service"
        hint="Optional — helps the AI decline out-of-area requests"
      >
        <textarea
          className={textareaCls}
          value={data.serviceAreaExclusions}
          onChange={(e) => set("serviceAreaExclusions", e.target.value)}
          placeholder="e.g. We don't travel more than 30 miles from downtown..."
        />
      </Field>
    </div>
  );
}

function Step6({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Cancellation Policy">
        <textarea
          className={textareaCls}
          value={data.cancellationPolicy}
          onChange={(e) => set("cancellationPolicy", e.target.value)}
          placeholder="e.g. 24-hour notice required. Late cancellations may incur a $75 fee..."
        />
      </Field>
      <Field label="Warranty Policy">
        <textarea
          className={textareaCls}
          value={data.warrantyPolicy}
          onChange={(e) => set("warrantyPolicy", e.target.value)}
          placeholder="e.g. 1-year labor warranty, manufacturer warranty on parts..."
        />
      </Field>
      <Field label="Accepted Payment Methods">
        <textarea
          className={textareaCls}
          value={data.paymentMethods}
          onChange={(e) => set("paymentMethods", e.target.value)}
          placeholder="e.g. Cash, check, Venmo, credit card (3% fee)..."
        />
      </Field>
      <Field
        label="Customer Preparation Instructions"
        hint="What should customers do before you arrive?"
      >
        <textarea
          className={textareaCls}
          value={data.customerPrep}
          onChange={(e) => set("customerPrep", e.target.value)}
          placeholder="e.g. Clear the area around the water heater, ensure access to the breaker panel..."
        />
      </Field>
    </div>
  );
}

function Step7({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="AI Name (first message only)"
        hint="The AI will introduce itself with this name in its first message to each new customer. It won't sign off on every message."
      >
        <input
          className={inputCls}
          value={data.aiSignoffName}
          onChange={(e) => set("aiSignoffName", e.target.value)}
          placeholder='e.g. "Alex from Smith Plumbing"'
        />
      </Field>
      <Field
        label="AI Tone"
        hint="Describe how you want the AI to communicate with customers"
      >
        <textarea
          className={textareaCls}
          value={data.aiToneDescription}
          onChange={(e) => set("aiToneDescription", e.target.value)}
          placeholder="e.g. Friendly and professional but not overly formal. Direct and helpful..."
        />
      </Field>
      <Field label="Always Say" hint="Phrases the AI should always include or emphasize">
        <textarea
          className={textareaCls}
          value={data.alwaysSay}
          onChange={(e) => set("alwaysSay", e.target.value)}
          placeholder="e.g. Always mention our 24-hour emergency line. Always confirm the address..."
        />
      </Field>
      <Field label="Never Say" hint="Topics or phrases the AI must avoid">
        <textarea
          className={textareaCls}
          value={data.neverSay}
          onChange={(e) => set("neverSay", e.target.value)}
          placeholder="e.g. Never quote prices over text. Never mention competitors..."
        />
      </Field>
      <Field label="Supported Languages">
        <LanguagePicker
          value={data.languagesData}
          onChange={(v) => set("languagesData", v)}
        />
      </Field>
    </div>
  );
}

function Step8({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Emergency Rules" hint="How should the AI handle emergency situations?">
        <textarea
          className={textareaCls}
          value={data.emergencyRules}
          onChange={(e) => set("emergencyRules", e.target.value)}
          placeholder="e.g. If customer mentions water gushing, instruct them to shut off the main immediately..."
        />
      </Field>
      <Field label="Common Customer Questions" hint="FAQ the AI should know by heart">
        <textarea
          className={textareaCls}
          value={data.commonQuestions}
          onChange={(e) => set("commonQuestions", e.target.value)}
          placeholder="e.g. Q: Do you offer financing? A: Yes, through GreenSky. Q: Are you licensed? A: Yes, license #..."
        />
      </Field>
      <Field label="Typical Job Process" hint="Walk the customer through what to expect">
        <textarea
          className={textareaCls}
          value={data.typicalProcess}
          onChange={(e) => set("typicalProcess", e.target.value)}
          placeholder="e.g. 1. Free estimate visit. 2. Written quote within 24hrs. 3. Schedule install. 4. Same-day cleanup..."
        />
      </Field>
      <Field label="Important Details" hint="Anything else the AI needs to know">
        <textarea
          className={textareaCls}
          value={data.importantDetails}
          onChange={(e) => set("importantDetails", e.target.value)}
          placeholder="e.g. We are family-owned since 1998. Our techs wear shoe covers. We're BBB A+ rated..."
        />
      </Field>
      <Field label="Google Review Link" hint="Paste your Google review URL here">
        <input
          className={inputCls}
          value={data.googleReviewLink}
          onChange={(e) => set("googleReviewLink", e.target.value)}
          placeholder="https://g.page/r/..."
          type="url"
        />
      </Field>
      <Field label="Customer Philosophy">
        <textarea
          className={textareaCls}
          value={data.customerPhilosophy}
          onChange={(e) => set("customerPhilosophy", e.target.value)}
          placeholder="e.g. We treat every home like it's our own. We never upsell what you don't need..."
        />
      </Field>
    </div>
  );
}

function Step9({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  const industryQuestions = INDUSTRY_QUESTIONS[data.industry] ?? [];

  function setAnswer(key: string, value: string) {
    set("industryAnswers", { ...data.industryAnswers, [key]: value });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-gray-500">
        These questions help the AI give accurate answers about your specific business.
      </p>

      {/* Parts process — always shown */}
      <Field
        label="How does your parts/materials process work?"
        hint="Describe how you handle ordering parts, checking availability, and communicating parts costs to customers"
      >
        <textarea
          className={textareaCls}
          value={data.industryAnswers["parts_process"] ?? ""}
          onChange={(e) => setAnswer("parts_process", e.target.value)}
          placeholder="e.g. We stock common parts on our trucks. For special orders we check availability same-day and quote the customer before ordering. Parts costs are itemized on all invoices..."
        />
      </Field>

      {/* Industry-specific questions */}
      {industryQuestions.map((q) => (
        <Field key={q.key} label={q.label}>
          <textarea
            className={textareaCls}
            value={data.industryAnswers[q.key] ?? ""}
            onChange={(e) => setAnswer(q.key, e.target.value)}
            placeholder={q.placeholder}
          />
        </Field>
      ))}

      {industryQuestions.length === 0 && (
        <p className="text-sm text-gray-400">
          No additional industry questions — click Next to continue.
        </p>
      )}
    </div>
  );
}

// ─── Step10 with inline editing ───────────────────────────────────────────────

type EditType = "input" | "textarea" | "tz-select" | "ind-select" | "none";

interface ReviewRowDef {
  key: string;
  label: string;
  display: string;
  fieldKey: keyof FormData;
  editType: EditType;
  editRaw: string;
}

function Step10({
  data,
  set,
}: {
  data: FormData;
  set: (k: keyof FormData, v: unknown) => void;
}) {
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const enabledLangs = Object.entries(data.languagesData)
    .filter(([, e]) => e.enabled)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
    .join(", ");

  const laborDisplay =
    data.laborPricingMethod === "custom"
      ? data.laborCustomText || "Custom (no description)"
      : data.laborPricingMethod || "—";

  const rows: ReviewRowDef[] = [
    { key: "businessName", label: "Business Name", display: data.businessName || "—", fieldKey: "businessName", editType: "input", editRaw: data.businessName },
    { key: "industry", label: "Industry", display: (INDUSTRY_LABELS[data.industry] ?? data.industry) || "—", fieldKey: "industry", editType: "ind-select", editRaw: data.industry },
    { key: "timezone", label: "Timezone", display: data.timezone, fieldKey: "timezone", editType: "tz-select", editRaw: data.timezone },
    { key: "joinCode", label: "Join Code", display: data.joinCode || "—", fieldKey: "joinCode", editType: "input", editRaw: data.joinCode },
    { key: "urgentPhone", label: "Urgent Phone", display: data.urgentAlertPhone || "—", fieldKey: "urgentAlertPhone", editType: "input", editRaw: data.urgentAlertPhone },
    { key: "urgentEmail", label: "Urgent Email", display: data.urgentEmailEnabled ? (data.urgentAlertEmail || "—") : "Not enabled", fieldKey: "urgentAlertEmail", editType: data.urgentEmailEnabled ? "input" : "none", editRaw: data.urgentAlertEmail },
    { key: "bizPhone", label: "Business Phone", display: data.preferredPhoneNumber || "—", fieldKey: "preferredPhoneNumber", editType: "input", editRaw: data.preferredPhoneNumber },
    { key: "aiName", label: "AI Name (first message only)", display: data.aiSignoffName || "—", fieldKey: "aiSignoffName", editType: "input", editRaw: data.aiSignoffName },
    { key: "aiTone", label: "AI Tone", display: data.aiToneDescription || "—", fieldKey: "aiToneDescription", editType: "textarea", editRaw: data.aiToneDescription },
    { key: "cancelPolicy", label: "Cancellation Policy", display: data.cancellationPolicy || "—", fieldKey: "cancellationPolicy", editType: "textarea", editRaw: data.cancellationPolicy },
    { key: "warrantyPolicy", label: "Warranty Policy", display: data.warrantyPolicy || "—", fieldKey: "warrantyPolicy", editType: "textarea", editRaw: data.warrantyPolicy },
    { key: "serviceArea", label: "Service Area", display: data.serviceAreaList || "—", fieldKey: "serviceAreaList", editType: "textarea", editRaw: data.serviceAreaList },
    { key: "labor", label: "Labor Pricing", display: laborDisplay, fieldKey: "laborPricingMethod", editType: "none", editRaw: data.laborPricingMethod },
    { key: "sameday", label: "Same-day Booking", display: data.sameDayBookingAllowed ? "Yes" : "No", fieldKey: "sameDayBookingAllowed", editType: "none", editRaw: "" },
    { key: "languages", label: "Languages", display: enabledLangs || "English", fieldKey: "languagesData", editType: "none", editRaw: "" },
    { key: "services", label: "Services", display: data.servicesOffered.map((s) => s.name).filter(Boolean).join(", ") || "—", fieldKey: "servicesOffered", editType: "none", editRaw: "" },
  ];

  function startEdit(row: ReviewRowDef) {
    setEditField(row.key);
    setEditValue(row.editRaw);
  }

  function saveEdit(row: ReviewRowDef) {
    set(row.fieldKey, editValue);
    setEditField(null);
  }

  function cancelEdit() {
    setEditField(null);
  }

  const editInputCls =
    "w-full rounded-lg border border-blue-400 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Review your answers and click Submit to create your account. Click the pencil to edit any field.
      </p>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => {
              const isEditing = editField === row.key;
              return (
                <tr key={row.key} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-600 w-44 align-top">
                    {row.label}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">
                    {isEditing ? (
                      <div className="flex flex-col gap-1.5">
                        {row.editType === "input" && (
                          <input
                            className={editInputCls}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                          />
                        )}
                        {row.editType === "textarea" && (
                          <textarea
                            className={editInputCls + " min-h-[70px] resize-y"}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                          />
                        )}
                        {row.editType === "tz-select" && (
                          <TimezoneSelect
                            value={editValue}
                            onChange={setEditValue}
                          />
                        )}
                        {row.editType === "ind-select" && (
                          <select
                            className={editInputCls}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                          >
                            <option value="">Select…</option>
                            {INDUSTRIES.map((ind) => (
                              <option key={ind} value={ind}>
                                {INDUSTRY_LABELS[ind]}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(row)}
                            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                          >
                            ✓ Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <span className="whitespace-pre-wrap">{row.display}</span>
                        {row.editType !== "none" && (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                            title="Edit"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Step metadata ────────────────────────────────────────────────────────────

const BASE_STEPS = [
  { key: "basics", title: "Business Basics", subtitle: "Let's start with the essentials" },
  { key: "contact", title: "Contact Info", subtitle: "How we reach you for urgent issues" },
  { key: "services", title: "Services", subtitle: "What you do and how you price it" },
  { key: "service_estimates", title: "Service Time Estimates", subtitle: "How long each job type takes your team", hvacOnly: true },
  { key: "scheduling", title: "Scheduling", subtitle: "When you work and how jobs are booked" },
  { key: "area", title: "Service Area", subtitle: "Where you operate" },
  { key: "policies", title: "Policies", subtitle: "Your rules and payment methods" },
  { key: "ai_personality", title: "AI Personality", subtitle: "How the AI talks to your customers" },
  { key: "story", title: "Business Story", subtitle: "Background the AI needs to know" },
  { key: "industry", title: "Industry Details", subtitle: "A few questions specific to your trade" },
  { key: "review", title: "Review & Submit", subtitle: "Everything look right?" },
] as const;

function getSteps(industry: string) {
  if (industry === "hvac") return BASE_STEPS;
  return BASE_STEPS.filter((s) => !("hvacOnly" in s && s.hvacOnly));
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { update } = useSession();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>(INITIAL);
  const [submitError, setSubmitError] = useState("");
  const STEPS = getSteps(data.industry);

  function set(key: keyof FormData, value: unknown) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  const saveEstimates = api.serviceEstimates.saveFromOnboarding.useMutation();

  const completeMutation = api.onboarding.complete.useMutation({
    onSuccess: async () => {
      // Save HVAC service estimates if this is an HVAC business
      if (data.industry === "hvac" && data.serviceEstimates.length > 0) {
        try {
          await saveEstimates.mutateAsync(data.serviceEstimates);
        } catch {
          // Non-blocking — estimates can be configured in settings later
          console.warn("[onboarding] Failed to save service estimates");
        }
      }
      await update(); // triggers jwt callback → re-fetches businessId from DB
      router.push("/dashboard/urgent");
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  function handleNext() {
    if (step < STEPS.length - 1) setStep(step + 1);
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
    setSubmitError("");
  }

  function handleSubmit() {
    setSubmitError("");
    const validServices = data.servicesOffered.filter((s) => s.name.trim());

    // Compute labor pricing method value
    const laborPricingMethod =
      data.laborPricingMethod === "custom"
        ? data.laborCustomText || null
        : data.laborPricingMethod || null;

    completeMutation.mutate({
      businessName: data.businessName,
      industry: data.industry as Parameters<typeof completeMutation.mutate>[0]["industry"],
      timezone: data.timezone,
      joinCode: data.joinCode,
      urgentAlertPhone: data.urgentAlertPhone || undefined,
      urgentAlertEmail: data.urgentEmailEnabled ? (data.urgentAlertEmail || undefined) : undefined,
      preferredPhoneNumber: data.preferredPhoneNumber || undefined,
      servicesOffered: validServices.length
        ? validServices
        : [{ name: "General Services" }],
      servicesNotOffered: data.servicesNotOffered || undefined,
      laborPricingMethod,
      businessHours: data.businessHours,
      appointmentTypes: data.appointmentTypes || undefined,
      sameDayBookingAllowed: data.sameDayBookingAllowed,
      holidaysClosures: data.holidaysClosures || undefined,
      serviceAreaList: data.serviceAreaList || undefined,
      serviceAreaExclusions: data.serviceAreaExclusions || undefined,
      cancellationPolicy: data.cancellationPolicy || undefined,
      warrantyPolicy: data.warrantyPolicy || undefined,
      paymentMethods: data.paymentMethods || undefined,
      customerPrep: data.customerPrep || undefined,
      aiSignoffName: data.aiSignoffName || undefined,
      aiToneDescription: data.aiToneDescription || undefined,
      alwaysSay: data.alwaysSay || undefined,
      neverSay: data.neverSay || undefined,
      supportedLanguages: JSON.stringify(data.languagesData),
      emergencyRules: data.emergencyRules || undefined,
      commonQuestions: data.commonQuestions || undefined,
      typicalProcess: data.typicalProcess || undefined,
      importantDetails: data.importantDetails || undefined,
      googleReviewLink: data.googleReviewLink || undefined,
      customerPhilosophy: data.customerPhilosophy || undefined,
      industryAnswers: data.industryAnswers,
    });
  }

  const currentStep = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const isPending = completeMutation.isPending;

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 py-10 px-4">
      <div className="w-full max-w-2xl">
        {/* Progress bar */}
        <div className="mb-6">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-0.5 text-xl font-semibold text-gray-900">
            {currentStep.title}
          </h2>
          <p className="mb-6 text-sm text-gray-500">{currentStep.subtitle}</p>

          {currentStep.key === "basics" && <Step1 data={data} set={set} />}
          {currentStep.key === "contact" && <Step2 data={data} set={set} />}
          {currentStep.key === "services" && <Step3 data={data} set={set} />}
          {currentStep.key === "service_estimates" && (
            <ServiceEstimatesStep
              estimates={data.serviceEstimates}
              onChange={(updated) => set("serviceEstimates", updated)}
            />
          )}
          {currentStep.key === "scheduling" && <Step4 data={data} set={set} />}
          {currentStep.key === "area" && <Step5 data={data} set={set} />}
          {currentStep.key === "policies" && <Step6 data={data} set={set} />}
          {currentStep.key === "ai_personality" && <Step7 data={data} set={set} />}
          {currentStep.key === "story" && <Step8 data={data} set={set} />}
          {currentStep.key === "industry" && <Step9 data={data} set={set} />}
          {currentStep.key === "review" && <Step10 data={data} set={set} />}

          {submitError && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {submitError}
            </p>
          )}

          {/* Navigation */}
          <div className="mt-8 flex justify-between">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-30"
            >
              Back
            </button>

            {isLast ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {isPending ? "Saving…" : "Submit & Go to Dashboard"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
