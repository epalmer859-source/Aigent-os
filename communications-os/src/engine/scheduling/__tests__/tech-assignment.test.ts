// ============================================================
// Tech Assignment Scoring — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Capacity is queue-based (getTechProfile + getQueueForTechDate).
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  filterQualifiedTechs,
  scoreTech,
  rankTechs,
  assignTech,
  validateSkillCoverage,
  type TechCandidate,
  type AssignmentInput,
  type ScoredTechInput,
  type TechAssignmentDb,
} from "../tech-assignment";
import type { QueuedJob } from "../queue-insertion";
import type { OsrmServiceDeps } from "../osrm-service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-08");

function makeTech(overrides: Partial<TechCandidate> = {}): TechCandidate {
  return {
    id: "tech-1",
    businessId: "biz-1",
    name: "Alice",
    homeBaseLat: 33.749,
    homeBaseLng: -84.388,
    skillTags: ["st-hvac"],
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "12:30",
    overtimeCapMinutes: 0,
    isActive: true,
    ...overrides,
  };
}

const ASSIGNMENT: AssignmentInput = {
  serviceTypeId: "st-hvac",
  addressLat: 33.80,
  addressLng: -84.40,
  date: TODAY,
  timePreference: "NO_PREFERENCE",
  totalCostMinutes: 100,
};

function mockOsrmDeps(fixedMinutes: number): OsrmServiceDeps {
  return {
    baseUrl: "http://test:5000",
    fetchFn: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ duration: fixedMinutes * 60, distance: fixedMinutes * 1000 }],
      }),
    }),
    logger: { warn: vi.fn() },
  };
}

function makeEmptyDb(): TechAssignmentDb {
  return {
    async getQueueForTechDate() { return []; },
  };
}

function makeQueuedJob(durationMinutes: number, overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: `filler-${Math.random().toString(36).slice(2, 8)}`,
    queuePosition: 0,
    status: "NOT_STARTED",
    timePreference: "NO_PREFERENCE",
    addressLat: 33.75,
    addressLng: -84.39,
    manualPosition: false,
    estimatedDurationMinutes: durationMinutes,
    driveTimeMinutes: 0,
    ...overrides,
  };
}

function makeDbWithQueue(techId: string, queue: QueuedJob[]): TechAssignmentDb {
  return {
    async getQueueForTechDate(id) {
      return id === techId ? queue : [];
    },
  };
}

// ── filterQualifiedTechs ──────────────────────────────────────────────────────

describe("filterQualifiedTechs", () => {
  it("filters inactive techs", async () => {
    const techs = [makeTech({ isActive: false })];
    const db = makeEmptyDb();

    const result = await filterQualifiedTechs(techs, ASSIGNMENT, db);
    expect(result).toHaveLength(0);
  });

  it("filters missing skill tag", async () => {
    const techs = [makeTech({ skillTags: ["st-plumbing"] })];
    const db = makeEmptyDb();

    const result = await filterQualifiedTechs(techs, ASSIGNMENT, db);
    expect(result).toHaveLength(0);
  });

  it("filters no remaining capacity", async () => {
    const tech = makeTech();
    const db = makeDbWithQueue(tech.id, [makeQueuedJob(510)]);

    const result = await filterQualifiedTechs([tech], ASSIGNMENT, db);
    expect(result).toHaveLength(0);
  });

  it("MORNING preference respects sub-capacity", async () => {
    const tech = makeTech();
    // Fill morning with 200 min of MORNING-preference jobs
    const db = makeDbWithQueue(tech.id, [makeQueuedJob(200, { timePreference: "MORNING" })]);

    // Assignment needs 100 min MORNING — only 40 left in morning
    const morningAssignment: AssignmentInput = {
      ...ASSIGNMENT,
      timePreference: "MORNING",
    };
    const result = await filterQualifiedTechs([tech], morningAssignment, db);
    expect(result).toHaveLength(0);
  });

  it("all three filters together", async () => {
    const active = makeTech({ id: "t-1", name: "Active Skilled" });
    const inactive = makeTech({ id: "t-2", name: "Inactive", isActive: false });
    const noSkill = makeTech({ id: "t-3", name: "No Skill", skillTags: [] });
    const techs = [active, inactive, noSkill];
    const db = makeEmptyDb();

    const result = await filterQualifiedTechs(techs, ASSIGNMENT, db);
    expect(result).toHaveLength(1);
    expect(result[0]!.tech.id).toBe("t-1");
  });

  it("empty input returns []", async () => {
    const db = makeEmptyDb();
    const result = await filterQualifiedTechs([], ASSIGNMENT, db);
    expect(result).toHaveLength(0);
  });
});

