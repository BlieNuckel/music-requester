import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function Layout() {
  return (
    /*
     * The document scrolls, not an inner box. A fixed-height shell with its own
     * scroll container never scrolls the document, so iOS keeps its collapsible
     * bar expanded and the app is stuck at 100svh; it also puts the container's
     * bottom past the fold, hiding whatever the last page anchors there. Any
     * overflow value other than visible here brings both back.
     */
    <div className="flex min-h-[100dvh] bg-amber-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <Sidebar />
      <main className="flex-1 min-w-0 px-4 md:px-8 pt-[calc(1.5rem+env(safe-area-inset-top))] md:pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-6">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
