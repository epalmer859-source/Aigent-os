// ============================================================
// src/engine/scheduling/hvac-service-defaults.ts
//
// Default HVAC service estimates — 30 required + 30 optional.
// Used during onboarding to seed the service_estimates table
// and in settings to show the full catalog.
// ============================================================

export interface HvacServiceDefault {
  name: string;
  category: string;
  estimatedMinutes: number;
  tier: "required" | "optional";
}

export const HVAC_CATEGORIES = [
  "diagnostic",
  "electrical",
  "thermostat",
  "motors",
  "refrigerant",
  "coils",
  "furnace",
  "heat_pump",
  "drainage",
  "air_quality",
  "ductwork",
  "installs",
  "maintenance",
] as const;

export type HvacCategory = (typeof HVAC_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  diagnostic: "Diagnostic",
  electrical: "Electrical",
  thermostat: "Thermostat",
  motors: "Motors & Fans",
  refrigerant: "Refrigerant & Compressor",
  coils: "Coils",
  furnace: "Furnace & Gas",
  heat_pump: "Heat Pump",
  drainage: "Drainage & Condensate",
  air_quality: "Air Quality",
  ductwork: "Ductwork",
  installs: "Full Installations",
  maintenance: "Maintenance & Tune-Ups",
};

// ── Required 30 — always active during onboarding ────────────────────────────

export const REQUIRED_SERVICES: HvacServiceDefault[] = [
  { name: "Diagnostic visit", category: "diagnostic", estimatedMinutes: 90, tier: "required" },
  { name: "Capacitor replacement", category: "electrical", estimatedMinutes: 30, tier: "required" },
  { name: "Contactor replacement", category: "electrical", estimatedMinutes: 35, tier: "required" },
  { name: "Circuit board replacement", category: "electrical", estimatedMinutes: 75, tier: "required" },
  { name: "Fuse replacement", category: "electrical", estimatedMinutes: 15, tier: "required" },
  { name: "Relay replacement", category: "electrical", estimatedMinutes: 25, tier: "required" },
  { name: "Thermostat replacement", category: "thermostat", estimatedMinutes: 30, tier: "required" },
  { name: "Smart thermostat installation", category: "thermostat", estimatedMinutes: 45, tier: "required" },
  { name: "Thermostat wiring repair", category: "thermostat", estimatedMinutes: 50, tier: "required" },
  { name: "Blower motor replacement", category: "motors", estimatedMinutes: 90, tier: "required" },
  { name: "Blower wheel cleaning", category: "motors", estimatedMinutes: 40, tier: "required" },
  { name: "Condenser fan motor replacement", category: "motors", estimatedMinutes: 60, tier: "required" },
  { name: "Condenser fan blade replacement", category: "motors", estimatedMinutes: 25, tier: "required" },
  { name: "Inducer motor replacement", category: "motors", estimatedMinutes: 75, tier: "required" },
  { name: "Refrigerant recharge (R-410A)", category: "refrigerant", estimatedMinutes: 60, tier: "required" },
  { name: "Refrigerant recharge (R-22)", category: "refrigerant", estimatedMinutes: 60, tier: "required" },
  { name: "Refrigerant leak detection", category: "refrigerant", estimatedMinutes: 50, tier: "required" },
  { name: "Refrigerant leak repair (minor)", category: "refrigerant", estimatedMinutes: 90, tier: "required" },
  { name: "Compressor replacement", category: "refrigerant", estimatedMinutes: 270, tier: "required" },
  { name: "Filter drier replacement", category: "refrigerant", estimatedMinutes: 40, tier: "required" },
  { name: "Evaporator coil cleaning", category: "coils", estimatedMinutes: 75, tier: "required" },
  { name: "Condenser coil cleaning", category: "coils", estimatedMinutes: 60, tier: "required" },
  { name: "Ignitor replacement", category: "furnace", estimatedMinutes: 35, tier: "required" },
  { name: "Flame sensor cleaning", category: "furnace", estimatedMinutes: 15, tier: "required" },
  { name: "Flame sensor replacement", category: "furnace", estimatedMinutes: 25, tier: "required" },
  { name: "Gas valve replacement", category: "furnace", estimatedMinutes: 75, tier: "required" },
  { name: "Burner assembly cleaning", category: "furnace", estimatedMinutes: 50, tier: "required" },
  { name: "Condensate drain clearing", category: "drainage", estimatedMinutes: 25, tier: "required" },
  { name: "Condensate pump replacement", category: "drainage", estimatedMinutes: 40, tier: "required" },
  { name: "Float switch replacement", category: "drainage", estimatedMinutes: 20, tier: "required" },
];

