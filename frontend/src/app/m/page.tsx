"use client";

import { NotesProvider } from "@/lib/notes-context";
import MobileApp from "@/components/mobile/MobileApp";

export default function MobilePage() {
  return (
    <NotesProvider>
      <MobileApp />
    </NotesProvider>
  );
}