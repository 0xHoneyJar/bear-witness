import fetch from "node-fetch";
import { formatEther } from "viem";
import {
  INTERNAL_GRAPHQL_ENDPOINT,
  IRYS_GRAPHQL_ENDPOINT,
  OWNER_ADDRESS,
} from "./config";
import BigNumber from "bignumber.js";

interface OffchainDelegation {
  referrer: string;
  address: string;
  timestamp: number;
  quantity: number;
  type: "queue_boost" | "activate_boost";
}

interface OnchainDelegation {
  user: string;
  validator: string;
  amount: bigint;
  timestamp: number;
  type: "queue" | "activate";
}

interface VerifiedDelegation {
  user: string;
  validator: string;
  amount: number;
  offchainQueueTimestamp: number;
  onchainQueueTimestamp: number;
  offchainActivateTimestamp: number;
  onchainActivateTimestamp: number;
}

export async function checkDelegation(
  referrer: string,
  timeWindow: number,
  startDate?: string,
  endDate?: string
) {
  const startTimestamp = startDate
    ? new Date(startDate).getTime() / 1000
    : undefined;
  const endTimestamp = endDate ? new Date(endDate).getTime() / 1000 : undefined;

  console.log(`Fetching offchain delegations for referrer: ${referrer}`);
  const offchainDelegations = await fetchOffchainDelegations(
    referrer,
    startTimestamp,
    endTimestamp
  );
  console.log(`Fetched ${offchainDelegations.length} offchain delegations`);

  console.log(`Fetching onchain delegations for referrer: ${referrer}`);
  const onchainDelegations = await fetchOnchainDelegations(
    startTimestamp,
    endTimestamp
  );
  console.log(`Fetched ${onchainDelegations.length} onchain delegations`);

  console.log(`Matching delegations with time window: ${timeWindow} minutes`);
  const verifiedDelegations = matchDelegations(
    offchainDelegations,
    onchainDelegations,
    timeWindow
  );
  console.log(`Found ${verifiedDelegations.length} verified delegations`);

  const summary = calculateDelegationSummary(verifiedDelegations);

  return {
    summary,
    verifiedDelegations,
  };
}

