import { useCallback, useState } from "react";
import { resolveLayout } from "../layout";
import SectionSlot from "./SectionSlot";
import type {
  SectionDefinition,
  SectionId,
  SectionStatus,
  SectionStatusMap,
} from "../types";

interface DiscoverGridProps {
  definitions: readonly SectionDefinition[];
}

export default function DiscoverGrid({ definitions }: DiscoverGridProps) {
  const [statuses, setStatuses] = useState<SectionStatusMap>({});

  const handleStatusChange = useCallback(
    (id: SectionId, status: SectionStatus) => {
      setStatuses((prev) =>
        prev[id] === status ? prev : { ...prev, [id]: status }
      );
    },
    []
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
      {resolveLayout(definitions, statuses).map(({ definition, hidden }) => (
        <SectionSlot
          key={definition.id}
          definition={definition}
          hidden={hidden}
          onStatusChange={handleStatusChange}
        />
      ))}
    </div>
  );
}
