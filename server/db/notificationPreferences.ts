import { getDataSource, NotificationPreference } from "./index";

export type PreferenceRow = {
  eventId: string;
  transportId: string;
  enabled: boolean;
};

function repo() {
  return getDataSource().getRepository(NotificationPreference);
}

export async function listPreferences(
  userId: number
): Promise<NotificationPreference[]> {
  return repo().find({ where: { user_id: userId } });
}

export async function findPreference(
  userId: number,
  eventId: string,
  transportId: string
): Promise<NotificationPreference | null> {
  return repo().findOne({
    where: { user_id: userId, event_id: eventId, transport_id: transportId },
  });
}

/**
 * Write a whole preference set in one transaction. Saving these one at a time left a
 * failure part-applied, which for a notification matrix means the user silently keeps
 * receiving some of what they just turned off.
 */
export async function upsertPreferences(
  userId: number,
  rows: PreferenceRow[]
): Promise<void> {
  if (rows.length === 0) return;

  const updatedAt = new Date().toISOString();
  await getDataSource().transaction(async (manager) => {
    const repository = manager.getRepository(NotificationPreference);
    for (const row of rows) {
      const existing = await repository.findOne({
        where: {
          user_id: userId,
          event_id: row.eventId,
          transport_id: row.transportId,
        },
      });

      if (existing) {
        existing.enabled = row.enabled;
        existing.updated_at = updatedAt;
        await repository.save(existing);
        continue;
      }

      await repository.save(
        repository.create({
          user_id: userId,
          event_id: row.eventId,
          transport_id: row.transportId,
          enabled: row.enabled,
          updated_at: updatedAt,
        })
      );
    }
  });
}
