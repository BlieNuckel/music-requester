import { useSettings } from "@/context/useSettings";
import { useAutoSave } from "@/hooks/useAutoSave";
import AccountSection from "../sections/general/AccountSection";
import SpendingSection from "../sections/general/SpendingSection";
import LivePreferencesSection from "../sections/general/LivePreferencesSection";
import ThemeToggle from "@/components/ThemeToggle";
import Skeleton from "@/components/Skeleton";
import SaveStatusIndicator from "../shared/SaveStatusIndicator";

export default function GeneralSettingsPage() {
  const { settings, isLoading, savePartialSettings } = useSettings();
  const { fields, saveStatus, saveError, updateField } = useAutoSave(
    settings,
    savePartialSettings
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SaveStatusIndicator status={saveStatus} error={saveError} />
      </div>

      <AccountSection />

      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Theme
        </h2>
        <ThemeToggle />
      </div>

      <SpendingSection
        spending={fields.spending}
        onSpendingChange={(v) => updateField("spending", v)}
      />

      <LivePreferencesSection />
    </div>
  );
}
