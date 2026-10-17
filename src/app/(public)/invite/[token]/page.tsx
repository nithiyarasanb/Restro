import type { Metadata } from "next";
import { Suspense } from "react";
import { getRequestStore } from "@/server/store/request";
import { isDomainError } from "@/server/errors";
import { previewInvitation } from "@/server/services/identity";
import { ROLE_LABELS } from "@/lib/permissions";
import { AcceptInviteForm } from "@/features/auth/accept-invite-form";
import { Skeleton } from "@/components/ui/feedback";
import { CustomerError } from "@/features/customer/customer-error";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false } };

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-md" />}>
        <Invite params={props.params} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  let preview;
  try {
    preview = await previewInvitation(await getRequestStore(), token);
  } catch (e) {
    if (isDomainError(e) && (e.code === "NOT_FOUND" || e.code === "CONFLICT"))
      return <CustomerError title="This invitation can't be used" message={e.code === "NOT_FOUND" ? "The link is invalid." : e.message} />;
    throw e;
  }
  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
      <h1 className="text-xl font-black">Join {preview.restaurantName}</h1>
      <p className="mt-1 text-sm text-muted">You&apos;ve been invited as {ROLE_LABELS[preview.role].toLowerCase()}.</p>
      <AcceptInviteForm token={token} existingAccount={preview.existingAccount} email={preview.email} />
    </div>
  );
}
