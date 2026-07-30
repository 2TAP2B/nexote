import EditorPane from "@/components/EditorPane";
import Sidebar from "@/components/Sidebar";
import { NotesProvider } from "@/lib/notes-context";

export default function Page() {
  return (
    <NotesProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <EditorPane />
      </div>
    </NotesProvider>
  );
}