import { z } from "zod";
import { TRPCError } from "@trpc/server";
import Anthropic from "@anthropic-ai/sdk";
import { createTRPCRouter, technicianProcedure } from "~/server/api/trpc";

// ── Claude client ──────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definitions for Claude ────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_my_schedule",
    description:
      "Get the technician's job queue for a specific date. Use this to look up what jobs are scheduled, their status, times, and details.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "ISO date string (YYYY-MM-DD). Defaults to today if not provided.",
        },
      },
      required: [],
    },
  },
  {
    name: "add_job_note",
    description:
      "Add or update a note on a specific job. Use this when the tech wants to leave a note about a job.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "The job ID" },
        note: { type: "string", description: "The note text to set" },
      },
      required: ["job_id", "note"],
    },
  },
  {
    name: "update_job_status",
    description:
      "Change the status of a job. Valid statuses: NOT_STARTED, EN_ROUTE, ARRIVED, IN_PROGRESS, COMPLETED, INCOMPLETE, NEEDS_REBOOK.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "The job ID" },
        status: {
          type: "string",
          enum: ["NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE", "NEEDS_REBOOK"],
          description: "The new status",
        },
        completion_note: {
          type: "string",
          enum: ["FIXED", "NEEDS_FOLLOWUP", "CUSTOMER_DECLINED"],
          description: "Required when status is COMPLETED or INCOMPLETE",
        },
      },
      required: ["job_id", "status"],
    },
  },
  {
    name: "request_schedule_change",
    description:
      "Request a schedule change that requires owner approval — like swapping jobs between days, requesting time off, or major rescheduling. This creates a notification for the owner.",
    input_schema: {
      type: "object" as const,
      properties: {
        request_type: {
          type: "string",
          enum: ["reschedule_job", "swap_jobs", "time_off", "other"],
          description: "Type of schedule change",
        },
        description: {
          type: "string",
          description: "Detailed description of what the tech is requesting",
        },
        job_id: {
          type: "string",
          description: "Related job ID, if applicable",
        },
        preferred_date: {
          type: "string",
          description: "Preferred new date (YYYY-MM-DD), if applicable",
        },
      },
      required: ["request_type", "description"],
    },
  },
];

// ── System prompt builder ──────────────────────────────────────

function buildSystemPrompt(techName: string, businessName: string): string {
  return `You are a scheduling assistant for ${techName}, a field technician at ${businessName}. You help manage their daily job schedule.

You have tools to:
- Look up their schedule for any day
- Add notes to jobs
- Update job statuses
- Request schedule changes (these get sent to the owner for approval)

Be concise and helpful. When the tech asks about their schedule, use the get_my_schedule tool first. When they want to make changes, confirm what they want before executing.

For simple changes (status updates, notes), go ahead and make them directly.
For bigger changes (rescheduling, time off, swapping days), use request_schedule_change to notify the owner.

Always be conversational and supportive. Use plain language, not technical jargon.`;
}

