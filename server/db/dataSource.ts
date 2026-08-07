import path from "path";
import { fileURLToPath } from "url";
import { DataSource } from "typeorm";
import { User } from "./entity/User";
import { Session } from "./entity/Session";
import { Request } from "./entity/Request";
import { WantedItem } from "./entity/WantedItem";
import { Purchase } from "./entity/Purchase";
import { Config } from "./entity/Config";
import { FollowedArtist } from "./entity/FollowedArtist";
import { FollowedRelease } from "./entity/FollowedRelease";
import { UserProfile } from "./entity/UserProfile";
import { UserSignalEvent } from "./entity/UserSignalEvent";
import { InitialSchema1709000000000 } from "./migration/1_InitialSchema";
import { ConfigTable1710000000000 } from "./migration/2_ConfigTable";
import { WantedItems1711000000000 } from "./migration/3_WantedItems";
import { Purchases1712000000000 } from "./migration/4_Purchases";
import { FollowedArtists1713000000000 } from "./migration/5_FollowedArtists";
import { FollowedLastViewedAt1714000000000 } from "./migration/6_FollowedLastViewedAt";
import { RequestLidarrStatus1715000000000 } from "./migration/7_RequestLidarrStatus";
import { UserProfile1716000000000 } from "./migration/8_UserProfile";
import { RenamePlexPlays1717000000000 } from "./migration/9_RenamePlexPlays";
import { FollowedReleases1718000000000 } from "./migration/10_FollowedReleases";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDefaultDbPath(): string {
  const configDir =
    process.env.APP_CONFIG_DIR || path.join(__dirname, "..", "..", "config");
  return path.join(configDir, "tunearr.db");
}

export function createDataSource(dbPath?: string): DataSource {
  const resolvedPath = dbPath ?? getDefaultDbPath();

  return new DataSource({
    type: "better-sqlite3",
    database: resolvedPath,
    entities: [
      User,
      Session,
      Request,
      WantedItem,
      Purchase,
      Config,
      FollowedArtist,
      FollowedRelease,
      UserProfile,
      UserSignalEvent,
    ],
    migrations: [
      InitialSchema1709000000000,
      ConfigTable1710000000000,
      WantedItems1711000000000,
      Purchases1712000000000,
      FollowedArtists1713000000000,
      FollowedLastViewedAt1714000000000,
      RequestLidarrStatus1715000000000,
      UserProfile1716000000000,
      RenamePlexPlays1717000000000,
      FollowedReleases1718000000000,
    ],
    synchronize: false,
    migrationsRun: true,
    enableWAL: true,
  });
}
