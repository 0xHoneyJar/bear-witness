/**
 * Delegation Lifecycle and Verification Process
 *
 * 1. Boost Lifecycle:
 *    - Queue Boost (pending state)
 *    - Then either:
 *      a) Cancel Boost (cancelled state) OR
 *      b) Activate Boost (active state)
 *    - If active, can later:
 *      - Drop Boost (dropped state)
 *
 * 2. Verification Steps:
 *    a) Match offchain queue_boost with onchain queueBoost
 *    b) Verify the boost wasn't cancelled
 *    c) Match offchain activate_boost with onchain activateBoost
 *    d) Verify amounts match between offchain and onchain events
 *    e) Verify user and validator addresses match
 *    f) Check all events occur within the specified time window
 *
 * 3. Reward Distribution:
 *    - Track rewards received by operator address per block
 *    - Calculate referrer shares based on proportion of valid delegations
 *    - Only consider delegations that are:
 *      - Successfully queued
 *      - Not cancelled
 *      - Successfully activated
 *      - Not dropped
 */

import BigNumber from "bignumber.js";
import fetch from "node-fetch";
import { formatEther } from "viem";
import {
  INTERNAL_GRAPHQL_ENDPOINT,
  IRYS_GRAPHQL_ENDPOINT,
  OWNER_ADDRESS,
} from "./config";

interface OffchainDelegation {
  referrer: string;
  address: string;
  timestamp: number;
  quantity: number;
  type: "queue_boost" | "activate_boost" | "drop_boost" | "cancel_boost";
}

