"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";

type Tab = "profile" | "team" | "technicians";

const TABS: { value: Tab; label: string }[] = [
  { value: "profile", label: "My Info" },
  { value: "team", label: "Team" },
  { value: "technicians", label: "Technicians" },
];

const ROLE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  owner:      { label: "Owner",      color: "#7c3aed", bg: "#ede9fe" },
  admin:      { label: "Manager",    color: "#2563eb", bg: "#dbeafe" },
  technician: { label: "Technician", color: "#059669", bg: "#d1fae5" },
};

export default function TechSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold" style={{ color: "var(--t1)" }}>
        Settings
      </h1>

      {/* Tab bar */}
      <div
        className="mb-6 flex gap-1 rounded-lg p-1"
        style={{ background: "var(--bg-hover)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className="flex-1 rounded-md px-4 py-2 text-sm font-medium transition"
            style={{
              background:
                activeTab === tab.value ? "var(--bg-elevated)" : "transparent",
              color: activeTab === tab.value ? "var(--t1)" : "var(--t3)",
              boxShadow:
                activeTab === tab.value
                  ? "0 1px 2px rgba(0,0,0,0.05)"
                  : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileTab />}
      {activeTab === "team" && <TeamTab />}
      {activeTab === "technicians" && <TechniciansTab />}
    </div>
  );
}

// ── Profile Tab ────────────────────────────────────────────────

function ProfileTab() {
  const { data: profile, isLoading, refetch } =
    api.techDashboard.myProfile.useQuery();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setPhone(profile.phone ?? "");
      setAddress(profile.home_base_address ?? "");
    }
  }, [profile]);

  const update = api.techDashboard.updateMyProfile.useMutation({
    onSuccess: () => {
      setSaved(true);
      void refetch();
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) {
    return <p className="text-sm" style={{ color: "var(--t3)" }}>Loading...</p>;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ name, phone, home_base_address: address });
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Card>
        <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--t1)" }}>
          My Information
        </h2>

        <div className="space-y-4">
          <Field label="Name" value={name} onChange={setName} required />
          <Field
            label="Phone Number"
            value={phone}
            onChange={setPhone}
            placeholder="(555) 123-4567"
          />
          <Field
            label="Home Address"
            value={address}
            onChange={setAddress}
            placeholder="123 Main St, City, ST 12345"
          />
        </div>

        {/* Working hours (read-only — set by owner) */}
        {profile && (
          <div className="mt-6">
            <h3
              className="mb-2 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--t3)" }}
            >
              Schedule (set by owner)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ReadOnlyField
                label="Working Hours"
                value={`${profile.working_hours_start} - ${profile.working_hours_end}`}
              />
              <ReadOnlyField
                label="Lunch Break"
                value={`${profile.lunch_start} - ${profile.lunch_end}`}
              />
            </div>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-xl bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
        >
          {update.isPending ? "Saving..." : "Save Changes"}
        </button>
        {saved && (
          <span className="text-sm font-medium text-green-600">Saved!</span>
        )}
        {update.isError && (
          <span className="text-sm text-red-600">{update.error.message}</span>
        )}
      </div>
    </form>
  );
}

// ── Team Tab ───────────────────────────────────────────────────

function TeamTab() {
  const { data: team, isLoading } = api.techDashboard.teamMembers.useQuery();

  if (isLoading) {
    return <p className="text-sm" style={{ color: "var(--t3)" }}>Loading...</p>;
  }

  if (!team || team.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--t3)" }}>
          No team members found.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--t1)" }}>
        Team Members
      </h2>
      <div className="space-y-2">
        {team.map((member) => {
          const roleInfo = ROLE_LABELS[member.role] ?? ROLE_LABELS.admin!;
          return (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-lg px-4 py-3"
              style={{ background: "var(--bg-hover)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{
                    background:
                      member.role === "owner"
                        ? "linear-gradient(135deg, #7c3aed, #6d28d9)"
                        : member.role === "technician"
                          ? "linear-gradient(135deg, #22c55e, #16a34a)"
                          : "linear-gradient(135deg, #3b82f6, #2563eb)",
                  }}
                >
                  {(member.display_name ?? member.email).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: "var(--t1)" }}
                  >
                    {member.display_name ?? member.email}
                  </p>
                  <p className="text-xs" style={{ color: "var(--t3)" }}>
                    {member.email}
                  </p>
                </div>
              </div>
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: roleInfo.bg, color: roleInfo.color }}
              >
                {roleInfo.label}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Technicians Tab ────────────────────────────────────────────

function TechniciansTab() {
  const { data: techs, isLoading } =
    api.techDashboard.allTechnicians.useQuery();

  if (isLoading) {
    return <p className="text-sm" style={{ color: "var(--t3)" }}>Loading...</p>;
  }

  if (!techs || techs.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--t3)" }}>
          No technicians found.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--t1)" }}>
        Technicians
      </h2>
      <div className="space-y-2">
        {techs.map((tech) => (
          <div
            key={tech.id}
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ background: "var(--bg-hover)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{
                  background: tech.is_active
                    ? "linear-gradient(135deg, #22c55e, #16a34a)"
                    : "#9ca3af",
                }}
              >
                {tech.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--t1)" }}
                >
                  {tech.name}
                </p>
                <p className="text-xs" style={{ color: "var(--t3)" }}>
                  {tech.phone ?? "No phone"}
                  {tech.home_base_address
                    ? ` \u00b7 ${tech.home_base_address}`
                    : ""}
                </p>
              </div>
            </div>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                background: tech.is_active ? "#d1fae5" : "#f3f4f6",
                color: tech.is_active ? "#065f46" : "#6b7280",
              }}
            >
              {tech.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Shared components ──────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" style={{ color: "var(--t2)" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-green-200"
        style={{
          background: "var(--bg)",
          borderColor: "var(--border)",
          color: "var(--t1)",
        }}
      />
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </p>
      <p className="text-sm" style={{ color: "var(--t1)" }}>
        {value}
      </p>
    </div>
  );
}
