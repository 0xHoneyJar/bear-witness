import fetch from "node-fetch";
import {
  GRAPHQL_ENDPOINT,
  IRYS_GRAPHQL_ENDPOINT,
  OWNER_ADDRESS,
} from "./config";
import { supabase } from "./supabase";
import {
  OnchainMint,
  Quest,
  Step,
  StepType,
  VerifyType,
  WebsiteVisit,
} from "./types";

export async function fetchOnchainMints(
  questName: string
): Promise<{ mints: OnchainMint[]; totalMints: number }> {
  let allMints: OnchainMint[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000;
  let totalMints = 0;

  while (hasMore) {
    try {
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query GetRevshareEvents($questName: String!, $limit: Int!, $offset: Int!) {
              revshareEvents(
                where: {
                  quest: { name_eq: $questName }
                }
                limit: $limit
                offset: $offset
                orderBy: timestamp_DESC
              ) {
                user
                amount
                timestamp
                quest {
                  name
                }
                stepNumber
              }
            }
          `,
          variables: {
            questName: questName,
            limit,
            offset,
          },
        }),
      });

      const { data } = (await response.json()) as any;

      if (data.revshareEvents && data.revshareEvents.length > 0) {
        const mints = data.revshareEvents.map((event: any) => {
          const amount = parseInt(event.amount) || 1;
          totalMints += amount;
          return {
            address: event.user,
            timestamp: parseInt(event.timestamp) * 1000, // Convert to milliseconds
            questName: event.quest.name,
            amount: amount,
            stepNumber: event.stepNumber,
          };
        });
        allMints = [...allMints, ...mints];
        offset += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`Error fetching onchain mints: ${error}`);
      hasMore = false;
    }
  }

  return { mints: allMints, totalMints };
}

export async function fetchQuestDetails(
  questName: string
): Promise<Quest | null> {
  const { data, error } = await supabase
    .from("quests")
    .select("*")
    .eq("title", questName)
    .single();

  if (error) {
    console.error(`Error fetching quest details: ${error.message}`);
    return null;
  }

  const quest = data as Quest;
  quest.tracked_steps = getVerifiableStepIndices(quest.steps);

  return quest;
}

export async function fetchWebsiteVisits(
  questName: string
): Promise<WebsiteVisit[]> {
  let allVisits: WebsiteVisit[] = [];
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
            query getByOwner($tags: [TagFilter!], $limit: Int!, $after: String) {
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
            tags: [{ name: "questName", values: [questName] }],
            limit: limit,
            after: after,
          },
        }),
      });

      const { data } = (await res.json()) as any;

      const visits = data.transactions.edges.map((edge: any) => {
        const tags = edge.node.tags;
        return {
          address: tags.find((tag: any) => tag.name === "address")?.value,
          timestamp: parseInt(
            tags.find((tag: any) => tag.name === "timestamp")?.value || "0"
          ),
          questName: tags.find((tag: any) => tag.name === "questName")?.value,
        };
      });

      allVisits = [...allVisits, ...visits];

      hasNextPage = data.transactions.pageInfo.hasNextPage;
      after =
        data.transactions.edges[data.transactions.edges.length - 1]?.cursor;
    } catch (error) {
      console.error(`Error fetching website visits: ${error}`);
      hasNextPage = false;
    }
  }

  return allVisits;
}

export async function fetchAllOffchainProgress(
  quest: Quest,
  votedFor?: string
): Promise<string[]> {
  let allRows: string[] = [];
  let from = 0;
  const limit = 10000;

  while (true) {
    let query = supabase
      .from("quest_progress")
      .select("address")
      .range(from, from + limit - 1)
      .eq("quest_name", quest.title)
      .contains(
        "tracked_steps",
        Object.fromEntries(
          quest.tracked_steps.map((stepIndex) => [stepIndex, true])
        )
      );

    if (votedFor) {
      query = query.eq("voted_for", votedFor);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length === 0) break;

    allRows = allRows.concat(data.map((row) => row.address));
    from += limit;
    if (data.length < limit) break;
  }

  return allRows;
}

function getVerifiableStepIndices(steps: Step[]): number[] {
  const MISC_STEPS = [
    StepType.Wait,
    StepType.Verify,
    StepType.Logout,
    StepType.Watch,
    VerifyType.Farcaster,
    VerifyType.Onchain,
    VerifyType.Manual,
    VerifyType.Referrals,
  ];

  const orGroupIndices = steps
    .map((step, index) => (step.orGroup ? index + 1 : null))
    .filter((index): index is number => index !== null);

  const verifiableIndices = steps.reduce(
    (verifiableIndices: number[], step, index) => {
      const stepIndex = index + 1; // 1-based index
      const isVerifiableStep =
        !MISC_STEPS.includes(step.type as StepType) &&
        step.type !== StepType.Mint &&
        step.type !== StepType.Onchain &&
        (!step.verificationType ||
          !MISC_STEPS.includes(step.verificationType as VerifyType));

      if (isVerifiableStep && !orGroupIndices.includes(stepIndex)) {
        verifiableIndices.push(stepIndex);
      }
      return verifiableIndices;
    },
    []
  );

  return verifiableIndices;
}
