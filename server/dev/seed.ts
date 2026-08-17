import "reflect-metadata";
import { Repository } from "typeorm";
import {
  initializeDatabase,
  getDataSource,
  User,
  Request,
  WantedItem,
  Purchase,
  closeDatabase,
} from "../db/index";
import { hashPassword } from "../auth/password";
import { initializeConfig } from "../config";
import { seedLiveEvents } from "./seedLiveEvents";
import { Permission } from "../../shared/permissions";

type SeedUser = {
  username: string;
  password: string;
  permissions: number;
  user_type: "local" | "plex";
  plex_username?: string;
  plex_thumb?: string;
};

type SeedRequest = {
  username: string;
  album_mbid: string;
  artist_name: string;
  album_title: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
};

type SeedWantedItem = {
  username: string;
  album_mbid: string;
  artist_name: string;
  album_title: string;
  created_at: string;
};

type SeedPurchase = {
  username: string;
  album_mbid: string;
  artist_name: string;
  album_title: string;
  price: number;
  currency: string;
  purchased_at: string;
};

const USERS: SeedUser[] = [
  {
    username: "admin",
    password: "admin",
    permissions: Permission.ADMIN,
    user_type: "local",
  },
  {
    username: "manager",
    password: "manager",
    permissions:
      Permission.REQUEST | Permission.MANAGE_REQUESTS | Permission.REQUEST_VIEW,
    user_type: "local",
  },
  {
    username: "viewer",
    password: "viewer",
    permissions: Permission.REQUEST | Permission.REQUEST_VIEW,
    user_type: "local",
  },
  {
    username: "requester",
    password: "requester",
    permissions: Permission.REQUEST,
    user_type: "local",
  },
  {
    username: "autoapprover",
    password: "autoapprover",
    permissions: Permission.REQUEST | Permission.AUTO_APPROVE,
    user_type: "local",
  },
  {
    username: "plex_alice",
    password: "plex_alice",
    permissions: Permission.REQUEST,
    user_type: "plex",
    plex_username: "alice_plex",
    plex_thumb: "https://i.pravatar.cc/150?u=alice",
  },
  {
    username: "plex_bob",
    password: "plex_bob",
    permissions: Permission.REQUEST | Permission.REQUEST_VIEW,
    user_type: "plex",
    plex_username: "bob_plex",
    plex_thumb: "https://i.pravatar.cc/150?u=bob",
  },
];