async function fetchOffchainDelegations(
  referrer: string,
  startTimestamp?: number,
  endTimestamp?: number
): Promise<OffchainDelegation[]> {
  let allDelegations: OffchainDelegation[] = [];
  let hasNextPage = true;
  let after = null;
  const limit = 1000;

  while (hasNextPage) {
    try {
      const res = await fetch(IRYS_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query getByOwner($tags: [TagFilter!], $limit: Int!, $after: String) {
              transactions(
                owners: ["${OWNER_ADDRESS}"],
                tags: $tags,
                limit: $limit,
                after: $after,
                order: ASC
              ) {
                edges {
                  node {
                    id
                    tags {
                      name
                      value
                    }
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `,
          variables: {
            tags: [
              { name: "event", values: ["queue_boost", "activate_boost"] },
              { name: "referrer", values: [referrer] },
            ],
            limit: limit,
            after: after,
          },
        }),
      });

      const { data } = (await res.json()) as any;

      const delegations = data.transactions.edges
        .map((edge: any) => {
          const tags = edge.node.tags;
          const timestamp = parseInt(
            tags.find((tag: any) => tag.name === "timestamp")?.value || "0"
          );

          if (
            (startTimestamp && timestamp < startTimestamp) ||
            (endTimestamp && timestamp > endTimestamp)
          ) {
            return null;
          }

          return {
            referrer: tags.find((tag: any) => tag.name === "referrer")?.value,
            address: tags.find((tag: any) => tag.name === "address")?.value,
            timestamp: timestamp,
            quantity: parseInt(
              tags.find((tag: any) => tag.name === "quantity")?.value || "0"
            ),
            type: tags.find((tag: any) => tag.name === "event")?.value,
          };
        })
        .filter((delegation: OffchainDelegation | null) => delegation !== null);

      allDelegations = [...allDelegations, ...delegations];

      hasNextPage = data.transactions.pageInfo.hasNextPage;
      after =
        data.transactions.edges[data.transactions.edges.length - 1]?.cursor;
    } catch (error) {
      console.error(`Error fetching offchain delegations: ${error}`);
      hasNextPage = false;
    }
  }

  return allDelegations;
}

async function fetchOnchainDelegations(
  startDate?: number,
  endDate?: number
): Promise<OnchainDelegation[]> {
  let allDelegations: OnchainDelegation[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000;

  while (hasMore) {
    const query = `
      query GetDelegationEvents($limit: Int!, $offset: Int!, $startTimestamp: BigInt!, $endTimestamp: BigInt!) {
        queueBoosts(
          limit: $limit
          offset: $offset
          orderBy: timestamp_ASC
          where: {timestamp_gte: $startTimestamp, timestamp_lte: $endTimestamp}
        ) {
          user
          validator
          amount
          timestamp
        }
        activateBoosts(
          limit: $limit
          offset: $offset
          orderBy: timestamp_ASC
          where: {timestamp_gte: $startTimestamp, timestamp_lte: $endTimestamp}
        ) {
          user
          validator
          amount
          timestamp
        }
      }
    `;

    try {
      const response = await fetch(INTERNAL_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables: {
            limit,
            offset,
            startTimestamp: startDate || 0,
            endTimestamp: endDate || Math.floor(Date.now() / 1000),
          },
        }),
      });

      const responseData = (await response.json()) as any;

      if (responseData.errors) {
        console.error("GraphQL errors:", responseData.errors);
        throw new Error("GraphQL query failed");
      }

      if (!responseData.data) {
        console.error("Unexpected response structure:", responseData);
        throw new Error("Unexpected response structure");
      }

      const { data } = responseData;

      const queueEvents: OnchainDelegation[] = (data.queueBoosts || []).map(
        (event: any) => ({
          ...event,
          amount: BigInt(event.amount),
          timestamp: Number(event.timestamp),
          type: "queue",
        })
      );

      const activateEvents: OnchainDelegation[] = (
        data.activateBoosts || []
      ).map((event: any) => ({
        ...event,
        amount: BigInt(event.amount),
        timestamp: Number(event.timestamp),
        type: "activate",
      }));

      const newDelegations = [...queueEvents, ...activateEvents];
      allDelegations = [...allDelegations, ...newDelegations];

      if (newDelegations.length < limit * 2) {
        hasMore = false;
      } else {
        offset += limit;
      }
    } catch (error) {
      console.error(`Error fetching onchain delegations:`, error);
      hasMore = false;
    }
  }

  return allDelegations;
}

function findMatchingOffchainActivate(
  offchainActivateEvents: OffchainDelegation[],
  offchainQueueEvent: OffchainDelegation
): OffchainDelegation[] {
  return offchainActivateEvents.filter(
    (od) =>
      od.address?.toLowerCase() === offchainQueueEvent.address?.toLowerCase()
  );
}

function matchDelegations(
  offchainDelegations: OffchainDelegation[],
  onchainDelegations: OnchainDelegation[],
  timeWindow: number
): VerifiedDelegation[] {
  let queueEvents = onchainDelegations.filter((e) => e.type === "queue");
  let activateEvents = onchainDelegations.filter((e) => e.type === "activate");
  let offchainQueue = offchainDelegations.filter(
    (od) => od.type === "queue_boost"
  );
  let offchainActivate = offchainDelegations.filter(
    (od) => od.type === "activate_boost"
  );

  // Sort events by timestamp for more efficient matching
  queueEvents.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  offchainQueue.sort((a, b) => a.timestamp - b.timestamp);

  const verifiedDelegations: VerifiedDelegation[] = [];

  for (let i = 0; i < offchainQueue.length; i++) {
    const offchainQueueEvent = offchainQueue[i];
    if (!offchainQueueEvent.address) {
      continue;
    }

    const matchingOnchainQueue = findClosestMatchingEvent(
      queueEvents,
      offchainQueueEvent,
      timeWindow
    );

    if (!matchingOnchainQueue) {
      continue;
    }

    // Check if amounts are similar (allow for larger discrepancies)
    const offchainAmount = new BigNumber(offchainQueueEvent.quantity);
    const onchainAmount = new BigNumber(matchingOnchainQueue.amount.toString());
    if (!offchainAmount.isEqualTo(onchainAmount)) {
      continue;
    }

    const matchingOffchainActivates = findMatchingOffchainActivate(
      offchainActivate,
      offchainQueueEvent
    );
    if (matchingOffchainActivates.length === 0) {
      continue;
    }

    for (const matchingOffchainActivate of matchingOffchainActivates) {
      const matchingOnchainActivate = findClosestMatchingEvent(
        activateEvents,
        matchingOffchainActivate,
        timeWindow
      );
      if (!matchingOnchainActivate) {
        continue;
      }

      if (
        isValidDelegationPair(matchingOnchainQueue, matchingOnchainActivate)
      ) {
        verifiedDelegations.push(
          createVerifiedDelegation(
            offchainQueueEvent,
            matchingOnchainQueue,
            matchingOffchainActivate,
            matchingOnchainActivate
          )
        );

        // Remove matched events from the original lists
        offchainQueue.splice(i, 1);
        i--; // Adjust index since we removed an element
        offchainActivate = offchainActivate.filter(
          (e) => e !== matchingOffchainActivate
        );
        queueEvents = queueEvents.filter((e) => e !== matchingOnchainQueue);
        activateEvents = activateEvents.filter(
          (e) => e !== matchingOnchainActivate
        );
        break; // Move to the next offchain queue event
      }
    }
  }

  return verifiedDelegations;
}

function findClosestMatchingEvent(
  events: OnchainDelegation[],
  offchainEvent: OffchainDelegation,
  timeWindow: number
): OnchainDelegation | undefined {
  const extendedTimeWindow = timeWindow * 60;
  const normalizedOffchainTimestamp = Math.floor(
    offchainEvent.timestamp / 1000
  ); // Normalize to seconds if it's in milliseconds
  const offchainAmount = new BigNumber(offchainEvent.quantity);

  const matchingEvents = events.filter((e) => {
    const normalizedOnchainTimestamp = Number(e.timestamp);
    const timeDifference = Math.abs(
      normalizedOnchainTimestamp - normalizedOffchainTimestamp
    );
    const addressMatch =
      e.user?.toLowerCase() === offchainEvent.address?.toLowerCase();
    const onchainAmount = new BigNumber(e.amount.toString());
    const amountDifference = offchainAmount
      .minus(onchainAmount)
      .abs()
      .dividedBy(offchainAmount);

    return (
      (timeDifference <= extendedTimeWindow &&
        amountDifference.isLessThanOrEqualTo(0.1)) ||
      addressMatch
    );
  });

  if (matchingEvents.length === 0) {
    return undefined;
  }

  return matchingEvents.reduce((closest, current) => {
    const currentDiff = Math.abs(
      Number(current.timestamp) - normalizedOffchainTimestamp
    );
    const closestDiff = Math.abs(
      Number(closest.timestamp) - normalizedOffchainTimestamp
    );
    const currentAmountDiff = offchainAmount
      .minus(new BigNumber(current.amount.toString()))
      .abs();
    const closestAmountDiff = offchainAmount
      .minus(new BigNumber(closest.amount.toString()))
      .abs();

    if (currentDiff === closestDiff) {
      return currentAmountDiff.isLessThan(closestAmountDiff)
        ? current
        : closest;
    }
    return currentDiff < closestDiff ? current : closest;
  });
}

function isValidDelegationPair(
  queueEvent: OnchainDelegation,
  activateEvent: OnchainDelegation
): boolean {
  return (
    queueEvent.user.toLowerCase() === activateEvent.user.toLowerCase() &&
    queueEvent.validator.toLowerCase() === activateEvent.validator.toLowerCase()
  );
}

function createVerifiedDelegation(
  offchainQueue: OffchainDelegation,
  onchainQueue: OnchainDelegation,
  offchainActivate: OffchainDelegation,
  onchainActivate: OnchainDelegation
): VerifiedDelegation {
  return {
    user: offchainQueue.address,
    validator: onchainQueue.validator,
    amount: Number(onchainQueue.amount),
    offchainQueueTimestamp: offchainQueue.timestamp,
    onchainQueueTimestamp: onchainQueue.timestamp,
    offchainActivateTimestamp: offchainActivate.timestamp,
    onchainActivateTimestamp: onchainActivate.timestamp,
  };
}

function calculateDelegationSummary(verifiedDelegations: VerifiedDelegation[]) {
  const totalDelegations = verifiedDelegations.length;
  const totalDelegatedAmount = verifiedDelegations.reduce(
    (sum, delegation) => sum + delegation.amount,
    0
  );
  const uniqueDelegators = new Set(verifiedDelegations.map((d) => d.user)).size;

  return {
    totalDelegations,
    totalDelegatedAmount: formatEther(BigInt(totalDelegatedAmount)),
    uniqueDelegators,
  };
}
