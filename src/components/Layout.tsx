import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function Layout() {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-amber-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto px-4 md:px-8 pt-[calc(1.5rem+env(safe-area-inset-top))] md:pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-6">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
