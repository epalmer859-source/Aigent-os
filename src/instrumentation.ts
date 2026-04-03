export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initProductionEngine } = await import("~/engine/production-init");
    initProductionEngine();
  }
}