// ── Optional 30 — inactive by default, owner toggles on ──────────────────────

export const OPTIONAL_SERVICES: HvacServiceDefault[] = [
  { name: "Evaporator coil replacement", category: "coils", estimatedMinutes: 210, tier: "optional" },
  { name: "Condenser coil replacement", category: "coils", estimatedMinutes: 210, tier: "optional" },
  { name: "Heat exchanger replacement", category: "furnace", estimatedMinutes: 300, tier: "optional" },
  { name: "Flue pipe repair/replacement", category: "furnace", estimatedMinutes: 75, tier: "optional" },
  { name: "Gas leak detection + repair", category: "furnace", estimatedMinutes: 75, tier: "optional" },
  { name: "Pilot light repair/relight", category: "furnace", estimatedMinutes: 25, tier: "optional" },
  { name: "Thermocouple replacement", category: "furnace", estimatedMinutes: 25, tier: "optional" },
  { name: "Limit switch replacement", category: "furnace", estimatedMinutes: 25, tier: "optional" },
  { name: "Pressure switch replacement", category: "furnace", estimatedMinutes: 25, tier: "optional" },
  { name: "Rollout switch replacement", category: "furnace", estimatedMinutes: 25, tier: "optional" },
  { name: "Furnace ignition control module", category: "furnace", estimatedMinutes: 50, tier: "optional" },
  { name: "Heating element replacement", category: "furnace", estimatedMinutes: 50, tier: "optional" },
  { name: "Reversing valve replacement", category: "heat_pump", estimatedMinutes: 210, tier: "optional" },
  { name: "Defrost control board replacement", category: "heat_pump", estimatedMinutes: 50, tier: "optional" },
  { name: "TXV valve replacement", category: "heat_pump", estimatedMinutes: 120, tier: "optional" },
  { name: "Condensate drain line replacement", category: "drainage", estimatedMinutes: 40, tier: "optional" },
  { name: "Air filter replacement", category: "air_quality", estimatedMinutes: 15, tier: "optional" },
  { name: "UV light installation", category: "air_quality", estimatedMinutes: 45, tier: "optional" },
  { name: "UV bulb replacement", category: "air_quality", estimatedMinutes: 15, tier: "optional" },
  { name: "Duct repair (single section)", category: "ductwork", estimatedMinutes: 60, tier: "optional" },
  { name: "Duct sanitizing treatment", category: "ductwork", estimatedMinutes: 75, tier: "optional" },
  { name: "Central AC system install", category: "installs", estimatedMinutes: 420, tier: "optional" },
  { name: "Furnace installation", category: "installs", estimatedMinutes: 300, tier: "optional" },
  { name: "Heat pump system install", category: "installs", estimatedMinutes: 420, tier: "optional" },
  { name: "Mini-split installation (single zone)", category: "installs", estimatedMinutes: 300, tier: "optional" },
  { name: "System changeout", category: "installs", estimatedMinutes: 360, tier: "optional" },
  { name: "AC tune-up", category: "maintenance", estimatedMinutes: 60, tier: "optional" },
  { name: "Furnace tune-up", category: "maintenance", estimatedMinutes: 60, tier: "optional" },
  { name: "Full system tune-up", category: "maintenance", estimatedMinutes: 90, tier: "optional" },
  { name: "Emergency after-hours call", category: "diagnostic", estimatedMinutes: 30, tier: "optional" },
];

export const ALL_DEFAULT_SERVICES = [...REQUIRED_SERVICES, ...OPTIONAL_SERVICES];
