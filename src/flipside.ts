import { Flipside, QueryResultRecord } from "@flipsidecrypto/sdk";
import { getAddress } from "viem";

function getQueryForRevenues(
  validator: string,
  operator: string,
  startBlock: number,
  endBlock: number
) {
  return `
    with 
    --
    incentives as (
      select reward_vault, incentive_token, decimals, sum(amount) as amount from (
        select 
          contract_address as reward_vault, 
          concat('0x',substr(TOPICS[2], 27,64)) as incentive_token, 
          name, 
          decimals,
          (utils.udf_hex_to_int(substr(data,67,64))::int)/(pow(1e1,decimals)) as amount
        from berachain.testnet.fact_event_logs ip
        join berachain.testnet.dim_contracts c 
          on lower(concat('0x',substr(ip.TOPICS[2], 27,64)))=lower(c.address)
        where topics[0]=('0xd53172319994f5af85b7efcb42b2c2c36672baa8560f64b2b0c1d7f009014332')
          and concat('0x',substr(TOPICS[1], 27,64))=lower('${validator}') --use validator address, not operator address
          and amount>0
          and BLOCK_NUMBER between '${startBlock}' and '${endBlock}'
      )
      group by 1,2,3
    ),
    bgt_tranfers as (
      select sum(amount) as bgt_rewards from (
        select (utils.udf_hex_to_int(substr(data,3,64))::int)/1e18 as amount
        from berachain.testnet.fact_event_logs
        where topics[0]='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          and contract_address=lower('0xbDa130737BDd9618301681329bF2e46A016ff9Ad')
          and (
            concat('0x',substr(TOPICS[2], 27,64))=lower('${operator}') 
            or concat('0x',substr(TOPICS[2], 27,64))=lower('${validator}')
          )
          and concat('0x',substr(TOPICS[1], 27,64))=lower('0x0000000000000000000000000000000000000000')
          and BLOCK_NUMBER between '${startBlock}' and '${endBlock}'
      )
    )
    select reward_vault, incentive_token, amount, decimals from incentives
    union all
    select 
      lower('0x0000000000000000000000000000000000000000') as reward_vault, 
      lower('0xbDa130737BDd9618301681329bF2e46A016ff9Ad') as incentive_token, 
      bgt_rewards, 
      18 as decimals 
    from bgt_tranfers
  `;
}

export type ValidatorRevenueResult = {
  [incentiveToken: `0x${string}`]: {
    amount: number;
    decimals: number;
  };
};

export async function getRevenuesOfValidator(
  validator: string,
  operator: string,
  startBlock: number,
  endBlock: number
): Promise<ValidatorRevenueResult> {
  // =====================================
  //  FLIPSIDE SETUP
  // =====================================
  const flipside = new Flipside(
    process.env.FLIPSIDE_API_KEY!,
    "https://api-v2.flipsidecrypto.xyz"
  );
  const sql = getQueryForRevenues(validator, operator, startBlock, endBlock);
  try {
    const result = await flipside.query.run({ sql });
    return (
      result.records?.reduce((acc, record: QueryResultRecord) => {
        const incentiveToken = getAddress(record.incentive_token as string);
        return {
          ...acc,
          [incentiveToken]: {
            amount: record.amount as number,
            decimals: record.decimals as number,
          },
        };
      }, {} as ValidatorRevenueResult) ?? {}
    );
  } catch (error) {
    console.error("Error fetching validator revenue:", error);
    throw error;
  }
}
