import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

// ---------------------------------------------------------------------------
// 1. CONTEXT
// ---------------------------------------------------------------------------

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();

  return {
    db,
    session,
    ...opts,
  };
};

type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// ---------------------------------------------------------------------------
// 2. INITIALIZATION
// ---------------------------------------------------------------------------

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

// ---------------------------------------------------------------------------
// 3. MIDDLEWARE
// ---------------------------------------------------------------------------

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  console.log(`[TRPC] ${path} took ${Date.now() - start}ms`);
  return result;
});

/** Requires a valid session. Adds ctx.session (non-null). */
const enforceAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: ctx.session as NonNullable<TRPCContext["session"]> & { user: NonNullable<NonNullable<TRPCContext["session"]>["user"]> } },
  });
});

/** Requires auth AND a non-null businessId. Adds ctx.businessId as string. */
const enforceHasBusiness = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.session.user.businessId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Complete onboarding first",
    });
  }
  return next({
    ctx: {
      session: ctx.session as NonNullable<TRPCContext["session"]> & { user: NonNullable<NonNullable<TRPCContext["session"]>["user"]> },
      businessId: ctx.session.user.businessId, // string, not string | null
    },
  });
});

/** Requires auth + businessId + role === "owner". */
const enforceOwner = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.session.user.businessId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Complete onboarding first",
    });
  }
  if (ctx.session.user.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner access required",
    });
  }
  return next({
    ctx: {
      session: ctx.session as NonNullable<TRPCContext["session"]> & { user: NonNullable<NonNullable<TRPCContext["session"]>["user"]> },
      businessId: ctx.session.user.businessId, // string, not string | null
    },
  });
});

// ---------------------------------------------------------------------------
// 4. PROCEDURE BUILDERS
// ---------------------------------------------------------------------------

/** No auth required. */
export const publicProcedure = t.procedure.use(timingMiddleware);

/** Must be logged in. */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceAuthenticated);

/** Must be logged in AND have a businessId. Adds ctx.businessId: string. */
export const businessProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceHasBusiness);

/** Must be logged in + have businessId + role === "owner". Adds ctx.businessId: string. */
export const ownerProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceOwner);
