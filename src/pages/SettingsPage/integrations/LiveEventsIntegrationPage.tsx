import LiveEventsSection from "../sections/integrations/LiveEventsSection";
import { useIntegrations } from "./context";

export default function LiveEventsIntegrationPage() {
  const { fields, updateFields } = useIntegrations();

  if (!fields.liveEvents) return null;

  return (
    <LiveEventsSection
      settings={fields.liveEvents}
      onChange={(patch) =>
        updateFields({ liveEvents: { ...fields.liveEvents!, ...patch } })
      }
    />
  );
}