// ── scoreTech ─────────────────────────────────────────────────────────────────

describe("scoreTech", () => {
  it("returns mocked OSRM drive time", async () => {
    const tech = makeTech();
    const osrm = mockOsrmDeps(25);

    const result = await scoreTech(
      { tech, remainingCapacityMinutes: 400 },
      ASSIGNMENT,
      osrm,
    );
    expect(result.driveTimeMinutes).toBe(25);
  });

  it("returns remaining capacity from qualified input", async () => {
    const tech = makeTech();
    const osrm = mockOsrmDeps(10);

    const result = await scoreTech(
      { tech, remainingCapacityMinutes: 350 },
      ASSIGNMENT,
      osrm,
    );
    expect(result.remainingCapacityMinutes).toBe(350);
  });

  it("defaults existingJobsToday to 0 if missing", async () => {
    const tech = makeTech({ existingJobsToday: undefined });
    const osrm = mockOsrmDeps(10);

    const result = await scoreTech(
      { tech, remainingCapacityMinutes: 400 },
      ASSIGNMENT,
      osrm,
    );
    expect(result.existingJobsToday).toBe(0);
  });
});

// ── rankTechs ─────────────────────────────────────────────────────────────────

describe("rankTechs", () => {
  it("single candidate gets score 1.0", () => {
    const ranked = rankTechs([{
      techId: "t-1",
      techName: "Solo",
      driveTimeMinutes: 20,
      remainingCapacityMinutes: 400,
      existingJobsToday: 2,
    }]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBe(1);
    expect(ranked[0]!.proximityScore).toBe(1);
    expect(ranked[0]!.availabilityScore).toBe(1);
  });

  it("closer tech vs more available tech formula behaves correctly", () => {
    const ranked = rankTechs([
      { techId: "A", techName: "Close", driveTimeMinutes: 10, remainingCapacityMinutes: 200, existingJobsToday: 1 },
      { techId: "B", techName: "Available", driveTimeMinutes: 30, remainingCapacityMinutes: 500, existingJobsToday: 1 },
    ]);

    expect(ranked[0]!.techId).toBe("A");
    expect(ranked[1]!.techId).toBe("B");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("equal scores broken by fewer existingJobsToday", () => {
    const ranked = rankTechs([
      { techId: "busy", techName: "Busy", driveTimeMinutes: 20, remainingCapacityMinutes: 400, existingJobsToday: 5 },
      { techId: "free", techName: "Free", driveTimeMinutes: 20, remainingCapacityMinutes: 400, existingJobsToday: 1 },
    ]);

    expect(ranked[0]!.techId).toBe("free");
    expect(ranked[1]!.techId).toBe("busy");
  });

  it("next tie broken by lower driveTimeMinutes", () => {
    const ranked2 = rankTechs([
      { techId: "A", techName: "A", driveTimeMinutes: 20, remainingCapacityMinutes: 300, existingJobsToday: 2 },
      { techId: "B", techName: "B", driveTimeMinutes: 15, remainingCapacityMinutes: 300, existingJobsToday: 2 },
    ]);
    expect(ranked2[0]!.techId).toBe("B");
  });

  it("three-tech ordering correct", () => {
    const ranked = rankTechs([
      { techId: "close", techName: "Close", driveTimeMinutes: 5, remainingCapacityMinutes: 300, existingJobsToday: 2 },
      { techId: "mid", techName: "Mid", driveTimeMinutes: 15, remainingCapacityMinutes: 400, existingJobsToday: 1 },
      { techId: "far", techName: "Far", driveTimeMinutes: 30, remainingCapacityMinutes: 500, existingJobsToday: 0 },
    ]);

    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.techId).toBe("close");
    expect(ranked[1]!.techId).toBe("mid");
    expect(ranked[2]!.techId).toBe("far");
  });

  it("same drive time -> availability decides", () => {
    const ranked = rankTechs([
      { techId: "less", techName: "Less", driveTimeMinutes: 20, remainingCapacityMinutes: 200, existingJobsToday: 1 },
      { techId: "more", techName: "More", driveTimeMinutes: 20, remainingCapacityMinutes: 500, existingJobsToday: 1 },
    ]);

    expect(ranked[0]!.techId).toBe("more");
  });

  it("same availability -> proximity decides", () => {
    const ranked = rankTechs([
      { techId: "far", techName: "Far", driveTimeMinutes: 30, remainingCapacityMinutes: 400, existingJobsToday: 1 },
      { techId: "close", techName: "Close", driveTimeMinutes: 10, remainingCapacityMinutes: 400, existingJobsToday: 1 },
    ]);

    expect(ranked[0]!.techId).toBe("close");
  });
});

// ── assignTech ────────────────────────────────────────────────────────────────

describe("assignTech", () => {
  it("returns top-scored tech", async () => {
    const close = makeTech({ id: "close", name: "Close", homeBaseLat: 33.80, homeBaseLng: -84.40 });
    const far = makeTech({ id: "far", name: "Far", homeBaseLat: 34.00, homeBaseLng: -84.60 });
    const techs = [close, far];
    const db = makeEmptyDb();
    const osrm = mockOsrmDeps(15);

    const result = await assignTech(techs, ASSIGNMENT, db, osrm);
    expect(result.assigned).toBe(true);
    if (result.assigned) {
      expect(result.tech).toBeDefined();
    }
  });

  it("returns no_qualified_techs on skill mismatch", async () => {
    const techs = [makeTech({ skillTags: ["st-plumbing"] })];
    const db = makeEmptyDb();
    const osrm = mockOsrmDeps(10);

    const result = await assignTech(techs, ASSIGNMENT, db, osrm);
    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe("no_qualified_techs");
    }
  });

  it("returns no_capacity when skilled techs are full", async () => {
    const tech = makeTech();
    const db = makeDbWithQueue(tech.id, [makeQueuedJob(510)]);

    const osrm = mockOsrmDeps(10);
    const result = await assignTech([tech], ASSIGNMENT, db, osrm);
    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe("no_capacity");
    }
  });

  it("returns no_techs_available on empty input", async () => {
    const db = makeEmptyDb();
    const osrm = mockOsrmDeps(10);

    const result = await assignTech([], ASSIGNMENT, db, osrm);
    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe("no_techs_available");
    }
  });

  it("full pipeline mixed case works", async () => {
    const qualified = makeTech({ id: "good", name: "Good", skillTags: ["st-hvac"] });
    const inactive = makeTech({ id: "off", name: "Off", isActive: false });
    const wrongSkill = makeTech({ id: "wrong", name: "Wrong", skillTags: ["st-electric"] });
    const techs = [qualified, inactive, wrongSkill];
    const db = makeEmptyDb();
    const osrm = mockOsrmDeps(12);

    const result = await assignTech(techs, ASSIGNMENT, db, osrm);
    expect(result.assigned).toBe(true);
    if (result.assigned) {
      expect(result.tech.techId).toBe("good");
    }
  });
});

