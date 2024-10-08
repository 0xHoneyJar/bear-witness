import { formatEther, parseEther } from "viem";
import {
  fetchAllOffchainProgress,
  fetchOnchainMints,
  fetchQuestDetails,
  fetchWebsiteVisits,
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
  partnershipTier: string,
  onchainOnly: boolean = false,
  amountIncludesPrice: boolean = false
): Promise<{
  questDetails: Quest | null;
  totalMints: number;
  websiteResults: any | null;
  offchainResults: any | null;
}> {
  const ethPriceBigInt = parseEther(ethPrice);
  const fullPartnershipTier =
    PARTNERSHIP_TIERS.find(
      (tier) => tier.name.toLowerCase() === partnershipTier.toLowerCase()
    )?.fullName || partnershipTier;

  const questDetails = await fetchQuestDetails(questName);
  if (!questDetails) {
    throw new Error(`Quest "${questName}" not found`);
  }

  const { mints: onchainMints, totalMints } = await fetchOnchainMints(
    questName
  );

  let offchainResults = null;
  if (!onchainOnly) {
    offchainResults = await checkOffchainRevShare(
      onchainMints,
      questDetails,
      ethPriceBigInt,
      fullPartnershipTier,
      undefined,
      amountIncludesPrice
    );
  }

  let websiteResults = null;
  if (!onchainOnly) {
    const websiteVisits = await fetchWebsiteVisits(questName);
    console.log("websiteResults", onchainMints[0], websiteVisits[0]);

    websiteResults = checkRevenueShare(
      onchainMints,
      websiteVisits,
      timeWindow,
      ethPriceBigInt,
      fullPartnershipTier,
      amountIncludesPrice
    );
  } else {
    websiteResults = checkOnchainRevenueShare(
      onchainMints,
      ethPriceBigInt,
      fullPartnershipTier,
      amountIncludesPrice
    );
  }

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
  partnershipTier: string,
  amountIncludesPrice: boolean
): any {
  let totalMatches = 0;
  let totalMintAmount = 0;
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;
  const matches: any[] = [];

  console.log(`Total mints: ${mints.length}`);
  console.log(`Total visits: ${visits.length}`);
  console.log(`Time window: ${timeWindow} minutes`);

  for (const mint of mints) {
    const relevantVisits = visits.filter(
      (visit) =>
        visit.address.toLowerCase() === mint.address.toLowerCase() &&
        visit.questName === mint.questName &&
        BigInt(Math.abs(visit.timestamp - mint.timestamp / 1000)) <=
          BigInt(timeWindow) * 60n * 1000n
    );

    if (relevantVisits.length > 0) {
      totalMatches++;
      totalMintAmount += amountIncludesPrice ? 1 : mint.amount;
      const mintTimestampInSeconds = mint.timestamp / 1000;
      const timeDifferenceInHours =
        (mintTimestampInSeconds - relevantVisits[0].timestamp) / 3600;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mintTimestampInSeconds,
        mintAmount: amountIncludesPrice ? 1 : mint.amount,
        relevantVisits,
      });
      console.log(
        `Mint: ${mint.address}, Timestamp: ${mintTimestampInSeconds}`
      );
      console.log(`Relevant visits: ${JSON.stringify(relevantVisits?.[0])}`);
      console.log(`Time difference: ${timeDifferenceInHours.toFixed(2)} hours`);
      console.log(`Mint amount: ${amountIncludesPrice ? 1 : mint.amount}`);
    }
  }

  console.log(`Total matches: ${totalMatches}`);
  console.log(`Total mint amount: ${totalMintAmount}`);

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  const totalMintAmountEth = amountIncludesPrice
    ? BigInt(totalMintAmount)
    : ethPrice * BigInt(totalMintAmount);

  console.log(`Total payout: ${formatEther(totalPayout)} ETH`);

  return {
    summary: {
      questName: mints[0]?.questName || "Unknown",
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      totalMintAmountEth: formatEther(totalMintAmountEth),
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
  votedFor?: string,
  amountIncludesPrice: boolean = false
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
      totalMintAmount += amountIncludesPrice ? 1 : mint.amount;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        mintAmount: amountIncludesPrice ? 1 : mint.amount,
      });
    }
  }

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  const totalMintAmountEth = amountIncludesPrice
    ? BigInt(totalMintAmount)
    : ethPrice * BigInt(totalMintAmount);

  return {
    summary: {
      questName: quest.title,
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      totalMintAmountEth: formatEther(totalMintAmountEth),
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches,
  };
}

function checkOnchainRevenueShare(
  mints: OnchainMint[],
  ethPrice: bigint,
  partnershipTier: string,
  amountIncludesPrice: boolean
): any {
  let totalMintAmount = mints.reduce((sum, mint) => sum + mint.amount, 0);
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;

  const totalPayout = amountIncludesPrice
    ? (BigInt(Math.round(tierPercentage * 100)) * BigInt(totalMintAmount)) /
      10000n
    : (ethPrice *
        BigInt(Math.round(tierPercentage * 100)) *
        BigInt(totalMintAmount)) /
      10000n;

  console.log("totalMintAmount", mints);

  const totalMintAmountEth = amountIncludesPrice
    ? BigInt(totalMintAmount)
    : ethPrice * BigInt(totalMintAmount);

  return {
    summary: {
      questName: mints[0]?.questName || "Unknown",
      partnershipTier,
      tierPercentage,
      totalMatches: mints.length,
      totalMintAmount,
      totalMintAmountEth: formatEther(totalMintAmountEth),
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches: mints,
  };
}
