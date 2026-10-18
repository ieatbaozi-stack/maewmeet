"use client";

import { ErrorState } from "@/components/shell/ErrorState";

export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="main" id="main">
      <ErrorState retry={retry} />
    </main>
  );
}