// ── validateSkillCoverage ─────────────────────────────────────────────────────

describe("validateSkillCoverage", () => {
  it("zero-tag tech warning", () => {
    const techs = [makeTech({ id: "t1", name: "No Tags", skillTags: [] })];
    const serviceTypes = [{ id: "st-hvac", name: "HVAC" }];

    const warnings = validateSkillCoverage(techs, serviceTypes);
    const techWarning = warnings.find((w) => w.type === "tech_has_no_tags");
    expect(techWarning).toBeDefined();
    expect(techWarning!.entityId).toBe("t1");
  });

  it("uncovered service type warning", () => {
    const techs = [makeTech({ skillTags: ["st-plumbing"] })];
    const serviceTypes = [{ id: "st-hvac", name: "HVAC Repair" }];

    const warnings = validateSkillCoverage(techs, serviceTypes);
    const stWarning = warnings.find((w) => w.type === "service_type_has_no_techs");
    expect(stWarning).toBeDefined();
    expect(stWarning!.entityId).toBe("st-hvac");
    expect(stWarning!.entityName).toBe("HVAC Repair");
  });

  it("full coverage returns []", () => {
    const techs = [
      makeTech({ id: "t1", skillTags: ["st-hvac", "st-electric"] }),
      makeTech({ id: "t2", skillTags: ["st-plumbing"] }),
    ];
    const serviceTypes = [
      { id: "st-hvac", name: "HVAC" },
      { id: "st-electric", name: "Electrical" },
      { id: "st-plumbing", name: "Plumbing" },
    ];

    const warnings = validateSkillCoverage(techs, serviceTypes);
    expect(warnings).toEqual([]);
  });

  it("inactive techs excluded from coverage", () => {
    const techs = [
      makeTech({ id: "t1", skillTags: ["st-hvac"], isActive: false }),
    ];
    const serviceTypes = [{ id: "st-hvac", name: "HVAC" }];

    const warnings = validateSkillCoverage(techs, serviceTypes);
    const stWarning = warnings.find((w) => w.type === "service_type_has_no_techs");
    expect(stWarning).toBeDefined();
  });
});
