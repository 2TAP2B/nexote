"use client";

import { AuthGate } from "@/components/auth/AuthProvider";
import { NotesProvider } from "@/lib/notes-context";
import MobileApp from "@/components/mobile/MobileApp";

export default function MobilePage() {
  return (
    <AuthGate>
      <NotesProvider>
        <MobileApp />
      </NotesProvider>
    </AuthGate>
  );
}