interface OnchainDelegation {
  user: string;
  validator: string;
  amount: bigint;
  timestamp: number;
  type: "queue" | "activate" | "drop" | "cancel";
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

interface Distribution {
  valCoinbase: string;
  blockNumber: bigint;
  receiver: string;
  amount: bigint;
  timestamp: bigint;
  rewards: DistributionReward[];
}

interface DistributionReward {
  token: string;
  amount: bigint;
}

interface RewardSummary {
  bgt: bigint;
  honey: bigint;
  blockStart: number;
  blockEnd: number;
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
            query getByOwner($tags: [TagFilter!], $first: Int!, $after: String) {
              transactions(
                owners: ["${OWNER_ADDRESS}"],
                tags: $tags,
                first: $first,
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
            first: limit,
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
        dropBoosts(
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
        cancelBoosts(
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

      const dropEvents: OnchainDelegation[] = (data.dropBoosts || []).map(
        (event: any) => ({
          ...event,
          amount: BigInt(event.amount),
          timestamp: Number(event.timestamp),
          type: "drop",
        })
      );

      const cancelEvents: OnchainDelegation[] = (data.cancelBoosts || []).map(
        (event: any) => ({
          ...event,
          amount: BigInt(event.amount),
          timestamp: Number(event.timestamp),
          type: "cancel",
        })
      );

      const newDelegations = [
        ...queueEvents,
        ...activateEvents,
        ...dropEvents,
        ...cancelEvents,
      ];
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
  let cancelEvents = onchainDelegations.filter((e) => e.type === "cancel");
  let dropEvents = onchainDelegations.filter((e) => e.type === "drop");

  let offchainQueue = offchainDelegations.filter(
    (od) => od.type === "queue_boost"
  );
  let offchainActivate = offchainDelegations.filter(
    (od) => od.type === "activate_boost"
  );
  let offchainCancel = offchainDelegations.filter(
    (od) => od.type === "cancel_boost"
  );
  let offchainDrop = offchainDelegations.filter(
    (od) => od.type === "drop_boost"
  );

  // Sort all events by timestamp
  [queueEvents, activateEvents, cancelEvents, dropEvents].forEach((events) =>
    events.sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  );

  [offchainQueue, offchainActivate, offchainCancel, offchainDrop].forEach(
    (events) => events.sort((a, b) => a.timestamp - b.timestamp)
  );

  const verifiedDelegations: VerifiedDelegation[] = [];

  for (let i = 0; i < offchainQueue.length; i++) {
    const offchainQueueEvent = offchainQueue[i];
    if (!offchainQueueEvent.address) continue;

    const matchingOnchainQueue = findClosestMatchingEvent(
      queueEvents,
      offchainQueueEvent,
      timeWindow
    );

    if (!matchingOnchainQueue) continue;

    // Check if the queue was cancelled
    const matchingCancel = findClosestMatchingEvent(
      cancelEvents,
      offchainQueueEvent,
      timeWindow
    );

    // Skip if this boost was cancelled
    if (
      matchingCancel &&
      matchingCancel.timestamp > matchingOnchainQueue.timestamp
    ) {
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

// Add trackRewards implementation
async function trackRewards(
  startBlock: number,
  endBlock: number
): Promise<RewardSummary> {
  const query = `
    query GetDistributions($startBlock: BigInt!, $endBlock: BigInt!) {
      distributions(
        where: {
          blockNumber_gte: $startBlock
          blockNumber_lte: $endBlock
          receiver: "${OWNER_ADDRESS}"
        }
        orderBy: blockNumber_ASC
      ) {
        blockNumber
        amount
        rewards {
          token
          amount
        }
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
          startBlock,
          endBlock,
        },
      }),
    });

    const { data } = (await response.json()) as any;

    if (!data?.distributions) {
      throw new Error("Failed to fetch distributions");
    }

    const summary: RewardSummary = {
      bgt: BigInt(0),
      honey: BigInt(0),
      blockStart: startBlock,
      blockEnd: endBlock,
    };

    for (const dist of data.distributions) {
      for (const reward of dist.rewards) {
        if (reward.token.toLowerCase() === "bgt")
          summary.bgt += BigInt(reward.amount);
        else if (reward.token.toLowerCase() === "honey")
          summary.honey += BigInt(reward.amount);
      }
    }

    return summary;
  } catch (error) {
    console.error("Error fetching rewards:", error);
    throw error;
  }
}

interface ReferrerShare {
  referrer: string;
  bgtShare: bigint;
  honeyShare: bigint;
  delegationPercentage: number;
}

// Add calculateReferrerShares implementation
function calculateReferrerShares(
  verifiedDelegations: VerifiedDelegation[],
  rewards: RewardSummary
): ReferrerShare[] {
  // Group delegations by referrer
  const referrerDelegations = verifiedDelegations.reduce((acc, delegation) => {
    const referrer = delegation.user;
    if (!acc[referrer]) acc[referrer] = [];
    acc[referrer].push(delegation);
    return acc;
  }, {} as Record<string, VerifiedDelegation[]>);

  const totalDelegatedAmount = verifiedDelegations.reduce(
    (sum, del) => sum + del.amount,
    0
  );

  const shares: ReferrerShare[] = [];

  for (const [referrer, delegations] of Object.entries(referrerDelegations)) {
    const referrerTotal = delegations.reduce((sum, del) => sum + del.amount, 0);
    const percentage =
      totalDelegatedAmount > 0 ? referrerTotal / totalDelegatedAmount : 0;

    // Calculate 25% share of rewards based on delegation percentage
    const bgtShare = BigInt(
      Math.floor(Number(rewards.bgt) * percentage * 0.25)
    );
    const honeyShare = BigInt(
      Math.floor(Number(rewards.honey) * percentage * 0.25)
    );

    shares.push({
      referrer,
      bgtShare,
      honeyShare,
      delegationPercentage: percentage * 100,
    });
  }

  return shares;
}

// Update the main function
export async function processDelegationsAndRewards({
  referrer,
  timeWindow,
  startBlock,
  endBlock,
}: {
  referrer: string;
  timeWindow: number;
  startBlock: number;
  endBlock: number;
}) {
  console.log("\n=== Starting Delegation and Rewards Processing ===\n");

  console.log(`Processing for referrer: ${referrer}`);
  console.log(`Block range: ${startBlock} to ${endBlock}`);
  console.log(`Time window: ${timeWindow} minutes`);

  const { summary, verifiedDelegations } = await checkDelegation(
    referrer,
    timeWindow
  );

  console.log("\n=== Delegation Summary ===");
  console.log(`Total Delegations: ${summary.totalDelegations}`);
  console.log(`Total Delegated Amount: ${summary.totalDelegatedAmount} BGT`);
  console.log(`Unique Delegators: ${summary.uniqueDelegators}`);

  console.log("\n=== Fetching Rewards ===");
  const rewards = await trackRewards(startBlock, endBlock);
  console.log(`BGT Rewards: ${formatEther(rewards.bgt)} BGT`);
  console.log(`HONEY Rewards: ${formatEther(rewards.honey)} HONEY`);
  console.log(`Block Range: ${rewards.blockStart} to ${rewards.blockEnd}`);

  console.log("\n=== Calculating Referrer Shares ===");
  const referrerShares = calculateReferrerShares(verifiedDelegations, rewards);

  console.log("\nReferrer Share Breakdown:");
  referrerShares.forEach((share) => {
    console.log(`\nReferrer: ${share.referrer}`);
    console.log(
      `Delegation Percentage: ${share.delegationPercentage.toFixed(2)}%`
    );
    console.log(`BGT Share: ${formatEther(share.bgtShare)} BGT`);
    console.log(`HONEY Share: ${formatEther(share.honeyShare)} HONEY`);
  });

  console.log("\n=== Processing Complete ===\n");

  return {
    summary,
    verifiedDelegations,
    rewards,
    referrerShares,
  };
}
