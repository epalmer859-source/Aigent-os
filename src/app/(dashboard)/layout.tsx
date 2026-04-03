import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import DashboardNav from "./_components/DashboardNav";
import { InstallPrompt } from "../_components/install-prompt";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!session.user.businessId) {
    redirect("/choose-role");
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <InstallPrompt />
      <DashboardNav email={session.user.email} role={session.user.role} />
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
