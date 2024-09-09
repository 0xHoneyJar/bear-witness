import fetch from "node-fetch";
import { IRYS_GRAPHQL_ENDPOINT, OWNER_ADDRESS } from "./config";

interface DelegationEvent {
  referrer: string;
  address: string;
  timestamp: number;
  quantity: number;
  event: "queue_boost" | "activate_boost";
}

export async function checkDelegation(
  referrer: string,
  startDate?: string,
  endDate?: string
) {
  const startTimestamp = startDate
    ? new Date(startDate).getTime() / 1000
    : undefined;
  const endTimestamp = endDate ? new Date(endDate).getTime() / 1000 : undefined;

  const events = await fetchDelegationEvents(
    referrer,
    startTimestamp,
    endTimestamp
  );
  const summary = calculateDelegationSummary(events);

  return {
    summary,
    events,
  };
}

async function fetchDelegationEvents(
  referrer: string,
  startTimestamp?: number,
  endTimestamp?: number
): Promise<DelegationEvent[]> {
  let allEvents: DelegationEvent[] = [];
  let hasNextPage = true;
  let after = null;
  const limit = 100;

  while (hasNextPage) {
    try {
      const res = await fetch(IRYS_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query getDelegationEvents($tags: [TagFilter!], $limit: Int!, $after: String) {
              transactions(
                owners: ["${OWNER_ADDRESS}"],
                tags: $tags,
                limit: $limit,
                after: $after,
                order: DESC
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

      const events = data.transactions.edges
        .map((edge: any) => {
          const tags = edge.node.tags;
          console.log(tags);
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
            event: tags.find((tag: any) => tag.name === "event")?.value,
          };
        })
        .filter((event: DelegationEvent | null) => event !== null);

      allEvents = [...allEvents, ...events];

      hasNextPage = data.transactions.pageInfo.hasNextPage;
      after =
        data.transactions.edges[data.transactions.edges.length - 1]?.cursor;
    } catch (error) {
      console.error(`Error fetching delegation events: ${error}`);
      hasNextPage = false;
    }
  }

  return allEvents;
}

function calculateDelegationSummary(events: DelegationEvent[]) {
  const totalQueuedBoosts = events.filter(
    (e) => e.event === "queue_boost"
  ).length;
  const totalActivatedBoosts = events.filter(
    (e) => e.event === "activate_boost"
  ).length;
  const totalDelegatedQuantity = events.reduce(
    (sum, event) => sum + event.quantity,
    0
  );
  const uniqueDelegators = new Set(events.map((e) => e.address)).size;

  return {
    totalQueuedBoosts,
    totalActivatedBoosts,
    totalDelegatedQuantity,
    uniqueDelegators,
  };
}