// ── Tool execution ─────────────────────────────────────────────

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: { db: any; technicianId: string; businessId: string },
): Promise<string> {
  switch (toolName) {
    case "get_my_schedule": {
      const dateStr =
        (toolInput.date as string) ?? new Date().toISOString().slice(0, 10);
      const targetDate = new Date(dateStr + "T00:00:00Z");

      const jobs = await ctx.db.scheduling_jobs.findMany({
        where: {
          technician_id: ctx.technicianId,
          scheduled_date: targetDate,
        },
        include: {
          customers: { select: { display_name: true } },
          service_types: { select: { name: true } },
        },
        orderBy: { queue_position: "asc" },
      });

      if (jobs.length === 0) {
        return JSON.stringify({ date: dateStr, jobs: [], message: "No jobs scheduled for this day." });
      }

      const summary = jobs.map((j: any, i: number) => ({
        position: i + 1,
        id: j.id,
        customer: j.customers?.display_name ?? "Unknown",
        service: j.service_types?.name ?? "Unknown",
        status: j.status,
        address: j.address_text,
        estimated_minutes: j.estimated_duration_minutes,
        drive_minutes: j.drive_time_minutes,
        notes: j.job_notes,
      }));

      return JSON.stringify({ date: dateStr, job_count: jobs.length, jobs: summary });
    }

    case "add_job_note": {
      const jobId = toolInput.job_id as string;
      const note = toolInput.note as string;

      const job = await ctx.db.scheduling_jobs.findUnique({
        where: { id: jobId },
        select: { technician_id: true },
      });
      if (!job || job.technician_id !== ctx.technicianId) {
        return JSON.stringify({ error: "Job not found or not assigned to you." });
      }

      await ctx.db.scheduling_jobs.update({
        where: { id: jobId },
        data: { job_notes: note, updated_at: new Date() },
      });

      return JSON.stringify({ success: true, message: `Note updated on job ${jobId}.` });
    }

    case "update_job_status": {
      const jobId = toolInput.job_id as string;
      const status = toolInput.status as string;

      const job = await ctx.db.scheduling_jobs.findUnique({
        where: { id: jobId },
        select: { technician_id: true, status: true },
      });
      if (!job || job.technician_id !== ctx.technicianId) {
        return JSON.stringify({ error: "Job not found or not assigned to you." });
      }

      const now = new Date();
      const data: Record<string, unknown> = {
        status,
        updated_at: now,
      };

      if (status === "ARRIVED") data.arrived_at = now;
      if (status === "COMPLETED" || status === "INCOMPLETE") {
        data.completed_at = now;
        if (toolInput.completion_note) {
          data.completion_note = toolInput.completion_note;
        }
      }

      await ctx.db.scheduling_jobs.update({ where: { id: jobId }, data });

      return JSON.stringify({
        success: true,
        message: `Job status updated to ${status}.`,
      });
    }

    case "request_schedule_change": {
      const requestType = toolInput.request_type as string;
      const description = toolInput.description as string;

      // Create a notification for the owner
      const business = await ctx.db.businesses.findUnique({
        where: { id: ctx.businessId },
        select: { owner_user_id: true },
      });

      if (business?.owner_user_id) {
        const tech = await ctx.db.technicians.findUnique({
          where: { id: ctx.technicianId },
          select: { name: true },
        });
        await ctx.db.notifications.create({
          data: {
            user_id: business.owner_user_id,
            business_id: ctx.businessId,
            notification_type: "scheduling_request",
            title: `${tech?.name ?? "Technician"}: ${requestType.replace(/_/g, " ")}`,
            summary: description,
          },
        });
      }

      return JSON.stringify({
        success: true,
        message: "Schedule change request sent to your owner. They'll review it shortly.",
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ── Router ─────────────────────────────────────────────────────

export const techAssistantRouter = createTRPCRouter({
  chat: technicianProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Get tech + business context
      const [tech, business] = await Promise.all([
        ctx.db.technicians.findUnique({
          where: { id: ctx.technicianId },
          select: { name: true },
        }),
        ctx.db.businesses.findUnique({
          where: { id: ctx.businessId },
          select: { business_name: true },
        }),
      ]);

      const techName = tech?.name ?? "Technician";
      const businessName = business?.business_name ?? "your company";
      const systemPrompt = buildSystemPrompt(techName, businessName);

      // Run the agentic loop — Claude may call multiple tools
      let messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const MAX_TOOL_ROUNDS = 5;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          temperature: 0.5,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        });

        // If Claude is done (no tool use), extract text and return
        if (response.stop_reason === "end_turn") {
          const textBlock = response.content.find((b) => b.type === "text");
          return { reply: textBlock?.text ?? "I'm not sure how to help with that." };
        }

        // Process tool calls
        if (response.stop_reason === "tool_use") {
          // Add Claude's response (with tool_use blocks) to messages
          messages.push({ role: "assistant", content: response.content });

          // Execute each tool call and build tool_result messages
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type === "tool_use") {
              const result = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                { db: ctx.db, technicianId: ctx.technicianId, businessId: ctx.businessId },
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          messages.push({ role: "user", content: toolResults });
          continue;
        }

        // Unexpected stop reason — return what we have
        const fallbackText = response.content.find((b) => b.type === "text");
        return { reply: fallbackText?.text ?? "Something went wrong. Try again." };
      }

      return { reply: "I hit my limit on actions for this request. Try breaking it into smaller steps." };
    }),
});
