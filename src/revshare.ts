import { formatEther, parseEther } from "viem";
import {
  fetchOnchainMints,
  fetchQuestDetails,
  fetchWebsiteVisits,
  fetchAllOffchainProgress,
} from "./offchain";
import { OnchainMint, PartnershipTier, Quest, WebsiteVisit } from "./types";

export const PARTNERSHIP_TIERS: PartnershipTier[] = [
  { name: "Platinum", fullName: "Flagship (Platinum)", percentage: 4.2 },
  { name: "Gold", fullName: "Strategic (Gold)", percentage: 6.9 },
  { name: "Silver", fullName: "Integration (Silver)", percentage: 10 },
  { name: "Bronze", fullName: "Ecosystem (Bronze)", percentage: 12.5 },
];

export async function checkRevShare(
  questName: string,
  timeWindow: number,
  ethPrice: string,
  partnershipTier: string
) {
  const ethPriceBigInt = parseEther(ethPrice);
  const fullPartnershipTier =
    PARTNERSHIP_TIERS.find(
      (tier) => tier.name.toLowerCase() === partnershipTier.toLowerCase()
    )?.fullName || partnershipTier;

  const questDetails = await fetchQuestDetails(questName);
  if (!questDetails) {
    throw new Error(`Quest "${questName}" not found`);
  }

  const { mints: onchainMints, totalMints } = await fetchOnchainMints(questName);
  const websiteVisits = await fetchWebsiteVisits(questName);

  const websiteResults = checkRevenueShare(
    onchainMints,
    websiteVisits,
    timeWindow,
    ethPriceBigInt,
    fullPartnershipTier
  );

  const offchainResults = await checkOffchainRevShare(
    onchainMints,
    questDetails,
    ethPriceBigInt,
    fullPartnershipTier
  );

  return {
    questDetails,
    totalMints,
    websiteResults,
    offchainResults,
  };
}

function checkRevenueShare(
  mints: OnchainMint[],
  visits: WebsiteVisit[],
  timeWindow: number,
  ethPrice: bigint,
  partnershipTier: string
): any {
  let totalMatches = 0;
  let totalMintAmount = 0;
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;
  const matches: any[] = [];

  for (const mint of mints) {
    const relevantVisits = visits.filter(
      (visit) =>
        visit.address.toLowerCase() === mint.address.toLowerCase() &&
        visit.questName === mint.questName &&
        BigInt(Math.abs(visit.timestamp - mint.timestamp)) <=
          BigInt(timeWindow) * 60n * 1000n
    );

    if (relevantVisits.length > 0) {
      totalMatches++;
      totalMintAmount += mint.amount;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        mintAmount: mint.amount,
        relevantVisits,
      });
    }
  }

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  return {
    summary: {
      questName: mints[0]?.questName || "Unknown",
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches,
  };
}

async function checkOffchainRevShare(
  mints: OnchainMint[],
  quest: Quest,
  ethPrice: bigint,
  partnershipTier: string,
  votedFor?: string
): Promise<any> {
  let totalMatches = 0;
  let totalMintAmount = 0;
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;
  const matches: any[] = [];

  // Fetch off-chain progress
  const offchainProgress = await fetchAllOffchainProgress(quest, votedFor);

  for (const mint of mints) {
    let isMatch = offchainProgress.includes(mint.address.toLowerCase());

    if (isMatch) {
      totalMatches++;
      totalMintAmount += mint.amount;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        mintAmount: mint.amount,
      });
    }
  }

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  return {
    summary: {
      questName: quest.title,
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches,
  };
}
