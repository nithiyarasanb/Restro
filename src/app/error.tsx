"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
      <ErrorState
        description={
          <>
            The page failed to load. Please try again.
            {error.digest && <span className="mt-1 block font-mono text-xs text-muted">Reference: {error.digest}</span>}
          </>
        }
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
