import { Brackets, In, IsNull, Not } from "typeorm";
import { getDataSource, Request } from "./index";
import type { LidarrLifecycleStatus } from "./index";

export type RequestFilters = {
  status?: string[];
  userId?: number;
};

export type NewRequest = {
  userId: number;
  albumMbid: string;
  artistName: string;
  albumTitle: string;
};

function repo() {
  return getDataSource().getRepository(Request);
}

export async function findRequestById(id: number): Promise<Request | null> {
  return repo().findOne({ where: { id } });
}

export async function findPendingRequestForAlbum(
  albumMbid: string
): Promise<Request | null> {
  return repo().findOne({
    where: { album_mbid: albumMbid, status: "pending" },
  });
}

export async function insertRequest(input: NewRequest): Promise<Request> {
  const repository = repo();
  return repository.save(
    repository.create({
      user_id: input.userId,
      album_mbid: input.albumMbid,
      artist_name: input.artistName,
      album_title: input.albumTitle,
      status: "pending",
    })
  );
}

export async function saveRequest(request: Request): Promise<Request> {
  return repo().save(request);
}

export async function saveRequests(requests: Request[]): Promise<void> {
  await repo().save(requests);
}

/**
 * Approved requests whose lifecycle status is still worth polling Lidarr about.
 * Terminal statuses are excluded so a finished request is never re-fetched.
 */
export async function findRequestsAwaitingStatus(
  terminalStatuses: LidarrLifecycleStatus[]
): Promise<Request[]> {
  return repo().find({
    where: [
      { status: "approved", lidarr_status: IsNull() },
      { status: "approved", lidarr_status: Not(In(terminalStatuses)) },
    ],
  });
}

/**
 * Requests with their requesting user attached, newest first.
 *
 * `status` filters across two columns: approval states live on `request.status`,
 * lifecycle states on `request.lidarr_status`. `approvalStatuses` says which of the
 * requested values belong to the first group; the rest are matched against the second,
 * OR-ed together so a mixed selection returns the union.
 */
export async function listRequests(
  filters: RequestFilters | undefined,
  approvalStatuses: Set<string>
): Promise<Request[]> {
  const qb = repo()
    .createQueryBuilder("request")
    .leftJoinAndSelect("request.user", "user")
    .orderBy("request.created_at", "DESC");

  if (filters?.userId) {
    qb.andWhere("request.user_id = :userId", { userId: filters.userId });
  }

  const statuses = filters?.status ?? [];
  if (statuses.length > 0) {
    const approvals = statuses.filter((s) => approvalStatuses.has(s));
    const lifecycles = statuses.filter((s) => !approvalStatuses.has(s));

    qb.andWhere(
      new Brackets((b) => {
        if (approvals.length > 0) {
          b.orWhere("request.status IN (:...approvals)", { approvals });
        }
        if (lifecycles.length > 0) {
          b.orWhere("request.lidarr_status IN (:...lifecycles)", {
            lifecycles,
          });
        }
      })
    );
  }

  return qb.getMany();
}