const REQUESTS: SeedRequest[] = [
  // Pending requests
  {
    username: "requester",
    album_mbid: "b3b7e934-445b-4c68-a097-730c6a6d47e5",
    artist_name: "Radiohead",
    album_title: "OK Computer",
    status: "pending",
    created_at: "2026-03-14T10:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "5d0f1615-a1dd-3477-aa5a-ffee39064fd4",
    artist_name: "Björk",
    album_title: "Homogenic",
    status: "pending",
    created_at: "2026-03-14T11:30:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "dfa56e7e-1a3b-38a4-890c-9e06023cf97e",
    artist_name: "Portishead",
    album_title: "Dummy",
    status: "pending",
    created_at: "2026-03-13T09:00:00Z",
  },
  {
    username: "requester",
    album_mbid: "f6384fc0-fb5c-4d68-8c2c-0d94bdb7f4f8",
    artist_name: "Massive Attack",
    album_title: "Mezzanine",
    status: "pending",
    created_at: "2026-03-12T14:00:00Z",
  },

  // Approved requests (these will show various Lidarr lifecycle states when MOCK_LIDARR=true)
  {
    username: "requester",
    album_mbid: "70b23c5f-3740-3e4e-8b72-1b2c52528eb3",
    artist_name: "Radiohead",
    album_title: "In Rainbows",
    status: "approved",
    created_at: "2026-03-10T08:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "aa1ea1bc-fc59-35f4-93a3-380e8b1b2031",
    artist_name: "Radiohead",
    album_title: "Kid A",
    status: "approved",
    created_at: "2026-03-09T16:00:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "09474191-15d3-3130-8a1f-cbd9a6d8a94e",
    artist_name: "Boards of Canada",
    album_title: "Music Has the Right to Children",
    status: "approved",
    created_at: "2026-03-08T12:00:00Z",
  },
  {
    username: "autoapprover",
    album_mbid: "d5242e28-9e8d-4574-8fee-90f6tried0a1",
    artist_name: "Aphex Twin",
    album_title: "Selected Ambient Works 85-92",
    status: "approved",
    created_at: "2026-03-07T10:00:00Z",
  },
  {
    username: "requester",
    album_mbid: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
    artist_name: "Burial",
    album_title: "Untrue",
    status: "approved",
    created_at: "2026-03-06T09:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-0001-4000-8000-000000000001",
    artist_name: "Autechre",
    album_title: "Tri Repetae",
    status: "approved",
    created_at: "2026-03-05T15:00:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "deadbeef-0002-4000-8000-000000000002",
    artist_name: "Four Tet",
    album_title: "Rounds",
    status: "approved",
    created_at: "2026-03-04T11:00:00Z",
  },
  {
    username: "requester",
    album_mbid: "deadbeef-0003-4000-8000-000000000003",
    artist_name: "Flying Lotus",
    album_title: "Cosmogramma",
    status: "approved",
    created_at: "2026-03-03T13:00:00Z",
  },

  // Declined requests
  {
    username: "requester",
    album_mbid: "deadbeef-dec1-4000-8000-000000000001",
    artist_name: "Nickelback",
    album_title: "Silver Side Up",
    status: "declined",
    created_at: "2026-03-11T09:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-dec2-4000-8000-000000000002",
    artist_name: "Creed",
    album_title: "Human Clay",
    status: "declined",
    created_at: "2026-03-10T15:00:00Z",
  },
];

const WANTED_ITEMS: SeedWantedItem[] = [
  {
    username: "requester",
    album_mbid: "deadbeef-want-4000-8000-000000000001",
    artist_name: "Tame Impala",
    album_title: "Currents",
    created_at: "2026-03-20T10:00:00Z",
  },
  {
    username: "requester",
    album_mbid: "deadbeef-want-4000-8000-000000000002",
    artist_name: "Kendrick Lamar",
    album_title: "To Pimp a Butterfly",
    created_at: "2026-03-19T11:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-want-4000-8000-000000000003",
    artist_name: "FKA twigs",
    album_title: "Magdalene",
    created_at: "2026-03-21T14:30:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-want-4000-8000-000000000004",
    artist_name: "Caroline Polachek",
    album_title: "Desire, I Want to Turn Into You",
    created_at: "2026-03-18T09:15:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "deadbeef-want-4000-8000-000000000005",
    artist_name: "Mount Kimbie",
    album_title: "Cold Spring Fault Less Youth",
    created_at: "2026-03-17T16:45:00Z",
  },
  {
    username: "manager",
    album_mbid: "deadbeef-want-4000-8000-000000000006",
    artist_name: "Jamie xx",
    album_title: "In Colour",
    created_at: "2026-03-22T12:00:00Z",
  },
  {
    username: "viewer",
    album_mbid: "deadbeef-want-4000-8000-000000000007",
    artist_name: "Arca",
    album_title: "KICK i",
    created_at: "2026-03-16T18:00:00Z",
  },
];

