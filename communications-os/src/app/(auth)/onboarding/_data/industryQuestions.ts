export interface IndustryQuestion {
  key: string;
  label: string;
  placeholder?: string;
}

export const INDUSTRY_QUESTIONS: Record<string, IndustryQuestion[]> = {
  house_cleaning: [
    { key: "products_used", label: "What cleaning products do you use?", placeholder: "e.g. Eco-friendly, client-supplied, etc." },
    { key: "bring_supplies", label: "Do you bring your own supplies?", placeholder: "Yes / No / Optional" },
    { key: "deep_clean_scope", label: "What does a deep clean include vs a standard clean?", placeholder: "Describe the difference..." },
  ],
  commercial_cleaning: [
    { key: "after_hours", label: "Do you work after business hours?", placeholder: "Yes, No, or flexible..." },
    { key: "floor_care", label: "Do you offer floor care (stripping, waxing)?", placeholder: "Yes / No" },
    { key: "contract_frequency", label: "What are your standard contract options?", placeholder: "e.g. Daily, weekly, bi-weekly..." },
  ],
  lawn_care: [
    { key: "equipment_type", label: "What equipment do you use?", placeholder: "e.g. Commercial zero-turn, push mower..." },
    { key: "disposal", label: "Do you haul away clippings/debris?", placeholder: "Yes, No, or extra charge..." },
    { key: "seasonal_services", label: "What seasonal services do you offer?", placeholder: "e.g. Aeration, overseeding, leaf removal..." },
  ],
  pressure_washing: [
    { key: "psi_range", label: "What PSI range do you operate at?", placeholder: "e.g. 1500-4000 PSI depending on surface..." },
    { key: "chemicals", label: "Do you use chemicals or detergents?", placeholder: "Yes / No / Surface-dependent..." },
    { key: "surfaces", label: "What surfaces do you specialize in?", placeholder: "e.g. Driveways, decks, siding, roofs..." },
  ],
  junk_removal: [
    { key: "prohibited_items", label: "What items do you NOT haul?", placeholder: "e.g. Hazardous waste, tires, paint..." },
    { key: "pricing_model", label: "How is pricing determined?", placeholder: "e.g. By volume/load, flat rate, weight..." },
    { key: "same_day", label: "Do you offer same-day service?", placeholder: "Yes / No / When available..." },
  ],
  painting: [
    { key: "paint_types", label: "What paint brands/types do you use?", placeholder: "e.g. Sherwin-Williams, client-chosen..." },
    { key: "prep_work", label: "What prep work is included?", placeholder: "e.g. Caulking, sanding, primer..." },
    { key: "interior_exterior", label: "Do you do interior, exterior, or both?", placeholder: "Both / Interior only / Exterior only" },
  ],
  garage_door: [
    { key: "brands_serviced", label: "What garage door brands do you service?", placeholder: "e.g. LiftMaster, Chamberlain, all brands..." },
    { key: "emergency_hours", label: "Do you offer emergency/after-hours service?", placeholder: "Yes / No / Extra charge..." },
    { key: "new_installations", label: "Do you install new doors?", placeholder: "Yes / No" },
  ],
  landscaping: [
    { key: "design_services", label: "Do you offer landscape design?", placeholder: "Yes / No / Referral..." },
    { key: "irrigation", label: "Do you install or service irrigation?", placeholder: "Yes / No" },
    { key: "seasonal_cleanup", label: "Do you offer seasonal cleanup?", placeholder: "Spring / Fall / Both / No" },
  ],
  handyman: [
    { key: "specialties", label: "What are your top 3 specialties?", placeholder: "e.g. Drywall, tile, fixture replacement..." },
    { key: "licensed_work", label: "Are you licensed for electrical/plumbing work?", placeholder: "Yes for minor / No / Refer out..." },
    { key: "minimum_job", label: "Is there a minimum job size or charge?", placeholder: "e.g. 1 hour minimum = $X" },
  ],
  appliance_repair: [
    { key: "brands_serviced", label: "What appliance brands do you service?", placeholder: "e.g. All major brands, LG, Samsung..." },
    { key: "parts_policy", label: "How do you handle parts sourcing?", placeholder: "OEM only, aftermarket OK, client provides..." },
    { key: "warranty_on_repairs", label: "Do you warranty your repairs?", placeholder: "e.g. 90 days parts and labor..." },
  ],
  tree_service: [
    { key: "stump_grinding", label: "Do you offer stump grinding?", placeholder: "Yes / No / Subcontract..." },
    { key: "debris_removal", label: "Do you haul away debris?", placeholder: "Included / Extra charge / Client keeps..." },
    { key: "emergency_service", label: "Do you handle storm/emergency calls?", placeholder: "Yes / No / Extra charge..." },
  ],
  pool_service: [
    { key: "chemical_type", label: "What chemicals do you use?", placeholder: "e.g. Chlorine, saltwater, bromine..." },
    { key: "equipment_repair", label: "Do you repair pool equipment?", placeholder: "Yes / No / Refer out..." },
    { key: "frequency_options", label: "What service frequency do you offer?", placeholder: "e.g. Weekly, bi-weekly, monthly..." },
  ],
  window_cleaning: [
    { key: "method", label: "What cleaning method do you use?", placeholder: "e.g. Traditional, water-fed pole, both..." },
    { key: "screen_service", label: "Do you clean screens?", placeholder: "Yes / No / Extra charge..." },
    { key: "high_rise", label: "Do you handle high-rise or commercial?", placeholder: "Yes / No / Residential only..." },
  ],
  flooring: [
    { key: "floor_types", label: "What flooring types do you install?", placeholder: "e.g. Hardwood, LVP, tile, carpet..." },
    { key: "subfloor_work", label: "Do you do subfloor repair/prep?", placeholder: "Yes / No / Extra charge..." },
    { key: "removal", label: "Do you remove old flooring?", placeholder: "Included / Extra / No..." },
  ],
  plumbing: [
    { key: "emergency_service", label: "Do you offer emergency service?", placeholder: "24/7 / Business hours / On-call..." },
    { key: "licensed_bonded", label: "Are you licensed and bonded?", placeholder: "Yes, state license #..." },
    { key: "water_heaters", label: "Do you install tankless water heaters?", placeholder: "Yes / No / Refer..." },
  ],
  hvac: [
    { key: "brands_serviced", label: "What HVAC brands do you service?", placeholder: "e.g. Carrier, Trane, Lennox, all..." },
    { key: "maintenance_plans", label: "Do you offer maintenance plans?", placeholder: "Yes / No / Description..." },
    { key: "emergency_service", label: "Do you offer emergency service?", placeholder: "24/7 / Business hours only..." },
  ],
  electrical: [
    { key: "licensed", label: "Are you a licensed electrician?", placeholder: "Yes, master/journeyman, state..." },
    { key: "panel_work", label: "Do you do panel upgrades?", placeholder: "Yes / No / Refer..." },
    { key: "ev_chargers", label: "Do you install EV chargers?", placeholder: "Yes / No" },
  ],
  auto_repair: [
    { key: "vehicle_types", label: "What vehicle types do you service?", placeholder: "e.g. Domestic, import, trucks, all..." },
    { key: "specialties", label: "What are your top specialties?", placeholder: "e.g. Brakes, engine, transmission..." },
    { key: "warranty_policy", label: "What warranty do you offer on repairs?", placeholder: "e.g. 12 months/12,000 miles..." },
  ],
  carpet_cleaning: [
    { key: "method", label: "What cleaning method do you use?", placeholder: "e.g. Hot water extraction, dry cleaning..." },
    { key: "stain_guarantee", label: "Do you guarantee stain removal?", placeholder: "Best effort / Guarantee / Depends on stain..." },
    { key: "drying_time", label: "Typical drying time?", placeholder: "e.g. 4-8 hours..." },
  ],
  gutter_service: [
    { key: "gutter_guard", label: "Do you install gutter guards?", placeholder: "Yes / No / Which brands..." },
    { key: "repairs", label: "Do you repair damaged gutters?", placeholder: "Yes / No / Replace only..." },
    { key: "downspouts", label: "Are downspouts included in cleaning?", placeholder: "Yes / Extra / No..." },
  ],
  detailing: [
    { key: "location", label: "Mobile or shop-based?", placeholder: "Mobile / Shop / Both..." },
    { key: "ceramic_coating", label: "Do you offer ceramic coating?", placeholder: "Yes / No" },
    { key: "packages", label: "What packages do you offer?", placeholder: "e.g. Basic, full detail, paint correction..." },
  ],
};

export const INDUSTRY_LABELS: Record<string, string> = {
  house_cleaning: "House Cleaning",
  commercial_cleaning: "Commercial Cleaning",
  lawn_care: "Lawn Care",
  pressure_washing: "Pressure Washing",
  junk_removal: "Junk Removal",
  painting: "Painting",
  garage_door: "Garage Door",
  landscaping: "Landscaping",
  handyman: "Handyman",
  appliance_repair: "Appliance Repair",
  tree_service: "Tree Service",
  pool_service: "Pool Service",
  window_cleaning: "Window Cleaning",
  flooring: "Flooring",
  plumbing: "Plumbing",
  hvac: "HVAC",
  electrical: "Electrical",
  auto_repair: "Auto Repair",
  carpet_cleaning: "Carpet Cleaning",
  gutter_service: "Gutter Service",
  detailing: "Detailing",
};

export const INDUSTRIES = Object.keys(INDUSTRY_LABELS) as Array<keyof typeof INDUSTRY_LABELS>;
