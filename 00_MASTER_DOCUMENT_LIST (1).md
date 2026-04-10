# Communications OS — Master Document List

## Your Complete, Audit-Clean Blueprint

**Date:** March 31, 2026
**Status:** All documents below are the final, patched, audit-resolved versions. Zero critical failures. Zero high-value gaps. Zero contradictions.

---

## ACTIVE DOCUMENTS (use these — this is your blueprint)

| # | File | What it is | Role |
|---|---|---|---|
| 01 | 01_Unified_State_Authority_FINAL.md | 33-state state machine, precedence, transitions, overrides | State machine source of truth |
| 02 | 02_Merged_Trigger_Authority_FINAL.md | Timing, cadences, quiet hours (configurable), follow-up ladders | Trigger/timing source of truth |
| 03 | 03_Communications_Rules_FINAL.md | AI behavior rules, handoff standards, 22 rule categories, email unsubscribe, multilingual | AI policy source of truth |
| 04 | 04_Source_of_Truth_FINAL.md | 33-entry arbitration map — what wins when systems disagree | Conflict resolution source of truth |
| 06 | 06_Neutral_Ambiguous_Authority_FINAL.md | How AI handles unclear/partial customer responses | Ambiguity handling source of truth |
| 07 | 07_Capabilities_Intake_Packs_FINAL.md | 40 AI capabilities, baseline operating layer | Capability source of truth |
| 08 | 08_Prohibitions_FINAL.md | 21 industry-specific prohibition sets + universal prohibition | Safety/liability source of truth |
| 09 | 09_Onboarding_Questionnaire_FINAL.md | 23 universal + 2-3 industry questions per business | Onboarding source of truth |
| 10 | 10_Dashboard_App_Specification_FINAL.md | 7-tab app layout, roles, actions, takeover model, settings | UI/UX source of truth |
| 11 | 11_Supplemental_Engineering_Contract_FINAL.md | Message-purpose catalog, admin action contracts, resume/restoration | Engineering contract source of truth |
| 12 | 12_Reference_Patch_v5.md | Schema tables, channel authorities, consent, calendar sync, system ops | Operations/schema source of truth |
| 13 | 13_Reference_Patch_v5_Addendum.md | Service area matching, message templates, voice edge cases, recurring admin actions | Addendum operations source of truth |
| 14 | 14_Blueprint_Patch_v6_Final_Audit_Resolution.md | All audit resolutions: new tables, operational decisions, contradiction fixes | Master resolution authority |
| 15 | 15_Schema_v6_Consolidated_Reference.md | Single-source schema: 29 tables, 19 enums, complete write authority | Migration/build source of truth |

**Total: 14 active documents.**

---

## RETIRED DOCUMENTS (do NOT use these)

| File | Status | Why |
|---|---|---|
| 05_Schema_Contract_v4_FINAL.md | RETIRED | Absorbed into Patch v5 + Patch v6. Replaced by consolidated schema (Doc 15). |
| Blueprint Patch v4 (not uploaded) | RETIRED | Absorbed into Patch v5 + later documents. |

---

## AUTHORITY PRECEDENCE (when documents conflict, higher number wins)

1. **14 — Blueprint Patch v6** (highest authority)
2. **13 — Patch v5 Addendum**
3. **12 — Patch v5**
4. **10 — Dashboard App Specification**
5. **11 — Supplemental Engineering Contract**
6. **01 — Unified State Authority**
7. **02 — Merged Trigger Authority**
8. **03 — Communications Rules**
9. **04 — Source of Truth Map**
10. **06 — Neutral and Ambiguous Authority**
11. **07 — Capabilities**
12. **08 — Prohibitions**
13. **09 — Onboarding Questionnaire**

**15 — Schema Consolidated Reference** is a convenience merge, not an authority. If it conflicts with the authority docs above, the authority docs win.

---

## HOW TO USE THIS FOR BUILD

**For schema/migrations:** Start with Doc 15 (consolidated schema). It has every table, every enum, every constraint, every write authority rule in one place.

**For AI behavior rules:** Docs 03, 06, 07, 08 define what the AI can do, can't do, and how it handles edge cases.

**For state machine:** Doc 01 defines all 33 states. Doc 02 defines all timing/triggers. Doc 11 Part 3 defines resume/restoration after overrides.

**For dashboard/app build:** Doc 10 defines the full UI contract. Doc 11 Part 2 defines every admin action. Doc 14 adds presence lock, web chat widget, calendar grace period.

**For message sending:** Doc 11 Part 1 defines every message purpose. Doc 12 Part 10 defines the suppression matrix. Doc 14 adds the quote collision rule.

**For onboarding:** Doc 09 defines the questions. Doc 12 Part 7 defines the data pipeline (raw + structured storage).

**For workers/crons:** Doc 14 Part 7 defines every background job with schedules.