const PURCHASES: SeedPurchase[] = [
  {
    username: "requester",
    album_mbid: "deadbeef-buy0-4000-8000-000000000001",
    artist_name: "Daft Punk",
    album_title: "Discovery",
    price: 1499,
    currency: "USD",
    purchased_at: "2026-04-02T10:00:00Z",
  },
  {
    username: "requester",
    album_mbid: "deadbeef-buy0-4000-8000-000000000002",
    artist_name: "The Strokes",
    album_title: "Is This It",
    price: 999,
    currency: "USD",
    purchased_at: "2026-03-28T14:00:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-buy0-4000-8000-000000000003",
    artist_name: "Mitski",
    album_title: "Be the Cowboy",
    price: 1199,
    currency: "USD",
    purchased_at: "2026-04-10T09:30:00Z",
  },
  {
    username: "plex_alice",
    album_mbid: "deadbeef-buy0-4000-8000-000000000004",
    artist_name: "Phoebe Bridgers",
    album_title: "Punisher",
    price: 1299,
    currency: "USD",
    purchased_at: "2026-03-25T11:00:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "deadbeef-buy0-4000-8000-000000000005",
    artist_name: "Beach House",
    album_title: "Once Twice Melody",
    price: 1799,
    currency: "USD",
    purchased_at: "2026-04-15T16:00:00Z",
  },
  {
    username: "plex_bob",
    album_mbid: "deadbeef-buy0-4000-8000-000000000006",
    artist_name: "King Krule",
    album_title: "The OOZ",
    price: 1399,
    currency: "USD",
    purchased_at: "2026-02-20T13:00:00Z",
  },
  {
    username: "manager",
    album_mbid: "deadbeef-buy0-4000-8000-000000000007",
    artist_name: "Fleet Foxes",
    album_title: "Helplessness Blues",
    price: 1099,
    currency: "USD",
    purchased_at: "2026-04-18T08:00:00Z",
  },
  {
    username: "autoapprover",
    album_mbid: "deadbeef-buy0-4000-8000-000000000008",
    artist_name: "Yves Tumor",
    album_title: "Heaven to a Tortured Mind",
    price: 1199,
    currency: "USD",
    purchased_at: "2026-04-20T19:30:00Z",
  },
];

async function createSeedUser(
  userRepo: Repository<User>,
  seedUser: SeedUser
): Promise<User> {
  const existing = await userRepo.findOne({
    where: { username: seedUser.username },
  });
  if (existing) {
    console.log(
      `  User "${seedUser.username}" already exists (id=${existing.id}), skipping`
    );
    return existing;
  }

  const user = userRepo.create({
    username: seedUser.username,
    password_hash: await hashPassword(seedUser.password),
    permissions: seedUser.permissions,
    user_type: seedUser.user_type,
    plex_username: seedUser.plex_username ?? null,
    plex_thumb: seedUser.plex_thumb ?? null,
    enabled: 1,
    theme: "system",
  });

  const saved = await userRepo.save(user);
  console.log(
    `  Created user "${seedUser.username}" (id=${saved.id}, permissions=${seedUser.permissions})`
  );
  return saved;
}

async function createSeedRequest(
  requestRepo: Repository<Request>,
  seedReq: SeedRequest,
  userId: number,
  adminId: number
): Promise<Request> {
  const request = requestRepo.create({
    user_id: userId,
    album_mbid: seedReq.album_mbid,
    artist_name: seedReq.artist_name,
    album_title: seedReq.album_title,
    status: seedReq.status,
    created_at: seedReq.created_at,
    approved_by: seedReq.status === "approved" ? adminId : null,
    approved_at: seedReq.status === "approved" ? seedReq.created_at : null,
  });

  return requestRepo.save(request);
}

async function createSeedWantedItem(
  wantedRepo: Repository<WantedItem>,
  seedItem: SeedWantedItem,
  userId: number
): Promise<WantedItem> {
  const item = wantedRepo.create({
    user_id: userId,
    album_mbid: seedItem.album_mbid,
    artist_name: seedItem.artist_name,
    album_title: seedItem.album_title,
    created_at: seedItem.created_at,
  });
  return wantedRepo.save(item);
}

async function createSeedPurchase(
  purchaseRepo: Repository<Purchase>,
  seedItem: SeedPurchase,
  userId: number
): Promise<Purchase> {
  const item = purchaseRepo.create({
    user_id: userId,
    album_mbid: seedItem.album_mbid,
    artist_name: seedItem.artist_name,
    album_title: seedItem.album_title,
    price: seedItem.price,
    currency: seedItem.currency,
    purchased_at: seedItem.purchased_at,
  });
  return purchaseRepo.save(item);
}

