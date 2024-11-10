import { createPublicClient, createWalletClient, http } from "viem";
import { berachainTestnetbArtio } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { getRevenuesOfValidator } from "./flipside";
import { checkDelegation } from "./delegation";
import { TIME_WINDOW, BGT_ADDRESS } from "./config";

export async function payout(
  referrer: string,
  validator: string,
  operator: string,
  startBlock: number,
  endBlock: number
) {
  // =====================================
  //  WEB3 SETUP
  // =====================================
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: berachainTestnetbArtio,
    transport: http(),
  });
  const publicClient = createPublicClient({
    chain: berachainTestnetbArtio,
    transport: http(),
  });
  // =====================================
  //  WEB3 DATA
  // =====================================
  const startBlock_ = await publicClient.getBlock({
    blockNumber: BigInt(startBlock),
  });
  const endBlock_ = await publicClient.getBlock({
    blockNumber: BigInt(endBlock),
  });
  // get how much total BGT said validator has delegated
  const totalBGTDelegated = await publicClient.readContract({
    address: BGT_ADDRESS,
    abi: [
      {
        inputs: [
          { internalType: "address", name: "validator", type: "address" },
        ],
        name: "boostees",
        outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const,
    functionName: "boostees",
    args: [validator as `0x${string}`],
  });
  // =====================================
  //  DATA FETCHING
  // =====================================
  const revenues = await getRevenuesOfValidator(
    validator,
    operator,
    startBlock,
    endBlock
  );
  const delegations = await checkDelegation(
    referrer,
    TIME_WINDOW,
    startBlock_.timestamp.toString(),
    endBlock_.timestamp.toString()
  );
  // =====================================
  //  COMPUTATIONS
  // =====================================
  // proportion of referrer's bgt to total delegated
  const proportion = Number(
    BigInt(delegations.summary.totalDelegatedAmount) / totalBGTDelegated
  );
  // go over each token in the revenues and adjust amount according to proportion
  for (const incentiveToken of Object.keys(revenues)) {
    revenues[incentiveToken].amount =
      revenues[incentiveToken].amount * proportion;
  }
  // =====================================
  //  DISTRIBUTION
  // =====================================
  for (const incentiveToken of Object.keys(revenues)) {
    // skip BGT
    if (incentiveToken === "0x0000000000000000000000000000000000000000") {
      continue;
    }
    // 4 decimals precision
    const amountToSend =
      BigInt(revenues[incentiveToken].amount.toFixed(4)) *
      BigInt(10 ** revenues[incentiveToken].decimals);

    await client.writeContract({
      address: incentiveToken as `0x${string}`,
      abi: [
        {
          inputs: [
            { internalType: "address", name: "to", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ] as const,
      functionName: "transfer",
      args: [referrer as `0x${string}`, amountToSend],
    });
  }
}
