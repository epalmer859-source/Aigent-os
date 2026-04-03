import { postRouter } from "~/server/api/routers/post";
import { testRouter } from "~/server/api/routers/test";
import { onboardingRouter } from "~/server/api/routers/onboarding";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { conversationsRouter } from "~/server/api/routers/conversations";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { quotesRouter } from "~/server/api/routers/quotes";
import { approvalsRouter } from "~/server/api/routers/approvals";
import { escalationsRouter } from "~/server/api/routers/escalations";
import { settingsRouter } from "~/server/api/routers/settings";
import { notificationsRouter } from "~/server/api/routers/notifications";
import { analyticsRouter } from "~/server/api/routers/analytics";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
  test: testRouter,
  onboarding: onboardingRouter,
  dashboard: dashboardRouter,
  conversations: conversationsRouter,
  appointments: appointmentsRouter,
  quotes: quotesRouter,
  approvals: approvalsRouter,
  escalations: escalationsRouter,
  settings: settingsRouter,
  notifications: notificationsRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