async function seed() {
  console.log("Initializing database...");
  await initializeDatabase();
  initializeConfig();

  const ds = getDataSource();
  const userRepo = ds.getRepository(User);
  const requestRepo = ds.getRepository(Request);
  const wantedRepo = ds.getRepository(WantedItem);
  const purchaseRepo = ds.getRepository(Purchase);

  console.log("\nCreating users...");
  const userMap = new Map<string, User>();
  for (const seedUser of USERS) {
    const user = await createSeedUser(userRepo, seedUser);
    userMap.set(seedUser.username, user);
  }

  const admin = userMap.get("admin")!;

  console.log("\nCreating requests...");
  let created = 0;
  let skipped = 0;
  for (const seedReq of REQUESTS) {
    const user = userMap.get(seedReq.username);
    if (!user) {
      console.log(`  Skipping request: user "${seedReq.username}" not found`);
      skipped++;
      continue;
    }

    const existing = await requestRepo.findOne({
      where: { album_mbid: seedReq.album_mbid, user_id: user.id },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await createSeedRequest(requestRepo, seedReq, user.id, admin.id);
    console.log(
      `  ${seedReq.status.padEnd(8)} "${seedReq.album_title}" by ${seedReq.artist_name} (${seedReq.username})`
    );
    created++;
  }

  console.log("\nCreating wanted items...");
  let wantedCreated = 0;
  let wantedSkipped = 0;
  for (const seedItem of WANTED_ITEMS) {
    const user = userMap.get(seedItem.username);
    if (!user) {
      console.log(
        `  Skipping wanted item: user "${seedItem.username}" not found`
      );
      wantedSkipped++;
      continue;
    }

    const existing = await wantedRepo.findOne({
      where: { album_mbid: seedItem.album_mbid, user_id: user.id },
    });
    if (existing) {
      wantedSkipped++;
      continue;
    }

    await createSeedWantedItem(wantedRepo, seedItem, user.id);
    console.log(
      `  wanted   "${seedItem.album_title}" by ${seedItem.artist_name} (${seedItem.username})`
    );
    wantedCreated++;
  }

  console.log("\nCreating purchases...");
  let purchaseCreated = 0;
  let purchaseSkipped = 0;
  for (const seedItem of PURCHASES) {
    const user = userMap.get(seedItem.username);
    if (!user) {
      console.log(`  Skipping purchase: user "${seedItem.username}" not found`);
      purchaseSkipped++;
      continue;
    }

    const existing = await purchaseRepo.findOne({
      where: { album_mbid: seedItem.album_mbid, user_id: user.id },
    });
    if (existing) {
      purchaseSkipped++;
      continue;
    }

    await createSeedPurchase(purchaseRepo, seedItem, user.id);
    console.log(
      `  purchase "${seedItem.album_title}" by ${seedItem.artist_name} (${seedItem.username}, ${seedItem.price} ${seedItem.currency})`
    );
    purchaseCreated++;
  }

  console.log("\nCreating live events...");
  await seedLiveEvents(admin.id);

  console.log(
    `\nDone! Created ${created} requests (skipped ${skipped}), ${wantedCreated} wanted items (skipped ${wantedSkipped}), ${purchaseCreated} purchases (skipped ${purchaseSkipped}).`
  );
  console.log("\nSeed accounts (password = username):");
  for (const u of USERS) {
    const permNames = Object.entries(Permission)
      .filter(
        ([, v]) =>
          typeof v === "number" &&
          v !== 0 &&
          (u.permissions & (v as number)) !== 0
      )
      .map(([k]) => k);
    console.log(`  ${u.username.padEnd(16)} ${permNames.join(", ")}`);
  }
  console.log("\nTo see mock Lidarr lifecycle states, run the server with:");
  console.log("  MOCK_LIDARR=true pnpm dev");
  console.log("\nLive events are seeded for the admin account:");
  console.log(
    "  Discover      banner (just-announced local show) + nearby shelf"
  );
  console.log("  /library/live Upcoming, Going, Dismissed and Past tabs");
  console.log("  /artist/:mbid live dates on the five followed artists");
  console.log(
    "  Nothing calls JamBase: liveEvents stays disabled and keyless in dev."
  );

  await closeDatabase();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
